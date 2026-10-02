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
