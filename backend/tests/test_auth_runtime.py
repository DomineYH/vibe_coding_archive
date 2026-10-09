"""Synthetic records in APP_ENV=test temp directories never authorize deployment."""

import json
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.settings import Settings


@pytest.fixture(name="candidate")
def candidate(tmp_path):
    from app.auth_runtime import activation_template

    private = tmp_path / "candidate"
    private.mkdir(mode=0o700)
    settings = Settings(
        app_env="test",
        database_path=private / "api.sqlite3",
        public_origin="https://archive.example.test",
        auth_activation_path=private / "auth.json",
        app_release_id="synthetic-release",
    )
    record = activation_template(settings)
    record.update(
        status="approved",
        approved_by="DomineYH",
        approved_at="2026-01-01T00:00:00+00:00",
        issue_144_comment="https://github.com/DomineYH/vibe_coding_archive/issues/144#issuecomment-123",
    )
    # Production binding is metadata only: the real Settings and files stay test/temp.
    record["configuration"]["app_env"] = "production"
    write_record(settings.auth_activation_path, record)
    return settings, record


def write_record(path, record):
    path.write_text(json.dumps(record))
    path.chmod(0o600)


def evaluate(settings, record):
    from app.auth_runtime import record_enabled

    return record_enabled(
        settings.auth_activation_path,
        build_sha256=record["build_sha256"],
        release_id="synthetic-release",
        configuration={**record["configuration"], "app_env": "production"},
    )


def test_template_is_pending_and_safe(candidate):
    from app.auth_runtime import activation_template, runtime_enabled

    settings, _ = candidate
    template = activation_template(settings)
    assert template["status"] == "pending"
    assert template["approved_by"] is None
    assert template["approved_at"] is None
    assert template["issue_144_comment"] is None
    assert template["scope"] == "limited candidate, external ingress closed"
    assert template["configuration"]["health_checks_enabled"] is False
    assert "secret" not in json.dumps(template)
    write_record(settings.auth_activation_path, template)
    assert not runtime_enabled(settings)


def test_matching_synthetic_record(candidate):
    settings, record = candidate
    assert evaluate(settings, record)


@pytest.mark.parametrize(
    "updates",
    [
        {"version": True},
        {"version": 2},
        {"status": "pending"},
        {"status": "revoked"},
        {"approved_by": " "},
        {"approved_by": 1},
        {"approved_by": "someone-else"},
        {"approved_at": None},
        {"approved_at": "2026-01-01"},
        {"approved_at": "2999-01-01T00:00:00Z"},
        {"build_sha256": "0" * 64},
        {"release_id": "other-release"},
        {"configuration": {}},
        {"scope": "public release"},
        {"issue_144_comment": None},
        {
            "issue_144_comment": "https://github.com/DomineYH/vibe_coding_archive/issues/144#issuecomment-0"
        },
        {"issue_144_comment": "https://example.org/issues/144#issuecomment-123"},
    ],
)
def test_candidate_record_validation_matrix(candidate, updates):
    settings, expected = candidate
    write_record(settings.auth_activation_path, {**expected, **updates})
    assert not evaluate(settings, expected)


@pytest.mark.parametrize(
    "kind",
    [
        "missing",
        "json",
        "duplicate",
        "oversize",
        "list",
        "mode",
        "symlink",
        "fifo",
        "directory",
        "parent",
    ],
)
def test_invalid_record_storage_closes_candidate(candidate, kind):
    import os

    settings, expected = candidate
    path = settings.auth_activation_path
    if kind in {"missing", "symlink", "fifo", "directory"}:
        path.unlink()
    if kind == "json":
        path.write_bytes(b"{bad")
    elif kind == "duplicate":
        path.write_text(
            json.dumps(expected).replace('"version": 1', '"version": 1, "version": 1')
        )
    elif kind == "oversize":
        path.write_bytes(b" " * 65537)
    elif kind == "list":
        path.write_text("[]")
    elif kind == "mode":
        path.chmod(0o640)
    elif kind == "symlink":
        target = path.with_suffix(".target")
        write_record(target, expected)
        path.symlink_to(target)
    elif kind == "fifo":
        os.mkfifo(path, 0o600)
    elif kind == "directory":
        path.mkdir()
    elif kind == "parent":
        path.parent.chmod(0o755)
    assert not evaluate(settings, expected)


@pytest.mark.parametrize("kind", ["removed", "revoked", "corrupt", "mode", "binding"])
def test_candidate_record_is_reopened_after_replacement(candidate, kind):
    settings, record = candidate
    assert evaluate(settings, record)
    replacement = settings.auth_activation_path.with_suffix(".replacement")
    write_record(replacement, record)
    replacement.replace(settings.auth_activation_path)
    assert evaluate(settings, record)
    if kind == "removed":
        settings.auth_activation_path.unlink()
    elif kind == "revoked":
        write_record(settings.auth_activation_path, {**record, "status": "revoked"})
    elif kind == "corrupt":
        settings.auth_activation_path.write_text("invalid")
    elif kind == "mode":
        settings.auth_activation_path.chmod(0o644)
    else:
        write_record(settings.auth_activation_path, {**record, "release_id": "changed"})
    assert not evaluate(settings, record)


def test_auth_record_does_not_approve_health_or_collection(candidate):
    from app.health_runtime import activation_template, runtime_enabled

    settings, expected = candidate
    health = settings.model_copy(
        update={
            "app_env": "development",
            "health_checks_enabled": True,
            "health_dns_servers": ("192.0.2.53",),
            "health_denied_ips": ("198.51.100.1",),
            "health_worker_uid": 1001,
            "health_activation_path": settings.auth_activation_path,
        }
    )
    assert not runtime_enabled(health)
    health_record = activation_template(health)
    health_record.update(
        approved_by="DomineYH", approved_at=datetime.now(UTC).isoformat()
    )
    for verification in health_record["verification"].values():
        verification.update(status="pass", evidence="synthetic fixture")
    write_record(settings.auth_activation_path, health_record)
    assert runtime_enabled(health)
    assert not evaluate(settings, expected)


def test_auth_revocation_is_latched(candidate, monkeypatch):
    from app.auth_runtime import auth_available

    settings, record = candidate
    monkeypatch.setattr(
        "app.auth_runtime.runtime_enabled", lambda _: evaluate(settings, record)
    )
    state = SimpleNamespace(
        settings=settings,
        auth_enabled=True,
        auth_ready=True,
        auth_candidate=True,
        auth_revoked=False,
    )
    assert auth_available(state)
    settings.auth_activation_path.unlink()
    assert not auth_available(state)
    write_record(settings.auth_activation_path, record)
    assert not auth_available(state)


def test_printable_template_cannot_approve_or_write(tmp_path):
    import os
    import subprocess
    import sys

    private = tmp_path / "printable"
    private.mkdir(mode=0o700)
    path = private / "auth.json"
    result = subprocess.run(
        [sys.executable, "-m", "app.auth_runtime"],
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(private / "api.sqlite3"),
            "PUBLIC_ORIGIN": "https://archive.example.test",
            "AUTH_ACTIVATION_PATH": str(path),
            "APP_RELEASE_ID": "synthetic-release",
            "PASSWORD_RESET_HMAC_PATH": "",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert result.stderr == ""
    template = json.loads(result.stdout)
    assert template["status"] == "pending"
    assert (
        template["approved_by"]
        is template["approved_at"]
        is template["issue_144_comment"]
        is None
    )
    assert not path.exists()


@pytest.mark.parametrize(
    "kind",
    [
        "valid",
        "missing",
        "corrupt",
        "group_write",
        "world_write",
        "symlink",
        "fifo",
        "directory",
    ],
)
def test_candidate_requires_verified_protected_blocklist(
    tmp_path, password_blocklist, kind
):
    import os

    from app.auth_runtime import load_candidate_blocklist

    path = tmp_path / "blocklist.txt"
    path.write_bytes(password_blocklist.read_bytes())
    path.chmod(0o600)
    if kind in {"missing", "symlink", "fifo", "directory"}:
        path.unlink()
    if kind == "corrupt":
        path.write_bytes(b"not the verified source")
    elif kind == "group_write":
        path.chmod(0o620)
    elif kind == "world_write":
        path.chmod(0o602)
    elif kind == "symlink":
        path.symlink_to(password_blocklist)
    elif kind == "fifo":
        os.mkfifo(path, 0o600)
    elif kind == "directory":
        path.mkdir()
    if kind == "valid":
        assert "password" in load_candidate_blocklist(path)
    else:
        with pytest.raises(RuntimeError, match="verified password blocklist"):
            load_candidate_blocklist(path)


def test_closed_startup_never_activates_without_restart(candidate, monkeypatch):
    from app.auth_runtime import auth_available

    settings, _record = candidate

    def reject_evaluation(_):
        raise AssertionError(
            "closed startup must not acquire missing prepared resources"
        )

    monkeypatch.setattr("app.auth_runtime.runtime_enabled", reject_evaluation)
    state = SimpleNamespace(
        settings=settings,
        auth_enabled=False,
        auth_ready=True,
        auth_candidate=True,
        auth_revoked=False,
    )
    assert not auth_available(state)


def test_record_read_failure_is_closed(candidate, monkeypatch):
    settings, record = candidate

    def unreadable(*args, **kwargs):
        raise PermissionError("synthetic read failure")

    monkeypatch.setattr("app.auth_runtime.os.open", unreadable)
    assert not evaluate(settings, record)


def test_record_owner_mismatch_is_closed(candidate, monkeypatch):
    import os

    settings, record = candidate
    real_fstat = os.fstat

    def wrong_owner(descriptor):
        metadata = real_fstat(descriptor)
        return SimpleNamespace(st_uid=os.geteuid() + 1, st_mode=metadata.st_mode)

    monkeypatch.setattr("app.auth_runtime.os.fstat", wrong_owner)
    assert not evaluate(settings, record)


def test_invalid_hmac_symlink_does_not_change_auth_binding(candidate):
    from app.auth_runtime import auth_configuration

    settings, _record = candidate
    secret = settings.auth_activation_path.parent / "reset.json"
    secret.write_text("synthetic invalid supply")
    settings = settings.model_copy(update={"password_reset_hmac_path": secret})
    expected = auth_configuration(settings)
    secret.unlink()
    secret.symlink_to(secret.parent / "different-reset.json")
    assert auth_configuration(settings) == expected


@pytest.mark.parametrize("status", ["approved", "pending", "invalid", "revoked"])
def test_browser_fixture_uses_real_binding_validation(candidate, status):
    from tests.auth_candidate import write_fixture

    settings, expected = candidate
    write_fixture(settings, status)
    assert evaluate(settings, expected) is (status == "approved")
    if status == "invalid":
        record = json.loads(settings.auth_activation_path.read_text())
        assert record["status"] == "approved"
        assert record["build_sha256"] == "0" * 64


@pytest.mark.parametrize("extra", ["unexpected metadata", float("nan")])
def test_v1_record_rejects_additional_fields_and_non_json_values(candidate, extra):
    settings, record = candidate
    write_record(settings.auth_activation_path, {**record, "extra": extra})
    assert not evaluate(settings, record)
