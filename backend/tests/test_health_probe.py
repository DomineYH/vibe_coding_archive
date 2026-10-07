import pytest
from app.health_probe import probe


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1", "https://[64:ff9b::808:808]", "https://[2002:0808:0808::1]"],
)
async def test_forbidden_literal_never_connects(url):
    result = await probe(url, dns_servers=(), denied_ips=())
    assert result["state"] == "blocked"
    assert result["http_status"] is None


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
    assert len(network.calls) == 1


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
