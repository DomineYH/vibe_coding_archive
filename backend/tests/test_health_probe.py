import pytest

from app.health_probe import probe


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1",
        "https://[64:ff9b::808:808]",
        "https://[2002:0808:0808::1]",
        "http://[64:ff9b::7f00:1]/",
        "http://[2002:7f00:1::]/",
        "http://[::ffff:0:7f00:1]/",
        "http://[64:ff9b::127.0.0.1]/",
        "http://[::ffff:0:127.0.0.1]/",
    ],
)
async def test_forbidden_literal_never_connects(url):
    network = Network()
    result = await probe(url, dns_servers=(), denied_ips=(), network_backend=network)
    assert result["state"] == "blocked"
    assert result["http_status"] is None
    assert result["error_kind"] == "DESTINATION_BLOCKED"
    assert network.calls == []


class Resolver:
    async def resolve(self, host, kind, **kwargs):
        from types import SimpleNamespace

        return [SimpleNamespace(to_text=lambda: "8.8.8.8")] if kind == "A" else []


class Stream:
    def __init__(self, response):
        self.response = response
        self.written = b""
        self.closed = False
        self.sni = None

    async def read(self, max_bytes, timeout=None):
        data, self.response = self.response[:max_bytes], self.response[max_bytes:]
        return data

    async def write(self, buffer, timeout=None):
        self.written += buffer

    async def aclose(self):
        self.closed = True

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        import ssl

        assert ssl_context.verify_mode == ssl.CERT_REQUIRED
        assert ssl_context.check_hostname
        self.sni = server_hostname
        return self

    def get_extra_info(self, info):
        return None


class Network:
    def __init__(self, *responses):
        self.streams = [Stream(response) for response in responses]
        self.calls = []

    async def connect_tcp(self, host, port, **kwargs):
        self.calls.append((host, port))
        return self.streams[len(self.calls) - 1]


async def test_public_https_pins_ip_preserves_host_tls_and_closes_without_body():
    network = Network(b"HTTP/1.1 204 No Content\r\nContent-Length: 10000000\r\n\r\n")
    result = await probe(
        "https://example.org/a",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert result["state"] == "healthy"
    assert result["http_status"] == 204
    assert network.calls == [("8.8.8.8", 443)]
    assert network.streams[0].sni == "example.org"
    assert b"Host: example.org\r\n" in network.streams[0].written
    assert network.streams[0].closed


async def test_public_ipv6_literal_connects():
    network = Network(b"HTTP/1.1 204 No Content\r\n\r\n")
    result = await probe(
        "http://[2606:4700:4700::1111]/",
        dns_servers=(),
        denied_ips=(),
        network_backend=network,
    )
    assert result["state"] == "healthy"
    assert result["http_status"] == 204
    assert network.calls == [("2606:4700:4700::1111", 80)]
    assert network.streams[0].closed


async def test_get_fallback_redirect_uses_new_connections_no_cookie_and_get_persists():
    network = Network(
        b"HTTP/1.1 405 Nope\r\n\r\n",
        b"HTTP/1.1 302 Found\r\nLocation: /b\r\nSet-Cookie: secret=1\r\n\r\n",
        b"HTTP/1.1 200 OK\r\n\r\n",
    )
    result = await probe(
        "https://example.org/a",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert result["state"] == "healthy"
    assert [s.written.split(b" ")[0] for s in network.streams] == [
        b"HEAD",
        b"GET",
        b"GET",
    ]
    assert all(s.closed for s in network.streams)
    assert b"Cookie:" not in network.streams[2].written


@pytest.mark.parametrize(
    "status,state",
    [
        (200, "healthy"),
        (204, "healthy"),
        (403, "http_error"),
        (404, "http_error"),
        (500, "http_error"),
        (304, "http_error"),
    ],
)
async def test_final_http_classification(status, state):
    network = Network(f"HTTP/1.1 {status} Result\r\n\r\n".encode())
    result = await probe(
        "http://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert (result["state"], result["http_status"]) == (state, status)
    assert result["response_ms"] >= 0


@pytest.mark.parametrize("extra,state", [(0, "healthy"), (1, "blocked")])
@pytest.mark.parametrize("informational", [False, True])
async def test_preparse_header_limit_including_intermediate_responses(
    extra, state, informational
):
    prefix = b"HTTP/1.1 100 Continue\r\n\r\n" if informational else b""
    base = prefix + b"HTTP/1.1 200 OK\r\nX: "
    response = base + b"a" * (32768 + extra - len(base) - 4) + b"\r\n\r\n"
    network = Network(response)
    result = await probe(
        "http://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert result["state"] == state
    assert network.streams[0].closed
    if extra:
        assert result["error_kind"] == "RESPONSE_HEADERS_TOO_LARGE"
        assert result["http_status"] is None


@pytest.mark.parametrize(
    "ip",
    [
        "10.0.0.1",
        "100.64.0.1",
        "169.254.169.254",
        "224.0.0.1",
        "::1",
        "fc00::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "::127.0.0.1",
        "64:ff9b:1::808:808",
        "::ffff:0:808:808",
        "2001::808:808",
        "64:ff9b::7f00:1",
        "2002:7f00:1::",
        "::ffff:0:7f00:1",
    ],
)
async def test_any_forbidden_dns_answer_blocks_entire_request(ip):
    from types import SimpleNamespace

    class MixedResolver:
        async def resolve(self, host, kind, **kwargs):
            return [
                SimpleNamespace(to_text=lambda: "8.8.8.8"),
                SimpleNamespace(to_text=lambda: ip),
            ]

    network = Network()
    result = await probe(
        "http://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=MixedResolver(),
        network_backend=network,
    )
    assert result["state"] == "blocked"
    assert result["http_status"] is None
    assert result["error_kind"] == "DESTINATION_BLOCKED"
    assert network.calls == []


async def test_denied_own_host_or_custom_translation_prefix():
    network = Network()
    result = await probe(
        "http://8.8.8.8",
        dns_servers=(),
        denied_ips=("8.8.8.0/24",),
        network_backend=network,
    )
    assert result["state"] == "blocked"
    assert network.calls == []


@pytest.mark.parametrize(
    "location,state",
    [
        (b"/a", "redirect_error"),
        (b"", "redirect_error"),
        (b"http://127.0.0.1", "blocked"),
        (b"http://[64:ff9b::7f00:1]/", "blocked"),
        (b"http://[2002:7f00:1::]/", "blocked"),
        (b"http://[::ffff:0:7f00:1]/", "blocked"),
    ],
)
async def test_invalid_loop_and_forbidden_redirect(location, state):
    network = Network(b"HTTP/1.1 302 Found\r\nLocation: " + location + b"\r\n\r\n")
    result = await probe(
        "http://example.org/a",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert result["state"] == state
    assert result["http_status"] == (302 if state == "redirect_error" else None)
    assert result["error_kind"] == (
        "REDIRECT_ERROR" if state == "redirect_error" else "DESTINATION_BLOCKED"
    )
    assert result["error_stage"] == "redirect"
    assert len(network.calls) == 1


@pytest.mark.parametrize(
    "failure,kind,stage",
    [
        ("connect", "CONNECT_FAILURE", "connect"),
        ("read", "HTTP_PROTOCOL_ERROR", "response_headers"),
        ("write", "HTTP_PROTOCOL_ERROR", "response_headers"),
        ("malformed", "HTTP_PROTOCOL_ERROR", "response_headers"),
        ("tls", "TLS_FAILURE", "tls"),
        ("connect_timeout", "TIMEOUT", "connect"),
    ],
)
async def test_external_failure_uses_the_fixed_admin_taxonomy(failure, kind, stage):
    import ssl

    import httpcore

    class FailingStream(Stream):
        async def read(self, max_bytes, timeout=None):
            if failure == "read":
                raise httpcore.ReadError("private diagnostic")
            return await super().read(max_bytes, timeout)

        async def write(self, buffer, timeout=None):
            if failure == "write":
                raise httpcore.WriteError("private diagnostic")
            await super().write(buffer, timeout)

        async def start_tls(self, *args, **kwargs):
            if failure == "tls":
                raise ssl.SSLError("private diagnostic")
            return self

    class FailingNetwork(Network):
        async def connect_tcp(self, host, port, **kwargs):
            if failure == "connect":
                raise httpcore.ConnectError("private diagnostic")
            if failure == "connect_timeout":
                raise httpcore.ConnectTimeout("private diagnostic")
            return await super().connect_tcp(host, port, **kwargs)

    network = FailingNetwork()
    network.streams = [FailingStream(b"invalid\r\n\r\n")]
    result = await probe(
        "https://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert (result["error_kind"], result["error_stage"]) == (kind, stage)
    assert result["http_status"] is None
    assert result["response_ms"] is None
    assert "private diagnostic" not in str(result)


async def test_invalid_initial_url_is_blocked_at_url_stage():
    result = await probe("file:///private", dns_servers=(), denied_ips=())
    assert (result["state"], result["error_kind"], result["error_stage"]) == (
        "blocked",
        "DESTINATION_BLOCKED",
        "url",
    )


async def test_dns_partial_failure_is_not_ignored():
    import dns.resolver

    class BrokenResolver(Resolver):
        async def resolve(self, host, kind, **kwargs):
            if kind == "AAAA":
                raise dns.resolver.NoNameservers()
            return await super().resolve(host, kind, **kwargs)

    result = await probe(
        "http://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=BrokenResolver(),
        network_backend=Network(),
    )
    assert result["state"] == "network_error"
    assert result["error_stage"] == "dns"


async def test_redirect_limit_with_get_fallback_is_seven_requests():
    responses = [b"HTTP/1.1 501 Nope\r\n\r\n"] + [
        f"HTTP/1.1 302 Found\r\nLocation: /{i}\r\n\r\n".encode() for i in range(6)
    ]
    network = Network(*responses)
    result = await probe(
        "http://example.org/start",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert result["state"] == "redirect_error"
    assert len(network.calls) == 7
    assert all(s.closed for s in network.streams)


async def test_absolute_ten_second_deadline_cancels_dns_and_waits_for_cleanup():
    import asyncio
    import time

    class StalledResolver:
        active = 0

        async def resolve(self, *args, **kwargs):
            self.active += 1
            try:
                await asyncio.Event().wait()
            finally:
                self.active -= 1

    resolver = StalledResolver()
    started = time.monotonic()
    result = await probe(
        "https://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=resolver,
        network_backend=Network(),
    )
    assert 9.9 <= time.monotonic() - started < 11
    assert result["state"] == "timeout"
    assert result["error_stage"] == "dns"
    assert resolver.active == 0


@pytest.mark.parametrize("outcome", ["cancel", "success", "deadline"])
async def test_probe_closes_actual_socket_before_returning(outcome):
    import asyncio
    import socket

    import anyio.abc
    from httpcore._backends.anyio import AnyIOStream

    left, right = socket.socketpair()
    right.setblocking(False)
    stream = AnyIOStream(await anyio.abc.SocketStream.from_socket(left))

    class SocketNetwork:
        async def connect_tcp(self, *args, **kwargs):
            return stream

    task = asyncio.create_task(
        probe(
            "http://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=Resolver(),
            network_backend=SocketNetwork(),
        )
    )
    loop = asyncio.get_running_loop()
    request = await asyncio.wait_for(loop.sock_recv(right, 4096), 1)
    assert request.startswith(b"HEAD ")
    if outcome == "cancel":
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    elif outcome == "deadline":
        assert (await task)["state"] == "timeout"
    else:
        await loop.sock_sendall(
            right, b"HTTP/1.1 200 OK\r\nContent-Length: 99999999\r\n\r\n"
        )
        assert (await task)["state"] == "healthy"
    assert await asyncio.wait_for(loop.sock_recv(right, 1), 1) == b""
    right.close()


async def test_rebinding_on_get_fallback_is_revalidated():
    from types import SimpleNamespace

    class RebindingResolver(Resolver):
        calls = 0

        async def resolve(self, host, kind, **kwargs):
            if kind == "A":
                self.calls += 1
                ip = "8.8.8.8" if self.calls == 1 else "127.0.0.1"
                return [SimpleNamespace(to_text=lambda: ip)]
            return []

    network = Network(b"HTTP/1.1 405 Nope\r\n\r\n")
    result = await probe(
        "https://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=RebindingResolver(),
        network_backend=network,
    )
    assert result["state"] == "blocked"
    assert result["http_status"] is None
    assert len(network.calls) == 1


async def test_tls_certificate_failure_never_becomes_success():
    import ssl

    class BadTLS(Stream):
        async def start_tls(self, *args, **kwargs):
            raise ssl.SSLCertVerificationError("untrusted")

    network = Network()
    network.streams = [BadTLS(b"")]
    result = await probe(
        "https://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert result["state"] == "network_error"
    assert result["error_kind"] == "TLS_FAILURE"
    assert network.streams[0].closed


async def test_connection_timeout_is_three_seconds_without_ip_retry():
    import asyncio
    import time

    class StalledNetwork:
        calls = 0

        async def connect_tcp(self, *args, **kwargs):
            self.calls += 1
            await asyncio.Event().wait()

    network = StalledNetwork()
    started = time.monotonic()
    result = await probe(
        "https://example.org",
        dns_servers=(),
        denied_ips=(),
        resolver=Resolver(),
        network_backend=network,
    )
    assert 2.9 <= time.monotonic() - started < 4
    assert result["state"] == "timeout"
    assert network.calls == 1


async def test_unconfirmed_resource_cleanup_is_worker_failure_not_site_result():
    from app.health_transport import ResourceCleanupError

    class BrokenClose(Stream):
        async def aclose(self):
            raise OSError("cannot confirm close")

    network = Network()
    network.streams = [BrokenClose(b"HTTP/1.1 200 OK\r\n\r\n")]
    with pytest.raises(ResourceCleanupError):
        await probe(
            "http://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=Resolver(),
            network_backend=network,
        )


async def test_cancellation_during_close_reports_unconfirmed_resources():
    import asyncio

    from app.health_transport import ResourceCleanupError

    closing = asyncio.Event()

    class StalledClose(Stream):
        calls = 0

        async def aclose(self):
            self.calls += 1
            if self.calls == 1:
                closing.set()
                await asyncio.Event().wait()

    network = Network()
    network.streams = [StalledClose(b"HTTP/1.1 200 OK\r\n\r\n")]
    task = asyncio.create_task(
        probe(
            "http://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=Resolver(),
            network_backend=network,
        )
    )
    await closing.wait()
    task.cancel()
    with pytest.raises(ResourceCleanupError):
        await task


async def test_resume_after_dns_aborts_before_connect(monkeypatch):
    import time

    from app.health_transport import ResourceCleanupError

    actual_clock = time.clock_gettime
    offset = 0
    monkeypatch.setattr(
        time, "clock_gettime", lambda clock: actual_clock(clock) + offset
    )

    class SuspendResolver(Resolver):
        async def resolve(self, *args, **kwargs):
            nonlocal offset
            answer = await super().resolve(*args, **kwargs)
            offset = 30
            return answer

    network = Network(b"HTTP/1.1 200 OK\r\n\r\n")
    with pytest.raises(ResourceCleanupError):
        await probe(
            "https://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=SuspendResolver(),
            network_backend=network,
        )
    assert network.calls == []


@pytest.mark.parametrize("stage", ["connect", "tls", "write", "read", "close"])
async def test_clock_jump_during_io_closes_connection_without_result(
    stage, monkeypatch
):
    import time

    from app.health_transport import ResourceCleanupError

    actual_clock = time.clock_gettime
    offset = 0
    monkeypatch.setattr(
        time, "clock_gettime", lambda clock: actual_clock(clock) + offset
    )

    class SuspendStream(Stream):
        async def read(self, *args, **kwargs):
            nonlocal offset
            if stage == "read":
                offset = 30
            return await super().read(*args, **kwargs)

        async def write(self, *args, **kwargs):
            nonlocal offset
            if stage == "write":
                offset = 30
            return await super().write(*args, **kwargs)

        async def start_tls(self, *args, **kwargs):
            nonlocal offset
            if stage == "tls":
                offset = 30
            return await super().start_tls(*args, **kwargs)

        async def aclose(self):
            nonlocal offset
            if stage == "close":
                offset = 30
            await super().aclose()

    class SuspendNetwork(Network):
        async def connect_tcp(self, *args, **kwargs):
            nonlocal offset
            if stage == "connect":
                offset = 30
            return await super().connect_tcp(*args, **kwargs)

    network = SuspendNetwork()
    network.streams = [SuspendStream(b"HTTP/1.1 200 OK\r\n\r\n")]
    with pytest.raises(ResourceCleanupError):
        await probe(
            "https://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=Resolver(),
            network_backend=network,
        )
    assert network.streams[0].closed
    if stage in ("connect", "tls"):
        assert network.streams[0].written == b""


async def test_boot_change_after_dns_prevents_connect(monkeypatch):
    from pathlib import Path

    from app.health_transport import ResourceCleanupError

    boot = "boot-a"
    original_read = Path.read_text
    monkeypatch.setattr(
        Path,
        "read_text",
        lambda path, *args, **kwargs: (
            boot
            if str(path) == "/proc/sys/kernel/random/boot_id"
            else original_read(path, *args, **kwargs)
        ),
    )

    class RebootResolver(Resolver):
        async def resolve(self, *args, **kwargs):
            nonlocal boot
            answer = await super().resolve(*args, **kwargs)
            boot = "boot-b"
            return answer

    network = Network()
    with pytest.raises(ResourceCleanupError):
        await probe(
            "http://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=RebootResolver(),
            network_backend=network,
        )
    assert network.calls == []


async def test_backward_monotonic_after_dns_prevents_connect(monkeypatch):
    import time

    from app.health_transport import ResourceCleanupError

    actual_monotonic = time.monotonic
    offset = 0
    monkeypatch.setattr(time, "monotonic", lambda: actual_monotonic() + offset)

    class BackwardResolver(Resolver):
        async def resolve(self, *args, **kwargs):
            nonlocal offset
            answer = await super().resolve(*args, **kwargs)
            offset = -30
            return answer

    network = Network()
    with pytest.raises(ResourceCleanupError):
        await probe(
            "http://example.org",
            dns_servers=(),
            denied_ips=(),
            resolver=BackwardResolver(),
            network_backend=network,
        )
    assert network.calls == []
