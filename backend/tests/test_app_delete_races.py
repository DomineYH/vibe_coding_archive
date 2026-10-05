import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from tests.app_create_client import error, read
from tests.app_delete_client import delete, delete_key
from tests.app_update_client import registered, update, update_key
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import execute
from tests.contracts.test_admin_approval import issue as approval_issue
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("same", [True, False])
def test_concurrent_deletes_create_one_db_effect(member_app, same):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        first = delete_key(owner, item["id"])
        second = first if same else delete_key(owner, item["id"])
        barrier = Barrier(2)

        def submit(key):
            barrier.wait(5)
            return delete(owner, item["id"], key)

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(submit, [first, second]))
        assert any(r.status_code == 204 for r in results)
        assert all(
            r.status_code in ([204, 409, 503] if same else [204, 404]) for r in results
        )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM app_delete_outbox").fetchone() == (
                1,
            )
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='app_delete'"
            ).fetchone() == (1,)
        if not same:
            assert sorted(read(owner, k).json()["state"] for k in (first, second)) == [
                "rejected",
                "succeeded",
            ]


@pytest.mark.parametrize("edit_first", [True, False])
def test_edit_delete_commit_order(member_app, edit_first):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        edit_key, key = update_key(owner, item["id"]), delete_key(owner, item["id"])
        if edit_first:
            assert update(owner, item["id"], edit_key).status_code == 200
            error(delete(owner, item["id"], key), 409, "VERSION_CONFLICT")
        else:
            assert delete(owner, item["id"], key).status_code == 204
            error(update(owner, item["id"], edit_key), 404, "NOT_FOUND")
            assert read(owner, edit_key).json()["rejection_code"] == "NOT_FOUND"


@pytest.mark.parametrize(
    "table,action",
    [
        ("apps", "DELETE"),
        ("app_grades", "DELETE"),
        ("health_results", "DELETE"),
        ("audit_logs", "INSERT"),
        ("app_delete_outbox", "INSERT"),
        ("write_operations", "UPDATE"),
    ],
)
def test_delete_failure_rolls_back_every_effect(member_app, table, action):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        tables = (
            "apps",
            "app_grades",
            "health_results",
            "write_operations",
            "audit_logs",
            "app_delete_outbox",
        )
        with sqlite3.connect(path) as db:
            before = {t: db.execute(f"SELECT * FROM {t}").fetchall() for t in tables}
            db.execute(
                f"CREATE TRIGGER fail_delete BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'injected'); END"
            )
        error(delete(owner, item["id"], key), 503, "SERVICE_UNAVAILABLE")
        with sqlite3.connect(path) as db:
            assert {
                t: db.execute(f"SELECT * FROM {t}").fetchall() for t in tables
            } == before


def test_delete_db_busy_preserves_key_and_explicit_retry(member_app):
    import time

    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        with sqlite3.connect(path) as lock:
            lock.execute("BEGIN IMMEDIATE")
            started = time.monotonic()
            result = delete(owner, item["id"], key)
            assert 4.5 <= time.monotonic() - started < 6
            error(result, 503, "DB_BUSY")
            assert result.headers["Retry-After"] == "1"
        assert read(owner, key).json()["state"] == "unresolved"
        assert delete(owner, item["id"], key).status_code == 204


@pytest.mark.parametrize("revoke_first", [True, False])
def test_real_approval_revocation_and_delete_follow_database_commit_order(
    member_app, revoke_first
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as admin_client:
        owner, admin = signed_in(client), signed_in(admin_client, "admin")
        item = registered(owner)
        key = delete_key(owner, item["id"])
        approval_key = approval_issue(
            admin, target_id=AUTH_MEMBERS["approved"][0], approved=False
        ).json()["key"]
        held, attempted = Event(), Event()
        winner_statement = (
            "UPDATE members SET approval_status="
            if revoke_first
            else "DELETE FROM apps"
        )

        def hold_winner(connection, cursor, statement, parameters, context, many):
            if statement.startswith(winner_statement):
                held.set()
                assert attempted.wait(5)

        def observe_loser(connection, cursor, statement, parameters, context, many):
            if statement == "BEGIN IMMEDIATE" and held.is_set():
                attempted.set()

        def revoke():
            return execute(
                admin,
                approval_key,
                target_id=AUTH_MEMBERS["approved"][0],
                approved=False,
            )

        def apply_delete():
            return delete(owner, item["id"], key)

        event.listen(app.state.engine, "after_cursor_execute", hold_winner)
        event.listen(app.state.engine, "before_cursor_execute", observe_loser)
        try:
            with ThreadPoolExecutor(2) as pool:
                first = pool.submit(revoke if revoke_first else apply_delete)
                assert held.wait(5)
                second = pool.submit(apply_delete if revoke_first else revoke)
                assert first.result(10).status_code == (200 if revoke_first else 204)
                loser = second.result(10)
                if revoke_first:
                    error(loser, 401, "AUTH_REQUIRED")
                else:
                    assert loser.status_code == 200
        finally:
            event.remove(app.state.engine, "after_cursor_execute", hold_winner)
            event.remove(app.state.engine, "before_cursor_execute", observe_loser)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (
                1 if revoke_first else 0,
            )
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved" if revoke_first else "succeeded",)


@pytest.mark.parametrize("fault", ["expiry", "revoked"])
def test_final_authority_and_expiry_rechecks_rollback_delete(
    member_app, monkeypatch, fault
):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import event

    clock = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as fresh_client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        expiry = datetime.fromisoformat(read(owner, key).json()["expires_at"])
        if fault == "expiry":
            clock[0] = expiry - timedelta(seconds=1)
            owner = signed_in(fresh_client)
        tables = (
            "apps",
            "app_grades",
            "health_results",
            "write_operations",
            "audit_logs",
            "app_delete_outbox",
        )
        with sqlite3.connect(path) as db:
            before = {t: db.execute(f"SELECT * FROM {t}").fetchall() for t in tables}

        def invalidate(connection, cursor, statement, parameters, context, many):
            if statement.startswith(
                "UPDATE write_operations SET state='confirming_deletion'"
            ):
                if fault == "expiry":
                    clock[0] = expiry
                else:
                    connection.exec_driver_sql(
                        "UPDATE members SET approval_status='revoked' WHERE id=?",
                        (AUTH_MEMBERS["approved"][0],),
                    )

        event.listen(app.state.engine, "after_cursor_execute", invalidate)
        try:
            result = delete(owner, item["id"], key)
        finally:
            event.remove(app.state.engine, "after_cursor_execute", invalidate)
        error(
            result,
            410 if fault == "expiry" else 401,
            "OPERATION_EXPIRED" if fault == "expiry" else "AUTH_REQUIRED",
        )
        with sqlite3.connect(path) as db:
            assert {
                t: db.execute(f"SELECT * FROM {t}").fetchall() for t in tables
            } == before
