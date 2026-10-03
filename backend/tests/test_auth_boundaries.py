"""Authoritative microsecond boundaries over real socket HTTP and file SQLite."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from tests.auth_client import API, Browser
from tests.contracts.test_auth_password import temporary_admin
from tests.support import AUTH_MEMBERS

START = datetime(2026, 10, 1, tzinfo=UTC)


@pytest.mark.parametrize("offset", [-1, 0, 1])
@pytest.mark.parametrize("kind", ["anonymous", "full", "change_only", "flow"])
def test_socket_expiry_and_nonrenewing_observations(process_server, kind, offset):
    server, database = process_server
    if kind == "change_only":
        temporary_admin(database)
    server.command(action="clock", at=START.isoformat())
    with server.client() as client:
        browser = Browser(client).prepare().anonymous()
        if kind in {"full", "change_only"}:
            assert (
                browser.login(
                    AUTH_MEMBERS["admin" if kind == "change_only" else "approved"][1]
                ).status_code
                == 200
            )
        with sqlite3.connect(database) as db:
            before = db.execute(
                "SELECT expires_at,absolute_expires_at FROM sessions WHERE flow_id=? AND issued_seq=?",
                (browser.flow, browser.generation),
            ).fetchone()
        if kind == "full":
            # Legitimate R rotation keeps flow live, without renewing S idle time.
            server.command(
                action="clock", at=(START + timedelta(minutes=20)).isoformat()
            )
            rotated = client.post(
                f"{API}/flows/{browser.flow}/recovery-cookie/rotate",
                json={
                    "expected_revision": browser.state()["revision"],
                    "expected_session_generation": browser.generation,
                },
                headers=browser.session_headers(),
            )
            assert rotated.status_code == 201
            browser.revision = rotated.json()["revision"]
        minutes = 30 if kind in {"full", "flow"} else 15
        server.command(
            action="clock",
            at=(START + timedelta(minutes=minutes, microseconds=offset)).isoformat(),
        )
        result = client.get(
            f"{API}/flow-state", headers={"X-EduVibe-Flow-Id": browser.flow}
        )
        if kind == "flow":
            assert result.status_code == (200 if offset < 0 else 401)
            assert "set-cookie" not in result.headers or all(
                "Max-Age=0" in value for value in result.headers.get_list("set-cookie")
            )
        else:
            assert result.status_code == 200
            assert result.json()["session_generation"] == (
                browser.generation if offset < 0 else None
            )
            csrf = client.get(
                f"{API}/csrf", headers={"X-EduVibe-Flow-Id": browser.flow}
            )
            assert csrf.status_code == (200 if offset < 0 else 401)
            me = browser.me()
            assert me.status_code == (
                200 if offset < 0 and kind != "anonymous" else 401
            )
        with sqlite3.connect(database) as db:
            assert (
                db.execute(
                    "SELECT expires_at,absolute_expires_at FROM sessions WHERE flow_id=? AND issued_seq=?",
                    (browser.flow, browser.generation),
                ).fetchone()
                == before
            )


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_absolute_eight_hours_caps_legitimate_private_screen_activity(
    process_server, offset
):
    from tests.support import populate_public_and_private_apps

    server, database = process_server
    populate_public_and_private_apps(database)
    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE apps SET owner_id=? WHERE id='00000000-0000-4000-8000-000000000003'",
            (AUTH_MEMBERS["approved"][0],),
        )
    server.command(action="clock", at=START.isoformat())
    with server.client() as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(AUTH_MEMBERS["approved"][1]).status_code == 200
        headers = {
            "X-EduVibe-Flow-Id": browser.flow,
            "X-EduVibe-Auth-Revision": browser.revision,
            "X-EduVibe-Session-Generation": browser.generation,
        }
        for minutes in range(20, 480, 20):
            server.command(
                action="clock", at=(START + timedelta(minutes=minutes)).isoformat()
            )
            assert (
                client.get(
                    "/api/v1/apps/00000000-0000-4000-8000-000000000003", headers=headers
                ).status_code
                == 200
            )
        server.command(
            action="clock",
            at=(START + timedelta(hours=8, microseconds=offset)).isoformat(),
        )
        assert client.get(
            "/api/v1/apps/00000000-0000-4000-8000-000000000003", headers=headers
        ).status_code == (200 if offset < 0 else 404)
        assert browser.me().status_code == (200 if offset < 0 else 401)
        with sqlite3.connect(database) as db:
            idle, absolute = db.execute(
                "SELECT expires_at,absolute_expires_at FROM sessions WHERE flow_id=? AND issued_seq=?",
                (browser.flow, browser.generation),
            ).fetchone()
            assert idle <= absolute == "2026-10-01T08:00:00.000000Z"


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_live_flow_result_read_cutoff_then_sweep_preserves_execution_fence(
    process_server, offset
):
    from tests.support import populate_public_and_private_apps

    server, database = process_server
    populate_public_and_private_apps(database)
    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE apps SET owner_id=? WHERE id='00000000-0000-4000-8000-000000000003'",
            (AUTH_MEMBERS["approved"][0],),
        )
    server.command(action="clock", at=START.isoformat())
    with server.client() as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        assert (
            browser.execute_login(permit, AUTH_MEMBERS["approved"][1]).status_code
            == 200
        )
        headers = {
            "X-EduVibe-Flow-Id": browser.flow,
            "X-EduVibe-Auth-Revision": browser.revision,
            "X-EduVibe-Session-Generation": browser.generation,
        }
        server.command(action="clock", at=(START + timedelta(minutes=20)).isoformat())
        assert (
            client.get(
                "/api/v1/apps/00000000-0000-4000-8000-000000000003", headers=headers
            ).status_code
            == 200
        )
        server.command(
            action="clock",
            at=(START + timedelta(minutes=30, microseconds=offset)).isoformat(),
        )
        result = browser.state(transition_id=permit["transition_id"])[
            "requested_transition"
        ]
        assert result["availability"] == ("available" if offset < 0 else "unavailable")
        if offset >= 0:
            assert result["execution_blocked"] and result["state"] is None
        for minutes in [40, 60]:
            server.command(
                action="clock", at=(START + timedelta(minutes=minutes)).isoformat()
            )
            assert (
                client.get(
                    "/api/v1/apps/00000000-0000-4000-8000-000000000003", headers=headers
                ).status_code
                == 200
            )
        assert server.command(action="sweep")["swept"]
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT count(*) FROM auth_transitions WHERE transition_id=?",
                (permit["transition_id"],),
            ).fetchone() == (0,)
        old = browser.state(transition_id=permit["transition_id"])[
            "requested_transition"
        ]
        assert old["availability"] == "unavailable" and old["execution_blocked"]
        assert (
            browser.execute_login(permit, AUTH_MEMBERS["approved"][1]).status_code
            == 409
        )
