"""Real verifier, delayed socket HTTP, file SQLite and real process death."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from tests.auth_client import API, Browser
from tests.contracts.test_auth_password import NEW_PASSWORD, temporary_admin
from tests.support import AUTH_MEMBERS, AUTH_PASSWORD


@pytest.mark.parametrize("stage", ["before_claim", "hash_return"])
@pytest.mark.parametrize("operation", ["login", "reauthenticate"])
def test_settle_fences_the_actual_worker_before_it_can_commit(
    process_server, stage, operation
):
    server, database = process_server
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        if operation == "reauthenticate":
            assert browser.login(AUTH_MEMBERS["admin"][1]).status_code == 200
        permit = browser.admit(operation).json()
        server.command(action="arm", stage=stage)

        def execute():
            if operation == "login":
                return browser.execute_login(permit, AUTH_MEMBERS["approved"][1])
            return client.post(
                f"{API}/reauth",
                json={"password": AUTH_PASSWORD},
                headers=browser.session_headers(permit),
            )

        pending = workers.submit(execute)
        try:
            server.wait()
            state = browser.state(transition_id=permit["transition_id"])
            assert state["requested_transition"]["state"] == (
                "admitted" if stage == "before_claim" else "executing"
            )
            settled = client.post(
                f"{API}/transitions/{permit['transition_id']}/settle",
                json={"flow_id": browser.flow, "expected_revision": state["revision"]},
                headers=browser.recovery_headers(),
            )
            assert settled.status_code == 200
            assert settled.json()["result"]["state"] == "cancelled"
        finally:
            server.command(action="release")
        late = pending.result(timeout=5)
        assert late.status_code == 409
        assert late.json()["error"]["code"] == "AUTH_STATE_CHANGED"
        assert "set-cookie" not in late.headers
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE kind='full'"
            ).fetchone() == (1 if operation == "reauthenticate" else 0,)


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_actual_hashing_cannot_finalize_at_or_after_the_permit_boundary(
    process_server, offset
):
    server, database = process_server
    start = datetime(2026, 10, 1, tzinfo=UTC)
    server.command(action="clock", at=start.isoformat())
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        server.command(action="arm", stage="hash_return")
        pending = workers.submit(
            browser.execute_login, permit, AUTH_MEMBERS["approved"][1]
        )
        try:
            server.wait()
            server.command(
                action="clock",
                at=(start + timedelta(seconds=60, microseconds=offset)).isoformat(),
            )
        finally:
            server.command(action="release")
        response = pending.result(timeout=5)
        assert response.status_code == (200 if offset < 0 else 409)
        assert ("set-cookie" in response.headers) is (offset < 0)
        state = browser.state(transition_id=permit["transition_id"])
        assert state["requested_transition"]["state"] == (
            "succeeded" if offset < 0 else "expired"
        )
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE kind='full'"
            ).fetchone() == (1 if offset < 0 else 0,)


@pytest.mark.parametrize("operation", ["login", "password_change", "reauthenticate"])
@pytest.mark.parametrize(
    "stage", ["before_claim", "hash_return", "before_commit", "committed"]
)
def test_process_death_distinguishes_rollback_from_committed_success(
    process_server, stage, operation
):
    server, database = process_server
    if operation == "password_change":
        temporary_admin(database)
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        if operation in ("password_change", "reauthenticate"):
            assert browser.login(AUTH_MEMBERS["admin"][1]).status_code == 200
        permit = browser.admit(operation).json()
        cookies = dict(client.cookies)
        server.command(action="arm", stage=stage)

        def execute():
            if operation == "login":
                return browser.execute_login(permit, AUTH_MEMBERS["approved"][1])
            return client.post(
                f"{API}/reauth" if operation == "reauthenticate" else f"{API}/password",
                json={
                    "password": AUTH_PASSWORD
                    if operation == "reauthenticate"
                    else NEW_PASSWORD
                },
                headers=browser.session_headers(permit),
            )

        pending = workers.submit(execute)
        server.wait()
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT state FROM auth_transitions WHERE transition_id=?",
                (permit["transition_id"],),
            ).fetchone() == (
                "succeeded"
                if stage == "committed"
                else "admitted"
                if stage == "before_claim"
                else "executing",
            )
        server.kill()
        with pytest.raises(httpx.TransportError):
            pending.result(timeout=5)
        # Same DB/ledger, no migration, fixture injection or bootstrap on restart.
        server.start()
        client.cookies.update(cookies)
        state = browser.state(transition_id=permit["transition_id"])
        assert state["pending_transition"] is None
        assert state["requested_transition"]["state"] == (
            "succeeded" if stage == "committed" else "cancelled"
        )
        assert state["session_cookie_present"] is (stage != "committed")
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE kind='full'"
            ).fetchone() == (
                (2 if stage == "committed" else 1)
                if operation == "reauthenticate"
                else (1 if stage == "committed" else 0),
            )
        if operation == "password_change":
            with sqlite3.connect(database) as db:
                assert db.execute(
                    "SELECT must_change_password, account_version FROM members WHERE login_id='admin-user'"
                ).fetchone() == ((0, 2) if stage == "committed" else (1, 1))
        late = execute()
        assert late.status_code == (401 if stage == "committed" else 409)
        assert "set-cookie" not in late.headers


@pytest.mark.parametrize("winner", ["worker", "rotate"])
@pytest.mark.parametrize("operation", ["login", "password_change", "reauthenticate"])
def test_rotation_and_real_worker_have_one_serialized_winner(
    process_server, winner, operation
):
    server, database = process_server
    if operation == "password_change":
        temporary_admin(database)
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        if operation in ("password_change", "reauthenticate"):
            assert browser.login(AUTH_MEMBERS["admin"][1]).status_code == 200
        permit = browser.admit(operation).json()
        old_generation = browser.generation
        old_headers = browser.session_headers()
        server.command(action="arm", stage="hash_return")

        def execute():
            if operation == "login":
                return browser.execute_login(permit, AUTH_MEMBERS["approved"][1])
            return client.post(
                f"{API}/reauth" if operation == "reauthenticate" else f"{API}/password",
                json={
                    "password": AUTH_PASSWORD
                    if operation == "reauthenticate"
                    else NEW_PASSWORD
                },
                headers=browser.session_headers(permit),
            )

        pending = workers.submit(execute)
        server.wait()

        def rotate():
            return client.post(
                f"{API}/flows/{browser.flow}/recovery-cookie/rotate",
                json={
                    "expected_revision": permit["revision"],
                    "expected_session_generation": old_generation,
                },
                headers=old_headers,
            )

        if winner == "rotate":
            rotated = rotate()
            assert rotated.status_code == 201
        server.command(action="release")
        result = pending.result(timeout=5)
        if winner == "worker":
            assert result.status_code == 200
            stale_rotate = rotate()
            assert stale_rotate.status_code == 403
            assert stale_rotate.json()["error"]["code"] == "CSRF_INVALID"
            state = browser.state(transition_id=permit["transition_id"])
            settled = client.post(
                f"{API}/transitions/{permit['transition_id']}/settle",
                json={"flow_id": browser.flow, "expected_revision": state["revision"]},
                headers=browser.recovery_headers(),
            )
            assert settled.status_code == 200
            assert settled.json()["result"]["state"] == "succeeded"
        else:
            assert result.status_code == 409 and "set-cookie" not in result.headers
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT state FROM auth_transitions WHERE transition_id=?",
                (permit["transition_id"],),
            ).fetchone() == ("succeeded" if winner == "worker" else "cancelled",)
            if operation == "password_change":
                assert db.execute(
                    "SELECT must_change_password FROM members WHERE login_id='admin-user'"
                ).fetchone() == (0 if winner == "worker" else 1,)


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_password_finalization_at_temporary_credential_boundary(process_server, offset):
    server, database = process_server
    start = datetime(2026, 10, 1, tzinfo=UTC)
    deadline = start + timedelta(seconds=30)
    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE members SET must_change_password=1, temporary_password_expires_at=? WHERE login_id='admin-user'",
            (deadline.isoformat(timespec="microseconds").replace("+00:00", "Z"),),
        )
    server.command(action="clock", at=start.isoformat())
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(AUTH_MEMBERS["admin"][1]).status_code == 200
        permit = browser.admit("password_change").json()
        server.command(action="arm", stage="hash_return")
        pending = workers.submit(
            client.post,
            f"{API}/password",
            json={"password": NEW_PASSWORD},
            headers=browser.session_headers(permit),
        )
        server.wait()
        server.command(
            action="clock", at=(deadline + timedelta(microseconds=offset)).isoformat()
        )
        server.command(action="release")
        result = pending.result(timeout=5)
        assert result.status_code == (200 if offset < 0 else 401)
        assert ("set-cookie" in result.headers) is (offset < 0)
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT must_change_password,account_version FROM members WHERE login_id='admin-user'"
            ).fetchone() == ((0, 2) if offset < 0 else (1, 1))
