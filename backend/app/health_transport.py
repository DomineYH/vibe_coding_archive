"""Pinned HTTP/1.1 transport. The stream bounds headers before h11 sees bytes."""

import asyncio
import ssl
import time
from pathlib import Path

import httpcore
import httpx
from httpcore._backends.anyio import AnyIOBackend
from httpcore._backends.base import AsyncNetworkBackend, AsyncNetworkStream


class HeadersTooLarge(Exception):
    pass


class ResourceCleanupError(Exception):
    """The worker must stop: termination of an inspection stream is unconfirmed."""


class ProbeClock:
    """Fail closed on suspend/boot-clock discontinuities; not a VM verification."""

    def __init__(self):
        self.boot_id, self.monotonic, self.offset = self.sample()

    @staticmethod
    def sample():
        try:
            boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
            monotonic = time.monotonic()
            offset = time.clock_gettime(time.CLOCK_BOOTTIME) - monotonic
        except (OSError, AttributeError) as exc:
            raise ResourceCleanupError("Inspection clock unavailable") from exc
        return boot_id, monotonic, offset

    def check(self):
        boot_id, monotonic, offset = self.sample()
        if (
            boot_id != self.boot_id
            or monotonic < self.monotonic
            or abs(offset - self.offset) > 0.25
        ):
            raise ResourceCleanupError("Inspection clock discontinuity")
        self.monotonic = monotonic


class HeaderStream(AsyncNetworkStream):
    def __init__(self, stream, backend):
        self.stream = stream
        self.backend = backend
        self.done = False

    async def read(self, max_bytes, timeout=None):
        self.backend.clock.check()
        if self.done:
            return b""
        data = bytearray()
        offset = 0
        while True:
            self.backend.clock.check()
            chunk = await self.stream.read(min(max_bytes, 32769 - len(data)), timeout)
            self.backend.clock.check()
            if not chunk:
                return bytes(data)
            data.extend(chunk)
            while True:
                end = data.find(b"\r\n\r\n", offset)
                if end < 0:
                    break
                end += 4
                if end > 32768:
                    raise HeadersTooLarge()
                status = bytes(data[offset:end]).split(b"\r\n", 1)[0].split(b" ")
                # 101 is a protocol upgrade, not another HTTP response block.
                informational = (
                    len(status) >= 2
                    and status[1].startswith(b"1")
                    and status[1] != b"101"
                )
                offset = end
                if not informational:
                    self.done = True
                    return bytes(data[:end])  # Discard any coalesced response body.
            if len(data) > 32768:
                raise HeadersTooLarge()

    async def write(self, buffer, timeout=None):
        self.backend.clock.check()
        self.backend.stage = "response_headers"
        await self.stream.write(buffer, timeout)
        self.backend.clock.check()
        self.backend.stage = "response_headers"

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.backend.stage = "tls"
        remaining = (
            min(self.backend.deadline, self.backend.connect_deadline) - time.monotonic()
        )
        try:
            self.backend.clock.check()
            async with asyncio.timeout(remaining):
                self.stream = await self.stream.start_tls(
                    ssl_context, server_hostname, remaining
                )
            self.backend.clock.check()
        except BaseException:
            # httpcore has not attached this connection to its pool until TLS
            # succeeds, so this stream owns cleanup on handshake failure.
            await self.aclose()
            raise
        self.backend.stage = "response_headers"
        return self

    async def aclose(self):
        try:
            await self.stream.aclose()
        except BaseException as exc:
            raise ResourceCleanupError() from exc

    def get_extra_info(self, info):
        return self.stream.get_extra_info(info)


class PinnedBackend(AsyncNetworkBackend):
    def __init__(self, ip, deadline, clock, delegate=None):
        self.clock = clock
        self.ip = ip
        self.deadline = deadline
        self.delegate = delegate or AnyIOBackend()
        self.connect_deadline = deadline
        self.stage = "connect"

    async def connect_tcp(
        self, host, port, timeout=None, local_address=None, socket_options=None
    ):
        self.clock.check()
        self.connect_deadline = min(self.deadline, time.monotonic() + 3)
        async with asyncio.timeout_at(self.connect_deadline):
            stream = await self.delegate.connect_tcp(
                self.ip,
                port,
                timeout=self.connect_deadline - time.monotonic(),
                local_address=local_address,
                socket_options=socket_options,
            )
        wrapped = HeaderStream(stream, self)
        try:
            self.clock.check()
        except ResourceCleanupError:
            await wrapped.aclose()
            raise
        return wrapped


class ResponseStream(httpx.AsyncByteStream):
    def __init__(self, stream):
        self.stream = stream

    async def __aiter__(self):
        async for chunk in self.stream:
            yield chunk

    async def aclose(self):
        await self.stream.aclose()


class PinnedTransport(httpx.AsyncBaseTransport):
    def __init__(self, ip, deadline, clock, backend=None):
        self.backend = PinnedBackend(ip, deadline, clock, backend)
        self.pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl.create_default_context(),
            network_backend=self.backend,
            http1=True,
            http2=False,
            retries=0,
            max_connections=1,
            max_keepalive_connections=0,
        )

    async def handle_async_request(self, request):
        response = await self.pool.handle_async_request(
            httpcore.Request(
                method=request.method,
                url=httpcore.URL(
                    scheme=request.url.raw_scheme,
                    host=request.url.raw_host,
                    port=request.url.port,
                    target=request.url.raw_path,
                ),
                headers=request.headers.raw,
                content=request.stream,
                extensions=request.extensions,
            )
        )
        return httpx.Response(
            response.status,
            headers=response.headers,
            stream=ResponseStream(response.stream),
            extensions=response.extensions,
        )

    async def aclose(self):
        await self.pool.aclose()
