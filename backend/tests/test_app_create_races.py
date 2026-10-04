"""Transaction failures and contention on test-owned SQLite databases."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from tests.app_create_client import INPUT, create, error, issued_key, read
from tests.auth_client import signed_in
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("different", [False, True])
def test_simultaneous_create_serializes_one_app_result(member_app, different):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        barrier = Barrier(2)

        def submit(body):
            barrier.wait(5)
            return create(browser, key, body)

        with ThreadPoolExecutor(2) as pool:
            results = list(
                pool.map(
                    submit,
                    [
                        INPUT,
                        {**INPUT, "description": "changed"} if different else INPUT,
                    ],
                )
            )
        assert sorted(result.status_code for result in results) == (
            [201, 409] if different else [201, 201]
        )
        if different:
            error(
                next(result for result in results if result.status_code == 409),
                409,
                "OPERATION_KEY_MISMATCH",
            )
        else:
            assert results[0].json()["item"] == results[1].json()["item"]
        assert read(browser, key).json()["state"] == "succeeded"
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (1,)
            assert db.execute("SELECT count(*) FROM app_grades").fetchone() == (1,)
            assert db.execute("SELECT count(*) FROM health_results").fetchone() == (1,)


@pytest.mark.parametrize("table", ["app_grades", "health_results", "write_operations"])
def test_storage_failure_rolls_back_all_app_writes_and_retry_succeeds(
    member_app, table
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        with sqlite3.connect(path) as db:
            action = "UPDATE" if table == "write_operations" else "INSERT"
            db.execute(
                f"CREATE TRIGGER fail_save BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        error(create(browser, key), 503, "SERVICE_UNAVAILABLE")
        assert read(browser, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            for name in ("apps", "app_grades", "health_results"):
                assert db.execute(f"SELECT count(*) FROM {name}").fetchone() == (0,)
            db.execute("DROP TRIGGER fail_save")
        assert create(browser, key).status_code == 201


@pytest.mark.parametrize("expired", ["key", "session", "revoked"])
def test_final_authority_and_expiry_check_rolls_back_app(
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
        browser = signed_in(client)
        key = issued_key(browser)
        if expired == "key":
            expiry = datetime.fromisoformat(read(browser, key).json()["expires_at"])
            clock[0] = expiry - timedelta(seconds=1)
            browser = signed_in(fresh_client)
        else:
            with sqlite3.connect(path) as db:
                expiry = datetime.fromisoformat(
                    db.execute(
                        "SELECT expires_at FROM sessions WHERE member_id=? AND kind='full'",
                        (AUTH_MEMBERS["approved"][0],),
                    ).fetchone()[0]
                )

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
            result = create(browser, key)
        finally:
            event.remove(app.state.engine, "after_cursor_execute", invalidate)
        error(
            result,
            410 if expired == "key" else 401,
            "OPERATION_EXPIRED" if expired == "key" else "AUTH_REQUIRED",
        )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (0,)
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)


def test_held_write_lock_returns_busy_and_same_key_retry_is_safe(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        # The lock is held deterministically through the configured busy timeout.
        with sqlite3.connect(path) as blocker:
            blocker.execute("BEGIN IMMEDIATE")
            error(create(browser, key), 503, "DB_BUSY")
            blocker.rollback()
        assert read(browser, key).json()["state"] == "unresolved"
        assert create(browser, key).status_code == 201
