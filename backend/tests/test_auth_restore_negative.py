"""Real restore CLI failures and auth readiness are separate observations."""

import sqlite3
import subprocess
import sys
from datetime import UTC, datetime, timedelta

import pytest

from tests.auth_client import signed_in
from tests.auth_process import BACKEND
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("fault", ["missing", "corrupt", "stale", "reference", "audit"])
def test_failed_restore_cli_never_proves_readiness(process_server, fault):
    server, database = process_server
    with server.client() as client:
        browser = signed_in(client)
        flow_id = browser.flow
    server.kill()
    ledger = database.with_suffix(".deletions.sqlite3")
    if fault == "missing":
        ledger.unlink()
    elif fault == "corrupt":
        ledger.write_bytes(b"controlled corrupt ledger")
    elif fault == "stale":
        expired = (
            (datetime.now(UTC) - timedelta(days=91))
            .isoformat(timespec="microseconds")
            .replace("+00:00", "Z")
        )
        with sqlite3.connect(database) as db:
            db.execute(
                "UPDATE members SET created_at=? WHERE id=?",
                (expired, AUTH_MEMBERS["pending"][0]),
            )
        result = subprocess.run(
            [sys.executable, "-m", "app.cli", "sweep-pending"],
            cwd=BACKEND,
            env=server.env,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0
        with sqlite3.connect(ledger) as db:
            db.execute("DELETE FROM member_deletions")
    elif fault == "reference":
        with sqlite3.connect(database) as db:
            db.execute(
                "UPDATE auth_flows SET current_session_generation='999' WHERE id=?",
                (flow_id,),
            )
    else:
        with sqlite3.connect(database) as db:
            db.execute(
                "CREATE TRIGGER refuse_invalidation BEFORE INSERT ON audit_logs WHEN NEW.action='invalidate_restored_auth' BEGIN SELECT RAISE(ABORT,'controlled audit failure'); END"
            )
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "invalidate-restored-auth"],
        cwd=BACKEND,
        env=server.env,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT revoked_at IS NULL FROM auth_flows WHERE id=?", (flow_id,)
        ).fetchone() == (1,)
    # Failed CLI means keep stopped. Startup below is a deliberate negative readiness probe,
    # not the operating procedure or permission to serve a failed restore.
    if fault in {"corrupt", "stale", "reference"}:
        server.start()
        with server.client() as client:
            assert client.get("/healthz").status_code == 200
            assert client.get("/readyz").status_code == 503
            assert not client.get("/api/v1/meta").json()["capabilities"]["auth_login"][
                "enabled"
            ]
            assert (
                client.post(
                    "/api/v1/auth/flows",
                    json={"restart_from": []},
                    headers={"Origin": "http://localhost:5174"},
                ).status_code
                == 503
            )


def test_transient_maintenance_lock_drops_readiness_and_reconciles_on_next_cycle(
    process_server,
):
    import time

    server, database = process_server
    with server.client() as client:
        signed_in(client)
        with sqlite3.connect(database) as lock:
            lock.execute("BEGIN IMMEDIATE")
            assert server.command(action="maintenance")["tick"]
            deadline = time.monotonic() + 8
            while client.get("/readyz").status_code != 503:
                assert time.monotonic() < deadline
                time.sleep(0.02)
            assert not client.get("/api/v1/meta").json()["capabilities"]["auth_login"][
                "enabled"
            ]
            assert client.get("/api/v1/apps").status_code == 200
            lock.rollback()
        assert server.command(action="maintenance")["tick"]
        deadline = time.monotonic() + 5
        while client.get("/readyz").status_code != 200:
            assert time.monotonic() < deadline
            time.sleep(0.02)
        assert client.get("/api/v1/meta").json()["capabilities"]["auth_login"][
            "enabled"
        ]
