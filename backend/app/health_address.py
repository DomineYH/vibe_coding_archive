"""Inspection-time destination policy; registration policy is intentionally separate."""

import asyncio
import ipaddress

import dns.exception
import dns.resolver
import httpx

# RFC 6052, RFC 8215, RFC 3056, RFC 2765/4291, RFC 4380.
# Network-specific translation prefixes cannot be inferred: operators must deny
# them explicitly and enforce the same policy in the worker egress firewall.
TRANSITION_NETWORKS = tuple(
    map(
        ipaddress.ip_network,
        (
            "64:ff9b::/96",
            "64:ff9b:1::/48",
            "2002::/16",
            "::ffff:0:0/96",
            "::ffff:0:0:0/96",
            "::/96",
            "2001::/23",  # Special-purpose block; fail closed on Python 3.12 tables.
            "192.0.0.0/24",
            "192.88.99.0/24",
        ),
    )
)


class DestinationBlocked(Exception):
    pass


class DNSFailure(Exception):
    pass


def validate_address(value, denied_ips):
    ip = ipaddress.ip_address(value)
    if (
        not ip.is_global
        or ip.is_multicast
        or ip.is_reserved
        or any(ip in network for network in TRANSITION_NETWORKS)
        or any(ip in ipaddress.ip_network(item, strict=False) for item in denied_ips)
    ):
        raise DestinationBlocked("DESTINATION_FORBIDDEN")
    return str(ip)


def validate_url(value):
    if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise httpx.InvalidURL("Invalid URL")
    url = httpx.URL(value)
    if (
        url.scheme not in ("http", "https")
        or not url.host
        or url.userinfo
        or url.port not in (None, {"http": 80, "https": 443}.get(url.scheme))
        or "%" in url.host
    ):
        raise DestinationBlocked("URL_POLICY")
    return url.copy_with(fragment=None)


async def resolve_address(host, resolver, denied_ips):
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return validate_address(host, denied_ips)
    answers = await asyncio.gather(
        resolver.resolve(host + ".", "A", search=False),
        resolver.resolve(host + ".", "AAAA", search=False),
        return_exceptions=True,
    )
    addresses = []
    for answer in answers:
        if isinstance(answer, dns.resolver.NoAnswer):
            continue
        if isinstance(answer, dns.exception.Timeout):
            raise TimeoutError("DNS timeout")
        if isinstance(answer, BaseException):
            raise DNSFailure() from answer
        addresses.extend(record.to_text() for record in answer)
    if not addresses:
        raise DNSFailure()
    validated = [validate_address(value, denied_ips) for value in addresses]
    return min(validated, key=lambda value: ipaddress.ip_address(value).version)
