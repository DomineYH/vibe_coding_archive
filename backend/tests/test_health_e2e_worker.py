from datetime import datetime, timedelta

from tests.health_e2e_worker import controlled_probe


async def test_controlled_worker_blocks_private_dns_answer():
    result = await controlled_probe(
        "https://health-blocked.example.test/app", dns_servers=(), denied_ips=()
    )
    assert datetime.fromisoformat(result.pop("fresh_until")) - datetime.fromisoformat(
        result.pop("checked_at")
    ) == timedelta(minutes=15)
    assert result == {
        "state": "blocked",
        "http_status": None,
        "response_ms": None,
        "error_kind": "DESTINATION_BLOCKED",
        "error_stage": "dns",
    }


async def test_controlled_worker_keeps_ordinary_host_healthy():
    result = await controlled_probe(
        "https://example.test/app", dns_servers=(), denied_ips=()
    )
    assert result["state"] == "healthy"
    assert result["http_status"] == 204
    assert result["response_ms"] >= 0
    assert result["error_kind"] is None
    assert result["error_stage"] is None
