"""Contended edits and fault rollback on test-owned SQLite databases."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from tests.app_create_client import error, read
from tests.app_update_client import detail, registered, update, update_key
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import execute
from tests.contracts.test_admin_approval import issue as approval_issue
from tests.support import AUTH_MEMBERS


def snapshot(path):
    with sqlite3.connect(path) as db:
        return {
            table: db.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            for table in ("apps", "app_grades", "health_results", "write_operations")
        }


@pytest.mark.parametrize("mode", ["same", "different_keys", "different_body"])
@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_concurrent_edits_apply_once_and_finalize_only_the_correct_key(
    member_app, mode, writer
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        first = update_key(actor, item["id"])
        second = update_key(actor, item["id"]) if mode == "different_keys" else first
        barrier = Barrier(2)

        def submit(args):
            key, patch = args
            barrier.wait(5)
            return update(actor, item["id"], key, patch)

        with ThreadPoolExecutor(2) as pool:
            results = list(
                pool.map(
                    submit,
                    [
                        (first, None),
                        (
                            second,
                            {"name": "other"} if mode == "different_body" else None,
                        ),
                    ],
                )
            )
        assert sorted(result.status_code for result in results) == [200, 409]
        error(
            next(result for result in results if result.status_code == 409),
            409,
            {
                "same": "OPERATION_ALREADY_RESOLVED",
                "different_keys": "VERSION_CONFLICT",
                "different_body": "OPERATION_KEY_MISMATCH",
            }[mode],
        )
        assert detail(actor, item["id"]).json()["item"]["version"] == 2
        states = [read(actor, key).json()["state"] for key in (first, second)]
        assert sorted(states) == (
            ["rejected", "succeeded"]
            if mode == "different_keys"
            else ["succeeded", "succeeded"]
        )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (1,)


@pytest.mark.parametrize(
    "table,action",
    [
        ("apps", "UPDATE"),
        ("app_grades", "INSERT"),
        ("health_results", "DELETE"),
        ("health_results", "INSERT"),
        ("write_operations", "UPDATE"),
    ],
)
def test_edit_storage_failure_rolls_back_all_columns_grades_health_and_result(
    member_app, table, action
):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        patch = {
            "name": "changed",
            "url": "https://example.com/changed",
            "grades": ["중1"],
            "is_public": False,
        }
        key = update_key(owner, item["id"], patch)
        before = snapshot(path)
        with sqlite3.connect(path) as db:
            db.execute(
                f"CREATE TRIGGER fail_edit BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        error(update(owner, item["id"], key, patch), 503, "SERVICE_UNAVAILABLE")
        assert snapshot(path) == before
        assert read(owner, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            db.execute("DROP TRIGGER fail_edit")
        assert update(owner, item["id"], key, patch).status_code == 200


def test_patch_takes_write_reservation_before_read_and_explicit_retry_is_safe(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = update_key(owner, item["id"])
        before = snapshot(path)
        with sqlite3.connect(path) as blocker:
            blocker.execute("BEGIN IMMEDIATE")
            error(update(owner, item["id"], key), 503, "DB_BUSY")
            blocker.rollback()
        assert snapshot(path) == before
        assert update(owner, item["id"], key).status_code == 200


@pytest.mark.parametrize("expired", ["key", "session", "revoked"])
def test_edit_final_authority_and_expiry_recheck_rolls_back(
    member_app, monkeypatch, expired
):
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
        key = update_key(owner, item["id"])
        if expired == "key":
            expiry = datetime.fromisoformat(read(owner, key).json()["expires_at"])
            clock[0] = expiry - timedelta(seconds=1)
            owner = signed_in(fresh_client)
        else:
            with sqlite3.connect(path) as db:
                expiry = datetime.fromisoformat(
                    db.execute(
                        "SELECT expires_at FROM sessions WHERE member_id=? AND kind='full'",
                        (AUTH_MEMBERS["approved"][0],),
                    ).fetchone()[0]
                )
        before = snapshot(path)

        def invalidate(connection, cursor, statement, parameters, context, many):
            if statement.startswith("UPDATE write_operations SET state='succeeded'"):
                if expired == "revoked":
                    connection.exec_driver_sql(
                        "UPDATE members SET approval_status='revoked' WHERE id=?",
                        (AUTH_MEMBERS["approved"][0],),
                    )
                else:
                    clock[0] = expiry

        event.listen(app.state.engine, "after_cursor_execute", invalidate)
        try:
            result = update(owner, item["id"], key)
        finally:
            event.remove(app.state.engine, "after_cursor_execute", invalidate)
        error(
            result,
            410 if expired == "key" else 401,
            "OPERATION_EXPIRED" if expired == "key" else "AUTH_REQUIRED",
        )
        assert snapshot(path) == before


@pytest.mark.parametrize("revoke_first", [True, False])
def test_real_approval_revocation_and_edit_follow_database_commit_order(
    member_app, revoke_first
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as admin_client:
        owner, admin = signed_in(client), signed_in(admin_client, "admin")
        item = registered(owner)
        key = update_key(owner, item["id"])
        approval_key = approval_issue(
            admin, target_id=AUTH_MEMBERS["approved"][0], approved=False
        ).json()["key"]
        held, attempted = Event(), Event()
        winner_statement = (
            "UPDATE members SET approval_status=" if revoke_first else "UPDATE apps SET"
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

        def edit():
            return update(owner, item["id"], key)

        event.listen(app.state.engine, "after_cursor_execute", hold_winner)
        event.listen(app.state.engine, "before_cursor_execute", observe_loser)
        try:
            with ThreadPoolExecutor(2) as pool:
                first = pool.submit(revoke if revoke_first else edit)
                assert held.wait(5)
                second = pool.submit(edit if revoke_first else revoke)
                assert first.result(10).status_code == 200
                loser = second.result(10)
                if revoke_first:
                    error(loser, 401, "AUTH_REQUIRED")
                else:
                    assert loser.status_code == 200
        finally:
            event.remove(app.state.engine, "after_cursor_execute", hold_winner)
            event.remove(app.state.engine, "before_cursor_execute", observe_loser)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT version FROM apps").fetchone() == (
                1 if revoke_first else 2,
            )
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved" if revoke_first else "succeeded",)
