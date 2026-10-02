"""R9 Q18: one-hour removal also applies to credentials in a live flow."""

import sqlite3
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.auth_maintenance import reconcile, sweep
from tests.auth_client import API, Browser, signed_in


def test_live_flow_does_not_keep_obsolete_session_and_rotated_recovery_records(
    member_app, monkeypatch
):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        old_names = list(client.cookies)
        old_recovery = next(name for name in old_names if "recovery" in name)
        original_full = browser.generation
        state = browser.state()
        rotated = client.post(
            f"{API}/flows/{browser.flow}/recovery-cookie/rotate",
            json={
                "expected_revision": state["revision"],
                "expected_session_generation": browser.generation,
            },
            headers=browser.session_headers(),
        )
        assert rotated.status_code == 201
        browser.recovery_csrf = rotated.json()["recovery_csrf_token"]
        ready = client.post(
            f"{API}/flows/{browser.flow}/ready",
            json={"expected_revision": rotated.json()["revision"]},
            headers=browser.recovery_headers(),
        )
        assert ready.status_code == 200
        # R rotation is legitimate flow activity but cannot extend full S.
        value[0] += timedelta(minutes=20)
        rotated = client.post(
            f"{API}/flows/{browser.flow}/recovery-cookie/rotate",
            json={
                "expected_revision": browser.state()["revision"],
                "expected_session_generation": browser.generation,
            },
            headers=browser.session_headers(),
        )
        assert rotated.status_code == 201
        browser.recovery_csrf = rotated.json()["recovery_csrf_token"]
        assert (
            client.post(
                f"{API}/flows/{browser.flow}/ready",
                json={"expected_revision": rotated.json()["revision"]},
                headers=browser.recovery_headers(),
            ).status_code
            == 200
        )
        value[0] += timedelta(minutes=20)
        assert browser.state()["session_generation"] is None
        browser.anonymous()  # renew flow legitimately, no injected expiry rows
        value[0] += timedelta(minutes=20)
        assert browser.state()["expires_at"] > "2026-10-01T01:00:00.000000Z"
        browser.anonymous()
        permit = browser.admit("login").json()
        sweep(app.state.session_factory)
        state = browser.state(transition_id=permit["transition_id"])
        assert state["revision"] == permit["revision"]
        assert state["pending_transition"]["state"] == "admitted"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE flow_id=? AND issued_seq=?",
                (browser.flow, original_full),
            ).fetchone() == (0,)
            assert db.execute(
                "SELECT count(*) FROM recovery_credentials WHERE flow_id=? AND issued_seq='1'",
                (browser.flow,),
            ).fetchone() == (0,)
        # A late actually-issued obsolete name is removable after record deletion.
        client.cookies.set(old_recovery, "invalid-old-proof")
        unknown_name = f"eduvibe_session_dev_{browser.flow}_0"
        client.cookies.set(unknown_name, "never-issued-proof")
        result = client.get(
            f"{API}/flow-state", headers={"X-EduVibe-Flow-Id": browser.flow}
        )
        assert result.status_code == 200
        assert any(
            header.startswith(old_recovery + "=") and "Max-Age=0" in header
            for header in result.headers.get_list("set-cookie")
        )
        assert not any(
            header.startswith(unknown_name + "=")
            for header in result.headers.get_list("set-cookie")
        )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE revoked_at<=? OR expires_at<=?",
                ("2026-10-01T00:30:00.000000Z",) * 2,
            ).fetchone() == (0,)
            assert db.execute(
                "SELECT count(*) FROM recovery_credentials WHERE revoked_at<=?",
                ("2026-10-01T00:30:00.000000Z",),
            ).fetchone() == (0,)
        reconcile(app.state.session_factory)


def test_expired_current_session_can_be_removed_without_breaking_reconciliation(
    member_app, monkeypatch
):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        # The S expires at 15m, flow/R at 30m; sweep at 45m precedes flow retirement.
        value[0] += timedelta(minutes=45)
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM sessions").fetchone() == (0,)
            assert db.execute(
                "SELECT current_session_generation FROM auth_flows"
            ).fetchone() == (None,)
        reconcile(app.state.session_factory)
        assert browser.me().status_code == 401


def test_transient_write_lock_keeps_rows_then_the_same_sweep_retries(
    member_app, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor

    import pytest
    from sqlalchemy.exc import OperationalError

    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client:
        Browser(client).prepare().anonymous()
        value[0] += timedelta(minutes=45)
        with sqlite3.connect(path) as lock, ThreadPoolExecutor() as workers:
            lock.execute("BEGIN IMMEDIATE")
            pending = workers.submit(sweep, app.state.session_factory)
            with pytest.raises(OperationalError):
                pending.result(timeout=10)
            assert lock.execute("SELECT count(*) FROM sessions").fetchone() == (1,)
            lock.rollback()
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM sessions").fetchone() == (0,)
        reconcile(app.state.session_factory)


def test_clearing_expired_current_session_preserves_newer_admission(process_server):
    server, database = process_server
    start = datetime(2026, 10, 1, tzinfo=UTC)
    server.command(action="clock", at=start.isoformat())
    with server.client() as client:
        browser = signed_in(client)

        def admit():
            state = browser.state()
            response = client.post(
                f"{API}/transitions",
                json={
                    "flow_id": browser.flow,
                    "transition_id": state["next_transition_id"],
                    "kind": "anonymous_session",
                    "expected_revision": state["revision"],
                    "expected_session_generation": None,
                },
                headers=browser.recovery_headers(),
            )
            assert response.status_code == 201
            return response.json()

        server.command(action="clock", at=(start + timedelta(minutes=20)).isoformat())
        rotated = client.post(
            f"{API}/flows/{browser.flow}/recovery-cookie/rotate",
            json={
                "expected_revision": browser.state()["revision"],
                "expected_session_generation": browser.generation,
            },
            headers=browser.session_headers(),
        )
        assert rotated.status_code == 201
        browser.recovery_csrf = rotated.json()["recovery_csrf_token"]
        assert (
            client.post(
                f"{API}/flows/{browser.flow}/ready",
                json={"expected_revision": rotated.json()["revision"]},
                headers=browser.recovery_headers(),
            ).status_code
            == 200
        )
        for minutes in (40, 60):
            server.command(
                action="clock", at=(start + timedelta(minutes=minutes)).isoformat()
            )
            permit = admit()
            assert (
                client.post(
                    f"{API}/transitions/{permit['transition_id']}/settle",
                    json={
                        "flow_id": browser.flow,
                        "expected_revision": permit["revision"],
                    },
                    headers=browser.recovery_headers(),
                ).status_code
                == 200
            )
        server.command(action="clock", at=(start + timedelta(minutes=61)).isoformat())
        permit = admit()
        server.command(action="sweep")
        state = browser.state(transition_id=permit["transition_id"])
        assert state["pending_transition"] is not None
        assert state["pending_transition"]["state"] == "admitted"
        assert state["revision"] == permit["revision"]
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT current_session_generation FROM auth_flows WHERE id=?",
                (browser.flow,),
            ).fetchone() == (None,)
        # The client still holding the admitted revision can complete its permit.
        assert (
            client.post(
                f"{API}/anonymous-session",
                json={"expected_revision": permit["revision"]},
                headers={
                    **browser.recovery_headers(),
                    "X-EduVibe-Auth-Revision": permit["revision"],
                    "X-EduVibe-Transition-Id": permit["transition_id"],
                },
            ).status_code
            == 201
        )


def test_obsolete_older_session_preserves_real_executing_login(process_server):
    from concurrent.futures import ThreadPoolExecutor

    from tests.support import AUTH_MEMBERS

    server, database = process_server
    start = datetime(2026, 10, 1, tzinfo=UTC)
    server.command(action="clock", at=start.isoformat())
    with server.client() as client, ThreadPoolExecutor() as workers:
        browser = Browser(client).prepare().anonymous()
        older = browser.generation
        # New anonymous S issuances legitimately keep the flow alive after S expiry.
        for minutes in (20, 40):
            server.command(
                action="clock", at=(start + timedelta(minutes=minutes)).isoformat()
            )
            browser.anonymous()
        server.command(action="clock", at=(start + timedelta(minutes=46)).isoformat())
        permit = browser.admit("login").json()
        server.command(action="arm", stage="hash_return")
        pending = workers.submit(
            browser.execute_login, permit, AUTH_MEMBERS["approved"][1]
        )
        try:
            server.wait()
            server.command(action="sweep")
            state = browser.state(transition_id=permit["transition_id"])
            assert state["pending_transition"]["state"] == "executing"
            assert state["revision"] == permit["revision"]
            with sqlite3.connect(database) as db:
                assert db.execute(
                    "SELECT count(*) FROM sessions WHERE flow_id=? AND issued_seq=?",
                    (browser.flow, older),
                ).fetchone() == (0,)
        finally:
            server.command(action="release")
        assert pending.result(timeout=5).status_code == 200


def test_synthetic_state_cleared_reference_never_touches_executing_ledger(
    member_app, monkeypatch
):
    """Synthetic state, unreachable via monotonic real HTTP; guards the branch only."""
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        # Direct setup deliberately combines a fresh executing permit and an old
        # current S. A real login cannot start with this expired credential.
        with sqlite3.connect(path) as db:
            db.execute("UPDATE sessions SET expires_at='2026-09-30T23:00:00.000000Z'")
            db.execute(
                "UPDATE auth_transitions SET state='executing' WHERE transition_id=?",
                (permit["transition_id"],),
            )
            before = db.execute(
                "SELECT * FROM auth_transitions WHERE transition_id=?",
                (permit["transition_id"],),
            ).fetchone()
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT * FROM auth_transitions WHERE transition_id=?",
                    (permit["transition_id"],),
                ).fetchone()
                == before
            )
            assert db.execute(
                "SELECT revision,current_session_generation FROM auth_flows WHERE id=?",
                (browser.flow,),
            ).fetchone() == (permit["revision"], None)
        reconcile(app.state.session_factory)
