"""Startup and CLI boundaries handle transient deletion storage failures safely."""

import os
import sqlite3
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from app import app_deletion_ledger


def test_startup_delivery_read_lock_leaves_service_running_not_ready(
    member_app, monkeypatch
):
    app, _ = member_app()
    operational = app_deletion_ledger._operational
    reads = 0

    def lock_after_verification(factory, deadline):
        nonlocal reads
        reads += 1
        if reads == 2:
            raise sqlite3.OperationalError("database is locked")
        return operational(factory, deadline)

    monkeypatch.setattr(app_deletion_ledger, "_operational", lock_after_verification)
    with TestClient(app) as client:
        assert reads == 2
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 503
        assert not client.get("/api/v1/meta").json()["capabilities"]["auth_login"][
            "enabled"
        ]


@pytest.mark.parametrize("command", ["sweep-pending", "invalidate-restored-auth"])
def test_maintenance_cli_reports_sqlite_failure_without_traceback(member_app, command):
    app, path = member_app()
    with TestClient(app):
        pass  # Initialize the current independent ledger before either CLI path.
    script = """import sqlite3
from app import app_deletion_ledger
from app.cli import main
operational = app_deletion_ledger._operational
reads = 0
def lock_after_verification(factory, deadline):
    global reads
    reads += 1
    if reads == 2:
        raise sqlite3.OperationalError('database is locked: private storage detail')
    return operational(factory, deadline)
app_deletion_ledger._operational = lock_after_verification
raise SystemExit(main())
"""
    result = subprocess.run(
        [sys.executable, "-c", script, command],
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr == (
        "Pending maintenance or restore verification failed; "
        "service must remain unavailable.\n"
    )
