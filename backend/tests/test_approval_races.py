"""Contended HTTP approval commits on test-owned file SQLite."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.pending_retention import sweep_pending
from tests.auth_client import Browser, signed_in
from tests.contracts.test_admin_approval import PENDING_ID, cancel, execute, issue, read
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("same_key", [True, False])
def test_simultaneous_approval_serializes_business_and_terminal_results(
    member_app, same_key
):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        first = issue(admin).json()["key"]
        second = first if same_key else issue(admin).json()["key"]
        start = Barrier(2)

        def submit(key):
            start.wait(timeout=5)
            return execute(admin, key)

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(submit, [first, second]))
        assert sorted(result.status_code for result in results) == [200, 409]
        loser = next(result for result in results if result.status_code == 409)
        assert loser.json()["error"]["code"] == (
            "OPERATION_ALREADY_RESOLVED" if same_key else "USER_STATE_CONFLICT"
        )
        states = [read(admin, key).json() for key in (first, second)]
        assert sorted(row["state"] for row in states) == (
            ["succeeded", "succeeded"] if same_key else ["rejected", "succeeded"]
        )
        if not same_key:
            assert (
                next(row for row in states if row["state"] == "rejected")[
                    "rejection_code"
                ]
                == "USER_STATE_CONFLICT"
            )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone() == (2,)
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_approval' AND outcome='succeeded'"
            ).fetchone() == (1,)
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_approval' AND outcome='rejected'"
            ).fetchone() == (0 if same_key else 1,)


@pytest.mark.parametrize("cancel_first", [True, False])
def test_cancel_and_success_both_commit_orders(member_app, cancel_first):
    app, path = member_app()
    held, waiting, release = Event(), Event(), Event()
    owner = [None]

    def hold_commit(connection, cursor, statement, parameters, context, many):
        if (
            statement.startswith("UPDATE write_operations SET state=")
            and owner[0] is None
        ):
            owner[0] = connection
            held.set()
            assert release.wait(5)
        elif statement == "BEGIN IMMEDIATE" and held.is_set():
            waiting.set()

    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        event.listen(app.state.engine, "before_cursor_execute", hold_commit)
        try:
            with ThreadPoolExecutor(2) as pool:
                first = pool.submit(cancel if cancel_first else execute, admin, key)
                assert held.wait(5)
                second = pool.submit(execute if cancel_first else cancel, admin, key)
                assert waiting.wait(5)
                release.set()
                first_result, second_result = first.result(), second.result()
        finally:
            release.set()
            event.remove(app.state.engine, "before_cursor_execute", hold_commit)
        assert first_result.status_code == 200
        result = read(admin, key).json()
        if cancel_first:
            assert (
                second_result.status_code,
                second_result.json()["error"]["code"],
            ) == (409, "OPERATION_ALREADY_RESOLVED")
            assert (result["state"], result["rejection_code"]) == (
                "rejected",
                "OPERATION_CANCELLED",
            )
        else:
            assert second_result.status_code == 200
            assert second_result.json()["state"] == result["state"] == "succeeded"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone() == (1 if cancel_first else 2,)


@pytest.mark.parametrize("approval_first", [True, False])
def test_actual_approval_and_initial_pending_deletion_do_not_resurrect(
    member_app, approval_first
):
    app, path = member_app()
    held, waiting, release = Event(), Event(), Event()

    def hold_first_lock(connection, cursor, statement, parameters, context, many):
        if statement == "BEGIN IMMEDIATE" and held.is_set():
            waiting.set()
        elif (
            statement.startswith("SELECT * FROM members WHERE id=")
            and approval_first
            and not held.is_set()
        ) or (
            statement.startswith("SELECT id FROM members WHERE approval_status=")
            and not approval_first
            and not held.is_set()
        ):
            held.set()
            assert release.wait(5)

    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        stamp = (
            (datetime.now(UTC) - timedelta(days=91)).isoformat().replace("+00:00", "Z")
        )
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET created_at=? WHERE id=?", (stamp, PENDING_ID)
            )
        event.listen(app.state.engine, "before_cursor_execute", hold_first_lock)
        try:
            with ThreadPoolExecutor(2) as pool:
                first = (
                    pool.submit(execute, admin, key)
                    if approval_first
                    else pool.submit(sweep_pending, app.state.session_factory)
                )
                assert held.wait(5)
                second = (
                    pool.submit(sweep_pending, app.state.session_factory)
                    if approval_first
                    else pool.submit(execute, admin, key)
                )
                assert waiting.wait(5)
                release.set()
                results = [first.result(), second.result()]
        finally:
            release.set()
            event.remove(app.state.engine, "before_cursor_execute", hold_first_lock)
        result = results[0] if approval_first else results[1]
        if approval_first:
            assert result.status_code == 200
            assert read(admin, key).json()["state"] == "succeeded"
        else:
            assert (result.status_code, result.json()["error"]["code"]) == (
                404,
                "USER_NOT_FOUND",
            )
            assert read(admin, key).json()["rejection_code"] == "USER_NOT_FOUND"
        with sqlite3.connect(path) as db:
            member = db.execute(
                "SELECT first_approved_at FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone()
            assert bool(member and member[0]) is approval_first
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_revocation_during_login_verification_fails_terminally(member_app, monkeypatch):
    from app.auth_login import check_password

    app, path = member_app()
    entered, release = Event(), Event()

    def pause(password, stored):
        result = check_password(password, stored)
        entered.set()
        assert release.wait(5)
        return result

    with TestClient(app) as client, TestClient(app) as member_client:
        admin = signed_in(client, "admin")
        browser = Browser(member_client).prepare().anonymous()
        id_, login_id, _ = AUTH_MEMBERS["approved"]
        key = issue(admin, id_, approved=False).json()["key"]
        monkeypatch.setattr("app.auth_login.check_password", pause)
        with ThreadPoolExecutor(1) as pool:
            login = pool.submit(browser.login, login_id)
            assert entered.wait(5)
            assert execute(admin, key, id_, approved=False).status_code == 200
            release.set()
            result = login.result()
        assert (result.status_code, result.json()["error"]["code"]) == (
            409,
            "AUTH_STATE_CHANGED",
        )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT state,failure_code FROM auth_transitions WHERE flow_id=? AND kind='login'",
                (browser.flow,),
            ).fetchone() == ("failed", "AUTH_STATE_CHANGED")
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE member_id=? AND revoked_at IS NULL",
                (id_,),
            ).fetchone() == (0,)


@pytest.mark.parametrize("stale_target", [False, True])
def test_key_expiry_is_rechecked_immediately_before_business_update(
    member_app, monkeypatch, stale_target
):
    clock = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    held, release = Event(), Event()

    def pause_target(connection, cursor, statement, parameters, context, many):
        if statement.startswith("SELECT * FROM members WHERE id=") and str(
            PENDING_ID
        ) in str(parameters):
            held.set()
            assert release.wait(5)

    with TestClient(app) as client, TestClient(app) as fresh_client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        if stale_target:
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET account_version=2 WHERE id=?", (PENDING_ID,)
                )
        expiry = datetime.fromisoformat(read(admin, key).json()["expires_at"])
        clock[0] = expiry - timedelta(seconds=1)
        fresh = signed_in(fresh_client, "admin")
        event.listen(app.state.engine, "before_cursor_execute", pause_target)
        try:
            with ThreadPoolExecutor(1) as pool:
                result = pool.submit(execute, fresh, key)
                assert held.wait(5)
                clock[0] = expiry
                release.set()
                result = result.result()
        finally:
            release.set()
            event.remove(app.state.engine, "before_cursor_execute", pause_target)
        assert (result.status_code, result.json()["error"]["code"]) == (
            410,
            "OPERATION_EXPIRED",
        )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone() == (2 if stale_target else 1,)
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)


@pytest.mark.parametrize("action", ["issue", "cancel", "reject"])
def test_administrator_expiry_before_final_write_rolls_back(
    member_app, monkeypatch, action
):
    server_clock = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return server_clock[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"] if action != "issue" else None
        with sqlite3.connect(path) as db:
            expiry = datetime.fromisoformat(
                db.execute(
                    "SELECT expires_at FROM sessions WHERE member_id=? AND revoked_at IS NULL",
                    (AUTH_MEMBERS["admin"][0],),
                ).fetchone()[0]
            )
            if action == "reject":
                db.execute(
                    "UPDATE members SET account_version=2 WHERE id=?", (PENDING_ID,)
                )
        prefix = (
            "INSERT INTO write_operations"
            if action == "issue"
            else "UPDATE write_operations SET state='rejected'"
        )

        def expire_after_write(
            connection, cursor, statement, parameters, context, many
        ):
            if statement.startswith(prefix):
                server_clock[0] = expiry

        event.listen(app.state.engine, "after_cursor_execute", expire_after_write)
        try:
            result = (
                issue(admin)
                if action == "issue"
                else cancel(admin, key)
                if action == "cancel"
                else execute(admin, key)
            )
        finally:
            event.remove(app.state.engine, "after_cursor_execute", expire_after_write)
        assert (result.status_code, result.json()["error"]["code"]) == (
            401,
            "AUTH_REQUIRED",
        )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT state FROM write_operations").fetchall() == (
                [] if action == "issue" else [("unresolved",)]
            )
            assert db.execute("SELECT count(*) FROM audit_logs").fetchone() == (0,)
