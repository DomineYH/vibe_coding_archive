"""Real verifier, delayed socket HTTP, file SQLite and real process death."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from tests.auth_client import API, Browser
from tests.auth_process import AuthProcess
from tests.support import AUTH_MEMBERS


@pytest.fixture
def process_server(member_app, password_blocklist):
    _, database = member_app()
    server = AuthProcess(database, password_blocklist)
    try:
        server.start()
        yield server, database
    finally:
        server.close()


@pytest.mark.parametrize("stage", ["before_claim", "hash_return"])
def test_settle_fences_the_actual_worker_before_it_can_commit(process_server, stage):
    server, database = process_server
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        server.command(action="arm", stage=stage)
        pending = workers.submit(
            browser.execute_login, permit, AUTH_MEMBERS["approved"][1]
        )
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
            ).fetchone() == (0,)


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


@pytest.mark.parametrize("stage", ["hash_return", "before_commit", "committed"])
def test_process_death_distinguishes_rollback_from_committed_success(
    process_server, stage
):
    server, database = process_server
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        cookies = dict(client.cookies)
        server.command(action="arm", stage=stage)
        pending = workers.submit(
            browser.execute_login, permit, AUTH_MEMBERS["approved"][1]
        )
        server.wait()
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT state FROM auth_transitions WHERE transition_id=?",
                (permit["transition_id"],),
            ).fetchone() == ("succeeded" if stage == "committed" else "executing",)
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
            ).fetchone() == (1 if stage == "committed" else 0,)
        late = browser.execute_login(permit, AUTH_MEMBERS["approved"][1])
        assert late.status_code == (401 if stage == "committed" else 409)
        assert "set-cookie" not in late.headers
