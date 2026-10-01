import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.auth_client import API, Browser, signed_in
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


def test_normal_restart_keeps_the_success_the_session_and_the_original_clock(
    member_app, server_clock
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        expires_at = browser.me().json()["expires_at"]
        cookies = dict(client.cookies)
        generation = browser.generation
    server_clock[0] += timedelta(minutes=10)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        browser.client = restarted
        me = browser.me()
        assert me.status_code == 200 and me.json()["expires_at"] == expires_at
        state = browser.state(transition_id=f"{browser.flow}.4")
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
