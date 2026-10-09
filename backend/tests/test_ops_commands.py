"""Explicit operator commands over protected test-only supplies."""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy.exc import SQLAlchemyError

from tests import test_ops_check
from tests.support import populate_public_and_private_apps

ops_storage = test_ops_check.ops_storage

BACKEND = Path(__file__).resolve().parents[1]


def command(database, *args, **environment):
    return subprocess.run(
        [sys.executable, "-m", "app.cli", *args],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "HEALTH_CHECKS_ENABLED": "false",
            **environment,
        },
        capture_output=True,
        check=False,
        timeout=20,
    )


def test_disable_health_revokes_intake_and_cancels_only_active_jobs(ops_storage):
    database, _ = ops_storage
    populate_public_and_private_apps(database, public_count=3)
    activation = database.parent / "activation.json"
    activation.write_text(json.dumps({"version": 1, "synthetic": True}))
    activation.chmod(0o600)
    with sqlite3.connect(database) as db:
        for i, status in enumerate(("queued", "running", "completed")):
            db.execute(
                "INSERT INTO health_jobs(id,app_id,url_version,status,individual,created_at,finished_at,attempts,worker_id,boot_id,lease_deadline,started_at) VALUES (?,?,1,?,1,'2026-10-09T00:00:00Z',?,1,'synthetic-worker','synthetic-boot',100,'2026-10-09T00:00:01Z')",
                (
                    str(i),
                    f"00000000-0000-4000-8000-{i + 1:012d}",
                    status,
                    "2026-10-09T00:01:00Z" if status == "completed" else None,
                ),
            )
        before = db.execute("SELECT * FROM health_results ORDER BY app_id").fetchall()
        terminal = db.execute("SELECT * FROM health_jobs WHERE id='2'").fetchall()
    result = command(
        database,
        "disable-health",
        HEALTH_ACTIVATION_PATH=str(activation),
        HEALTH_WORKER_LOCK_PATH=str(database.parent / "worker.lock"),
    )
    assert result.returncode == 0, (
        "disable-health must durably revoke and cancel active jobs"
    )
    assert not activation.exists()
    evidence = list(activation.parent.glob(activation.name + ".revoked-*"))
    assert len(evidence) == 1 and evidence[0].stat().st_mode & 0o777 == 0o600
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT status FROM health_jobs WHERE id IN ('0','1')"
        ).fetchall() == [("cancelled",), ("cancelled",)]
        assert (
            db.execute("SELECT * FROM health_results ORDER BY app_id").fetchall()
            == before
        )
        assert (
            db.execute("SELECT * FROM health_jobs WHERE id='2'").fetchall() == terminal
        )
    assert (
        command(
            database,
            "disable-health",
            HEALTH_ACTIVATION_PATH=str(activation),
            HEALTH_WORKER_LOCK_PATH=str(database.parent / "worker.lock"),
        ).returncode
        == 0
    )
    assert len(list(activation.parent.glob(activation.name + ".revoked-*"))) == 1


def test_rotate_reset_key_invalidates_before_atomic_replacement(
    ops_storage, make_test_app, tmp_path
):
    database, _ = ops_storage
    # Without a test-only injected process reader, the stop state is unconfirmed.
    result = command(
        database,
        "rotate-reset-key",
        "--generate",
        PASSWORD_RESET_HMAC_PATH=str(database.parent / "secret.json"),
    )
    assert result.returncode == 3, (
        "rotation must explicitly refuse an unconfirmed API stop"
    )
    assert b"RESET_STOP_REQUIRED" in result.stdout

    from fastapi.testclient import TestClient

    from app.operational_commands import rotate_reset_key
    from app.password_reset_secret import load_secret
    from tests.password_reset_client import (
        admin,
        cancel,
        execute,
        issue,
        reset_app,
        result,
    )

    app, path, secret = reset_app(make_test_app, tmp_path, name="rotation.sqlite3")
    for file in path.parent.glob(path.name + "*"):
        file.chmod(0o600)
    old = load_secret(secret)
    with TestClient(app) as client:
        browser = admin(client)
        success = issue(browser).json()["key"]
        assert execute(browser, success).status_code == 204
        pending = issue(browser, version=2).json()["key"]
        with sqlite3.connect(path) as db:
            history = db.execute(
                "SELECT * FROM write_operations WHERE key=?", (success,)
            ).fetchall()
            expiry = db.execute(
                "SELECT created_at,expires_at FROM write_operations WHERE key=?",
                (pending,),
            ).fetchall()
        assert (
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
            == 0
        )
        assert load_secret(secret) is not None and load_secret(secret) != old
        assert len(load_secret(secret)[0]) == 32
        assert (
            result(browser, pending).json()["rejection_code"] == "OPERATION_INVALIDATED"
        )
        assert result(browser, success).json()["state"] == "succeeded"
        assert cancel(browser, pending).status_code == 200
        assert issue(browser, version=2).status_code == 503
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT * FROM write_operations WHERE key=?", (success,)
                ).fetchall()
                == history
            )
            assert (
                db.execute(
                    "SELECT created_at,expires_at FROM write_operations WHERE key=?",
                    (pending,),
                ).fetchall()
                == expiry
            )


def stopped():
    return [{"ActiveState": "inactive", "MainPID": "0"} for _ in range(2)]


def test_disable_health_failures_leave_intake_closed(ops_storage, monkeypatch):
    import fcntl

    from app.operational_commands import disable_health
    from tests.test_ops_check import settings_for

    database, _ = ops_storage
    activation = database.parent / "activation.json"
    lock = database.parent / "worker.lock"
    lock.write_bytes(b"")
    lock.chmod(0o600)
    settings = settings_for(database).model_copy(
        update={"health_activation_path": activation, "health_worker_lock_path": lock}
    )

    def supply():
        activation.write_text('{"version":1,"synthetic":true}')
        activation.chmod(0o600)

    supply()
    with lock.open("rb") as holder:
        fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert disable_health(settings) == 3
        assert not activation.exists()
    assert disable_health(settings) == 0
    supply()
    with sqlite3.connect(database) as db:
        db.execute("BEGIN IMMEDIATE")
        result = command(
            database,
            "disable-health",
            HEALTH_ACTIVATION_PATH=str(activation),
            HEALTH_WORKER_LOCK_PATH=str(lock),
        )
        assert result.returncode == 1
        assert not activation.exists()
    supply()
    original_fsync = os.fsync
    monkeypatch.setattr(
        os, "fsync", lambda _: (_ for _ in ()).throw(OSError("sentinel"))
    )
    with pytest.raises(OSError):
        disable_health(settings)
    assert not activation.exists()
    monkeypatch.setattr(os, "fsync", original_fsync)
    source = database.parent / "unsafe-source.json"
    source.write_text('{"version":1}')
    source.chmod(0o600)
    for link in ("symlink", "hardlink"):
        if link == "symlink":
            activation.symlink_to(source)
        else:
            os.link(source, activation)
        with pytest.raises((OSError, ValueError)):
            disable_health(settings)
        assert source.read_text() == '{"version":1}'
        activation.unlink()
    supply()
    activation.chmod(0o644)
    with pytest.raises(ValueError):
        disable_health(settings)
    assert activation.exists()


def test_rotate_reset_key_refuses_active_api_and_failed_invalidation(
    make_test_app, tmp_path, monkeypatch
):
    from fastapi.testclient import TestClient

    from app.operational_commands import rotate_reset_key
    from tests.password_reset_client import admin, issue, reset_app, result

    app, path, secret = reset_app(make_test_app, tmp_path)
    for file in path.parent.glob(path.name + "*"):
        file.chmod(0o600)
    original = secret.read_bytes()
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        for state in (
            None,
            [{"ActiveState": "active", "MainPID": "0"}] * 2,
            [{"ActiveState": "inactive", "MainPID": "2"}] * 2,
        ):
            assert (
                rotate_reset_key(
                    app.state.settings,
                    generate=True,
                    process_state=lambda state=state: state,
                )
                == 3
            )
            assert secret.read_bytes() == original
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER refuse_invalidation BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'controlled audit failure'); END"
            )
        with pytest.raises(SQLAlchemyError):
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
        assert secret.read_bytes() == original
        assert result(browser, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            db.execute("DROP TRIGGER refuse_invalidation")
            db.execute("BEGIN IMMEDIATE")
            with pytest.raises(SQLAlchemyError):
                rotate_reset_key(
                    app.state.settings, generate=True, process_state=stopped
                )
            assert secret.read_bytes() == original
        reserved = secret.with_name("." + secret.name + ".rotation")
        reserved.write_bytes(b"other rotation")
        reserved.chmod(0o600)
        with pytest.raises(FileExistsError):
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
        assert reserved.read_bytes() == b"other rotation"
        assert secret.read_bytes() == original
        reserved.unlink()
        secret.unlink()
        secret.symlink_to(path)
        with pytest.raises(OSError):
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
        secret.unlink()
    from types import SimpleNamespace

    calls = []

    def active_systemctl(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0, stdout="ActiveState=active\nMainPID=0\n")

    monkeypatch.setattr("app.operational_commands.subprocess.run", active_systemctl)
    production = app.state.settings.model_copy(update={"app_env": "production"})
    assert rotate_reset_key(production, generate=True) == 3
    assert calls == [
        ["/usr/bin/systemctl", "show", "-p", "ActiveState,MainPID", unit]
        for unit in ("eduvibe-api.service", "eduvibe-health-worker.service")
    ]
    with pytest.raises(ValueError):
        rotate_reset_key(production, generate=True, process_state=stopped)


def test_rotate_reset_key_loss_requires_explicit_generation(make_test_app, tmp_path):
    from fastapi.testclient import TestClient

    from app.operational_commands import rotate_reset_key
    from app.password_reset_secret import load_secret
    from tests.password_reset_client import (
        admin,
        cancel,
        execute,
        issue,
        reset_app,
        result,
    )

    app, path, secret = reset_app(make_test_app, tmp_path)
    for file in path.parent.glob(path.name + "*"):
        file.chmod(0o600)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        secret.unlink()
        assert (
            rotate_reset_key(app.state.settings, generate=False, process_state=stopped)
            == 0
        )
        assert not secret.exists()
        assert result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"
        assert cancel(browser, key).status_code == 200
        assert issue(browser).status_code == execute(browser, key).status_code == 503
        assert (
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
            == 0
        )
        assert load_secret(secret) is not None
        assert issue(browser).status_code == 503  # Existing process remains latched.


def test_rotate_reset_key_interruption_never_reopens_old_work(
    make_test_app, tmp_path, monkeypatch
):
    from fastapi.testclient import TestClient

    from app.operational_commands import rotate_reset_key
    from tests.password_reset_client import admin, issue, reset_app, result

    app, path, secret = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        for file in path.parent.glob(path.name + "*"):
            file.chmod(0o600)
        original = secret.read_bytes()
        replace = os.replace
        monkeypatch.setattr(
            os,
            "replace",
            lambda *a, **k: (_ for _ in ()).throw(OSError("publication failure")),
        )
        with pytest.raises(OSError):
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
        assert secret.read_bytes() == original
        assert result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"
        monkeypatch.setattr(os, "replace", replace)
        assert (
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
            == 0
        )
        assert result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"

        fsync = os.fsync
        calls = 0

        def fail_parent(descriptor):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("publication durability unconfirmed")
            fsync(descriptor)

        monkeypatch.setattr(os, "fsync", fail_parent)
        with pytest.raises(OSError):
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
        assert result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"
        monkeypatch.setattr(os, "fsync", fsync)
        assert (
            rotate_reset_key(app.state.settings, generate=True, process_state=stopped)
            == 0
        )
