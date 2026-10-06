import sqlite3
import subprocess
import sys
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.auth_client import API, Browser, signed_in
from tests.auth_process import BACKEND, AuthProcess
from tests.support import AUTH_MEMBERS

APPROVED = AUTH_MEMBERS["approved"][1]


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


@pytest.mark.parametrize("reauthenticated", [False, True])
def test_normal_restart_keeps_the_success_the_session_and_the_original_clock(
    member_app, server_clock, reauthenticated
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin" if reauthenticated else "approved")
        transition_id = f"{browser.flow}.4"
        if reauthenticated:
            from tests.contracts.test_auth_reauth import execute

            permit = browser.admit("reauthenticate").json()
            transition_id = permit["transition_id"]
            assert execute(browser, permit).status_code == 200
        expires_at = browser.me().json()["expires_at"]
        cookies = dict(client.cookies)
        generation = browser.generation
    server_clock[0] += timedelta(minutes=10)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        browser.client = restarted
        me = browser.me()
        assert me.status_code == 200 and me.json()["expires_at"] == expires_at
        state = browser.state(transition_id=transition_id)
        assert state["session_generation"] == generation
        assert state["requested_transition"]["state"] == "succeeded"
        assert state["requested_transition"]["result_session_generation"] == generation
    server_clock[0] += timedelta(minutes=20)  # the original 30-minute boundary holds
    with TestClient(app) as later:
        later.cookies.update(cookies)
        browser.client = later
        assert browser.me().status_code == 401


def test_restart_cancels_an_executing_login_so_a_late_execution_cannot_commit(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        with sqlite3.connect(path) as db:  # the process died after spending the permit
            db.execute(
                "UPDATE auth_transitions SET state='executing' WHERE kind='login'"
            )
        cookies = dict(client.cookies)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        browser.client = restarted
        state = browser.state(transition_id=permit["transition_id"])
        assert state["pending_transition"] is None
        assert state["requested_transition"]["state"] == "cancelled"
        late = browser.execute_login(permit, APPROVED)
        assert late.json()["error"]["code"] == "AUTH_STATE_CHANGED"
        assert browser.state()["session_generation"] == browser.generation


def test_logout_survives_a_restart(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        assert browser.logout().status_code == 204
        cookies = dict(client.cookies)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        browser.client = restarted
        assert browser.state()["session_generation"] is None
        assert (
            restarted.post(
                f"{API}/logout", headers={"Origin": "http://localhost:5174"}
            ).status_code
            == 204
        )


def test_real_restart_then_operational_backup_restore_uses_the_current_deletion_ledger(
    member_app, password_blocklist
):
    _, path = member_app()
    server = AuthProcess(path, password_blocklist)
    backup = path.with_name("snapshot.sqlite3")
    try:
        server.start()
        with server.client() as client:
            admin = signed_in(client, "admin")
            expires = admin.me().json()["expires_at"]
            headers = {
                **admin.session_headers(),
                "X-EduVibe-Auth-Revision": admin.revision,
            }

            def issue(target):
                response = client.post(
                    "/api/v1/write-operations",
                    headers=headers,
                    json={
                        "kind": "user_approval",
                        "target_id": target,
                        "expected_account_version": 1,
                        "approved": True,
                    },
                )
                assert response.status_code == 201
                return response.json()["key"]

            unresolved = issue(AUTH_MEMBERS["pending"][0])
            resolved = issue(AUTH_MEMBERS["revoked"][0])
            assert (
                client.patch(
                    f"/api/v1/admin/users/{AUTH_MEMBERS['revoked'][0]}/approval",
                    headers={**headers, "Idempotency-Key": resolved},
                    json={"expected_account_version": 1, "approved": True},
                ).status_code
                == 200
            )
            server.kill()
            server.start()  # no fixture injection, bootstrap or migration
            assert admin.me().json()["expires_at"] == expires
            for key, state in ((resolved, "succeeded"), (unresolved, "unresolved")):
                result = client.get(f"/api/v1/write-operations/{key}", headers=headers)
                assert result.status_code == 200 and result.json()["state"] == state
            with sqlite3.connect(path) as db, sqlite3.connect(backup) as snapshot:
                db.backup(snapshot)  # consistent SQLite backup, including live WAL
            # Delete after the snapshot into the current independent durable ledger.
            expired = (datetime.now(UTC) - timedelta(days=90, seconds=1)).isoformat()
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET created_at=? WHERE id=?",
                    (expired, AUTH_MEMBERS["pending"][0]),
                )
            deletion = subprocess.run(
                [sys.executable, "-m", "app.cli", "sweep-pending"],
                env=server.env,
                cwd=BACKEND,
                capture_output=True,
                check=False,
            )
            assert deletion.returncode == 0
            assert admin.logout().status_code == 204
            server.kill()
            with sqlite3.connect(backup) as snapshot, sqlite3.connect(path) as db:
                snapshot.backup(db)  # operational DB only; ledger never rolled back
            invalidation = subprocess.run(
                [sys.executable, "-m", "app.cli", "invalidate-restored-auth"],
                env=server.env,
                cwd=BACKEND,
                capture_output=True,
                check=False,
            )
            assert invalidation.returncode == 0
            with sqlite3.connect(path) as db:
                assert db.execute(
                    "SELECT count(*) FROM members WHERE id=?",
                    (AUTH_MEMBERS["pending"][0],),
                ).fetchone() == (0,)
                for table in ("sessions", "auth_flows", "recovery_credentials"):
                    assert db.execute(
                        f"SELECT count(*) FROM {table} WHERE revoked_at IS NULL"
                    ).fetchone() == (0,)
                assert db.execute(
                    "SELECT count(*) FROM write_operations"
                ).fetchone() == (0,)
                assert db.execute(
                    "SELECT count(*) FROM auth_transitions WHERE state IN ('admitted','executing')"
                ).fetchone() == (0,)
            server.start()  # same restored DB and current ledger, no reinjection
            assert admin.me().status_code == 401
            assert client.get("/api/v1/apps").status_code == 200
            assert client.get("/api/v1/meta").json()["capabilities"]["auth_login"][
                "enabled"
            ]
    finally:
        server.close()
