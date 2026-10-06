"""Real Argon2 barriers and separate SQLite connections fence reauthentication."""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.auth_client import API, signed_in
from tests.contracts.test_auth_login import rows
from tests.contracts.test_auth_reauth import ADMIN, execute
from tests.support import AUTH_PASSWORD


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


@pytest.mark.parametrize(
    "mutation,status",
    [
        ("version", 409),
        ("hash", 409),
        ("role", 403),
        ("approval", 401),
        ("must_change", 403),
        ("session", 401),
        ("delete_member", 401),
        ("permit", 409),
        ("settle", 409),
        ("cli", 401),
    ],
)
def test_live_context_is_rechecked_after_real_hash(
    member_app, monkeypatch, mutation, status
):
    from app import auth_login
    from tests.admin_cli import run_admin_cli

    app, path = member_app()
    entered, release = threading.Event(), threading.Event()
    real = auth_login.argon2_verify
    with TestClient(app) as client, ThreadPoolExecutor() as workers:
        browser = signed_in(client, "admin")
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201

        def delayed(stored, password):
            answer = real(stored, password)
            entered.set()
            assert release.wait(10)
            return answer

        monkeypatch.setattr(auth_login, "argon2_verify", delayed)
        pending = workers.submit(execute, browser, permit.json())
        try:
            assert entered.wait(10)
            statements = {
                "version": "UPDATE members SET account_version=account_version+1 WHERE login_id='admin-user'",
                "hash": "UPDATE members SET password_hash='unusable' WHERE login_id='admin-user'",
                "role": "UPDATE members SET is_admin=0 WHERE login_id='admin-user'",
                "approval": "UPDATE members SET approval_status='revoked' WHERE login_id='admin-user'",
                "must_change": "UPDATE members SET must_change_password=1 WHERE login_id='admin-user'",
                "session": "UPDATE sessions SET revoked_at='2026-10-01T00:00:00.000000Z' WHERE kind='full'",
                "delete_member": "DELETE FROM members WHERE login_id='admin-user'",
                "permit": "UPDATE auth_transitions SET permit_expires_at='2000-01-01T00:00:00.000000Z' WHERE kind='reauthenticate'",
            }
            if mutation == "settle":
                result = client.post(
                    f"{API}/transitions/{permit.json()['transition_id']}/settle",
                    json={
                        "flow_id": browser.flow,
                        "expected_revision": permit.json()["revision"],
                    },
                    headers=browser.recovery_headers(),
                )
                assert result.status_code == 200
            elif mutation == "cli":
                result, output = run_admin_cli(
                    "recover-admin",
                    path,
                    app.state.settings.password_blocklist_path,
                    [
                        ("Login ID: ", ADMIN),
                        ("Temporary password: ", AUTH_PASSWORD),
                        ("Confirm temporary password: ", AUTH_PASSWORD),
                        ("Type YES to confirm: ", "YES"),
                    ],
                )
                assert result == 0 and AUTH_PASSWORD not in output
            else:
                with sqlite3.connect(path) as db:
                    db.execute(statements[mutation])
        finally:
            release.set()
        result = pending.result(timeout=10)
        assert result.status_code == status, result.text
        assert "set-cookie" not in result.headers
        assert rows(path, "SELECT count(*) AS n FROM sessions WHERE kind='full'") == [
            {"n": 1}
        ]
        assert (
            rows(
                path,
                "SELECT * FROM rate_limit_events WHERE purpose IN ('login_account','login_ip')",
            )
            == []
        )


@pytest.mark.parametrize("deadline", ["permit", "absolute", "idle"])
@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_finalization_observes_both_expiry_orders_and_exact_boundaries(
    member_app, monkeypatch, server_clock, deadline, offset
):
    from app import auth_login

    app, path = member_app()
    entered, release = threading.Event(), threading.Event()
    real = auth_login.argon2_verify
    with TestClient(app) as client, ThreadPoolExecutor() as workers:
        browser = signed_in(client, "admin")
        at = server_clock[0] + timedelta(seconds=60 if deadline == "permit" else 30)
        if deadline != "permit":
            column = "absolute_expires_at" if deadline == "absolute" else "expires_at"
            with sqlite3.connect(path) as db:
                db.execute(
                    f"UPDATE sessions SET {column}=? WHERE kind='full'",
                    (at.isoformat(timespec="microseconds").replace("+00:00", "Z"),),
                )
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201

        def delayed(stored, password):
            answer = real(stored, password)
            entered.set()
            assert release.wait(10)
            return answer

        monkeypatch.setattr(auth_login, "argon2_verify", delayed)
        pending = workers.submit(execute, browser, permit.json())
        try:
            assert entered.wait(10)
            server_clock[0] = at + timedelta(microseconds=offset)
        finally:
            release.set()
        result = pending.result(timeout=10)
        assert result.status_code == (
            200 if offset < 0 else (409 if deadline == "permit" else 401)
        ), result.text
        assert ("set-cookie" in result.headers) is (offset < 0)


def test_duplicate_execution_during_hash_never_mints_two_sessions(
    member_app, monkeypatch
):
    from app import auth_login

    app, path = member_app()
    entered, release = threading.Event(), threading.Event()
    real = auth_login.argon2_verify
    with TestClient(app) as client, ThreadPoolExecutor() as workers:
        browser = signed_in(client, "admin")
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201

        def delayed(stored, password):
            result = real(stored, password)
            entered.set()
            assert release.wait(10)
            return result

        monkeypatch.setattr(auth_login, "argon2_verify", delayed)
        pending = workers.submit(execute, browser, permit.json())
        try:
            assert entered.wait(10)
            assert (
                execute(
                    browser, permit.json(), "different synthetic password 1234"
                ).status_code
                == 409
            )
        finally:
            release.set()
        assert pending.result(timeout=10).status_code == 200
        assert rows(
            path,
            "SELECT count(*) AS n FROM sessions WHERE kind='full' AND revoked_at IS NULL",
        ) == [{"n": 1}]


@pytest.mark.parametrize("deadline", ["permit", "absolute", "flow"])
def test_allocation_cannot_cross_the_live_authority_deadline(
    member_app, monkeypatch, server_clock, deadline
):
    from app import auth_login

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        at = server_clock[0] + timedelta(seconds=60 if deadline == "permit" else 30)
        if deadline == "absolute":
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE sessions SET absolute_expires_at=? WHERE kind='full'",
                    (at.isoformat(timespec="microseconds").replace("+00:00", "Z"),),
                )
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201
        if deadline == "flow":
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE auth_flows SET expires_at=? WHERE id=?",
                    (
                        at.isoformat(timespec="microseconds").replace("+00:00", "Z"),
                        browser.flow,
                    ),
                )
        real = auth_login.cookie_budget

        def allocate(*args):
            real(*args)
            server_clock[0] = at

        monkeypatch.setattr(auth_login, "cookie_budget", allocate)
        result = execute(browser, permit.json())
        assert result.status_code == (409 if deadline == "permit" else 401), result.text
        assert "set-cookie" not in result.headers
        assert rows(path, "SELECT count(*) AS n FROM sessions WHERE kind='full'") == [
            {"n": 1}
        ]
