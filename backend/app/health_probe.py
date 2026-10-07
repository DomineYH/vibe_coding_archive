"""One bounded, server-side HTTP inspection, independent of queue persistence."""

import asyncio
import ssl
import time
from datetime import datetime, timedelta, timezone

import dns.asyncresolver
import httpcore
import httpx

from app.health_address import (
    DestinationBlocked,
    DNSFailure,
    resolve_address,
    validate_url,
)
from app.health_transport import HeadersTooLarge, PinnedTransport


async def probe(
    url: str,
    *,
    dns_servers: tuple[str, ...],
    denied_ips: tuple[str, ...],
    resolver=None,
    network_backend=None,
):
    """Inspect headers only; cancellation propagates so workers never store it as a result.

    Injected resolver/network_backend replace I/O, never the destination/TLS policy.
    Configuration/implementation errors propagate as job failures, not site failures.
    """
    started = time.monotonic()
    deadline = started + 10
    stage, transport = "policy", None
    state, code, elapsed, kind = "network_error", None, None, None
    try:
        async with asyncio.timeout_at(deadline):
            target = validate_url(url)
            if resolver is None:
                resolver = dns.asyncresolver.Resolver(configure=False)
                resolver.nameservers = list(dns_servers)
                resolver.lifetime = 10
            method, redirects, visited = "HEAD", 0, {str(target)}
            while True:
                stage, transport = "dns", None
                ip = await resolve_address(target.host, resolver, denied_ips)
                transport = PinnedTransport(ip, deadline, network_backend)
                async with (
                    httpx.AsyncClient(
                        transport=transport, trust_env=False, follow_redirects=False
                    ) as client,
                    client.stream(
                        method,
                        target,
                        headers={
                            "User-Agent": "EduVibe-LinkChecker/1.0",
                            "Connection": "close",
                        },
                        timeout=httpx.Timeout(10, connect=3),
                    ) as response,
                ):
                    code = response.status_code
                    elapsed = int((time.monotonic() - started) * 1000)
                    location = response.headers.get("location")
                if time.monotonic() >= deadline:
                    raise TimeoutError()
                if method == "HEAD" and code in (405, 501):
                    method = "GET"
                    continue
                if code not in (301, 302, 303, 307, 308):
                    state = "healthy" if 200 <= code < 300 else "http_error"
                    break
                state, kind, stage = "redirect_error", "INVALID_REDIRECT", "redirect"
                transport = None
                if not location or redirects == 5:
                    break
                try:
                    next_target = validate_url(str(target.join(location)))
                except (httpx.InvalidURL, ValueError):
                    break
                if str(next_target) in visited:
                    break
                visited.add(str(next_target))
                redirects += 1
                target = next_target
                state, kind = "network_error", None
    except DestinationBlocked as exc:
        state, kind = "blocked", str(exc)
    except HeadersTooLarge:
        state, kind = "blocked", "RESPONSE_HEADERS_TOO_LARGE"
    except (TimeoutError, httpcore.TimeoutException):
        state, kind = "timeout", "TIMEOUT"
    except DNSFailure:
        kind = "DNS_FAILURE"
    except (httpcore.NetworkError, httpcore.ProtocolError, ssl.SSLError, OSError):
        kind = (
            "TLS_FAILURE"
            if transport and transport.backend.stage == "tls"
            else "NETWORK_FAILURE"
        )
    except httpx.InvalidURL:
        state, kind = "blocked", "URL_POLICY"
    now = datetime.now(timezone.utc)
    if state not in ("healthy", "http_error", "redirect_error"):
        code, elapsed = None, None
    return {
        "state": state,
        "http_status": code,
        "response_ms": elapsed,
        "error_kind": kind,
        "error_stage": (transport.backend.stage if transport else stage)
        if kind
        else None,
        "checked_at": now.isoformat(),
        "fresh_until": (now + timedelta(minutes=15)).isoformat(),
    }
