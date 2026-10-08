"""An implementation is never itself an approval to send external requests."""

import json
from pathlib import Path

import pytest

from app.health_runtime import activation_template, runtime_enabled
from app.settings import ConfigurationError, Settings


def settings(tmp_path, **overrides):
    return Settings(
        app_env="test",
        database_path=tmp_path / "health.sqlite3",
        public_origin="http://localhost:5174",
        **overrides,
    )


def test_health_is_disabled_without_an_explicit_matching_approval(tmp_path):
    configured = settings(tmp_path)
    assert runtime_enabled(configured) is False
    configured = configured.model_copy(update={"health_checks_enabled": True})
    assert runtime_enabled(configured) is False


def test_approval_template_is_pending_and_cannot_enable_network(tmp_path):
    path = tmp_path / "approval.json"
    configured = settings(
        tmp_path,
        health_checks_enabled=True,
        health_dns_servers=("192.0.2.53",),
        health_denied_ips=("198.51.100.1",),
        health_worker_uid=1001,
        health_worker_lock_path=tmp_path / "worker.lock",
        health_activation_path=path,
    )
    template = activation_template(configured)
    assert template["approved_by"] is None
    assert all(
        item["status"] == "not_run" for item in template["verification"].values()
    )
    path.write_text(json.dumps(template))
    assert runtime_enabled(configured) is False


def test_health_environment_is_explicit_and_rejects_invalid_values(tmp_path):
    env = {
        "APP_ENV": "test",
        "DATABASE_PATH": str(tmp_path / "test.sqlite3"),
        "PUBLIC_ORIGIN": "http://localhost:5174",
        "HEALTH_CHECKS_ENABLED": "yes-please",
    }
    with pytest.raises(ConfigurationError):
        Settings.from_environment(env)
    env["HEALTH_CHECKS_ENABLED"] = "false"
    configured = Settings.from_environment(env)
    assert not configured.health_checks_enabled
    assert configured.health_activation_path is None
    assert configured.health_worker_lock_path == Path("/run/eduvibe/health-worker.lock")


def test_matching_operator_record_enables_only_its_build_and_configuration(tmp_path):
    from datetime import UTC, datetime

    path = tmp_path / "approval.json"
    configured = settings(
        tmp_path,
        health_checks_enabled=True,
        health_dns_servers=("192.0.2.53",),
        health_denied_ips=("198.51.100.1",),
        health_worker_uid=1001,
        health_activation_path=path,
    ).model_copy(update={"app_env": "development"})
    record = activation_template(configured)
    record["approved_by"] = "DomineYH"
    record["approved_at"] = datetime.now(UTC).isoformat()
    for item in record["verification"].values():
        item.update(status="pass", evidence="controlled fixture; never deployed")
    path.write_text(json.dumps(record))
    assert runtime_enabled(configured)
    assert not runtime_enabled(
        configured.model_copy(update={"health_dns_servers": ("192.0.2.54",)})
    )
    record["build_sha256"] = "0" * 64
    path.write_text(json.dumps(record))
    assert not runtime_enabled(configured)
    record["build_sha256"] = activation_template(configured)["build_sha256"]
    record["verification"]["clock_suspend"]["status"] = "not_run"
    path.write_text(json.dumps(record))
    assert not runtime_enabled(configured)
