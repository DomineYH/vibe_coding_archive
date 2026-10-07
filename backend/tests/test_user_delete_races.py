"""Serialized application orders, actual hash barriers, and atomic failure boundaries."""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError

from tests.auth_client import signed_in
from tests.support import AUTH_MEMBERS
from tests.user_delete_client import TARGET, execute, issue, result, snapshot


@pytest.mark.parametrize(
    "failure",
    [
        "apps",
        "grades",
        "health",
        "sessions",
        "retired",
        "flow",
        "transition",
        "recovery",
        "keys",
        "member",
        "audit",
        "outbox_member",
        "outbox_app",
        "result",
        "commit",
    ],
)
def test_each_dependency_failure_rolls_back_every_table(member_app, failure):
    from tests.app_create_client import issued_key
    from tests.app_update_client import registered

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        item = registered(owner)
        issued_key(owner)
        owner.admit("logout")
        key = issue(browser, count=1).json()["key"]
        table, verb = {
            "apps": ("apps", "DELETE"),
            "grades": ("app_grades", "DELETE"),
            "health": ("health_results", "DELETE"),
            "sessions": ("sessions", "DELETE"),
            "retired": ("auth_retired_credentials", "INSERT"),
            "flow": ("auth_flows", "UPDATE"),
            "transition": ("auth_transitions", "UPDATE"),
            "recovery": ("recovery_credentials", "UPDATE"),
            "keys": ("write_operations", "DELETE"),
            "member": ("members", "DELETE"),
            "audit": ("audit_logs", "INSERT"),
            "outbox_member": ("user_delete_outbox", "INSERT"),
            "outbox_app": ("user_delete_outbox", "INSERT"),
            "result": ("write_operations", "UPDATE"),
            "commit": ("none", "none"),
        }[failure]
        with sqlite3.connect(path) as db:
            if failure != "commit":
                when = " WHEN NEW.kind='app'" if failure == "outbox_app" else ""
                db.execute(
                    f"CREATE TRIGGER fail_delete BEFORE {verb} ON {table}{when} BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
                )
        before = snapshot(path)

        def fail_commit(conn):
            raise OperationalError("safe failure", None, Exception("injected"))

        if failure == "commit":
            event.listen(app.state.engine, "commit", fail_commit)
        try:
            response = execute(browser, key, count=1)
            assert response.status_code == 503, response.text
        finally:
            if failure == "commit":
                event.remove(app.state.engine, "commit", fail_commit)
        assert snapshot(path) == before
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            assert ledger.execute(
                "SELECT count(*) FROM completed_user_delete_events"
            ).fetchone() == (0,)
        assert item["id"]


@pytest.mark.parametrize(
    "boundary", ["recent", "key", "idle", "absolute", "flow", "readiness"]
)
def test_final_authority_and_deadline_after_mutations_roll_back(member_app, boundary):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        before = snapshot(path)

        def expire(conn, cursor, statement, params, context, many):
            if (
                "UPDATE write_operations SET state='confirming_deletion'"
                not in statement
            ):
                return
            if boundary == "readiness":
                app.state.auth_ready = False
                return
            sql = {
                "recent": "UPDATE sessions SET recent_auth_until='2000-01-01T00:00:00Z' WHERE member_id=?",
                "key": "UPDATE write_operations SET expires_at='2000-01-01T00:00:00Z' WHERE actor_id=?",
                "idle": "UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE member_id=?",
                "absolute": "UPDATE sessions SET absolute_expires_at='2000-01-01T00:00:00Z' WHERE member_id=?",
                "flow": "UPDATE auth_flows SET expires_at='2000-01-01T00:00:00Z' WHERE id=?",
            }[boundary]
            cursor.execute(
                sql, (browser.flow if boundary == "flow" else AUTH_MEMBERS["admin"][0],)
            )

        event.listen(app.state.engine, "after_cursor_execute", expire)
        try:
            assert execute(browser, key).status_code in (401, 403, 410, 503)
        finally:
            event.remove(app.state.engine, "after_cursor_execute", expire)
        assert snapshot(path) == before


@pytest.mark.parametrize("kind", ["create", "edit", "single_delete", "replace"])
@pytest.mark.parametrize("first", ["opponent", "delete"])
def test_app_writes_in_both_commit_orders(member_app, kind, first):
    from tests.app_create_client import create, issued_key
    from tests.app_delete_client import delete, delete_key
    from tests.app_update_client import registered, update, update_key

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        item = registered(owner)
        key = issue(browser, count=1).json()["key"]
        if kind == "create":
            app_key = issued_key(owner)
            write = lambda: create(owner, app_key)
            status = 201
        elif kind == "edit":
            app_key = update_key(owner, item["id"])
            write = lambda: update(owner, item["id"], app_key)
            status = 200
        else:
            app_key = delete_key(owner, item["id"])
            write = lambda: delete(owner, item["id"], app_key)
            status = 204
        if first == "opponent":
            assert write().status_code == status
            if kind == "replace":
                registered(owner)
            applied = execute(browser, key, count=1)
            assert applied.status_code == (204 if kind in ("edit", "replace") else 409)
            if applied.status_code == 409:
                assert (
                    result(browser, key).json()["rejection_code"]
                    == "APP_COUNT_CONFLICT"
                )
                count = 2 if kind == "create" else 0
                assert (
                    execute(
                        browser, issue(browser, count=count).json()["key"], count=count
                    ).status_code
                    == 204
                )
        else:
            assert execute(browser, key, count=1).status_code == 204
            assert write().status_code == 401
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM apps WHERE owner_id=?", (TARGET,)).fetchall()
                == []
            )
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            assert (
                db.execute(
                    "SELECT key FROM write_operations WHERE actor_id=?", (TARGET,)
                ).fetchall()
                == []
            )


@pytest.mark.parametrize("first", ["opponent", "delete"])
@pytest.mark.parametrize("approved", [True, False])
def test_approval_changes_do_not_add_a_version_precondition(
    member_app, first, approved
):
    from tests.contracts.test_admin_approval import (
        execute as approval_execute,
    )
    from tests.contracts.test_admin_approval import (
        issue as approval_issue,
    )

    app, _path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        other = approval_issue(browser, target_id=TARGET, approved=approved).json()[
            "key"
        ]
        if first == "opponent":
            assert (
                approval_execute(
                    browser, other, target_id=TARGET, approved=approved
                ).status_code
                == 200
            )
        assert execute(browser, key).status_code == 204
        if first == "delete":
            assert (
                approval_execute(
                    browser, other, target_id=TARGET, approved=approved
                ).status_code
                == 404
            )
            assert result(browser, other).json()["rejection_code"] == "USER_NOT_FOUND"
        else:
            assert result(browser, other).json()["state"] == "succeeded"


@pytest.mark.parametrize("first", ["reset", "delete"])
def test_real_password_reset_and_delete_both_commit_orders(
    make_test_app, tmp_path, monkeypatch, first
):
    from app.auth_login import HASHER
    from tests.password_reset_client import (
        execute as reset_execute,
    )
    from tests.password_reset_client import (
        issue as reset_issue,
    )
    from tests.password_reset_client import (
        reset_app,
    )

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client, ThreadPoolExecutor() as workers:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        other = reset_issue(browser).json()["key"]
        if first == "reset":
            assert reset_execute(browser, other).status_code == 204
            assert execute(browser, key).status_code == 204
            assert result(browser, other).json()["state"] == "succeeded"
        else:
            entered, release = threading.Event(), threading.Event()
            real = HASHER.hash

            def delayed(value):
                answer = real(value)
                entered.set()
                assert release.wait(15)
                return answer

            monkeypatch.setattr(HASHER, "hash", delayed)
            pending = workers.submit(reset_execute, browser, other)
            try:
                assert entered.wait(10)
                assert execute(browser, key).status_code == 204
            finally:
                release.set()
            assert pending.result(timeout=15).status_code == 404
            assert result(browser, other).json()["rejection_code"] == "USER_NOT_FOUND"
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchall()
                == []
            )
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("kind", ["login", "change"])
@pytest.mark.parametrize("first", ["opponent", "delete"])
def test_late_authentication_cannot_recreate_deleted_member(
    member_app, monkeypatch, kind, first
):
    from app import auth_login
    from tests.auth_client import Browser
    from tests.contracts.test_auth_password import change

    app, path = member_app()
    if kind == "change":
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00Z' WHERE id=?",
                (TARGET,),
            )
    with (
        TestClient(app) as client,
        TestClient(app) as target_client,
        ThreadPoolExecutor() as workers,
    ):
        browser = signed_in(client, "admin")
        target = (
            Browser(target_client).prepare().anonymous()
            if kind == "login"
            else signed_in(target_client)
        )
        key = issue(browser).json()["key"]
        write = (
            (lambda: target.login("member-a"))
            if kind == "login"
            else (lambda: change(target))
        )
        if first == "opponent":
            assert write().status_code == 200
            assert execute(browser, key).status_code == 204
            assert target.me().status_code == 401
        else:
            entered, release = threading.Event(), threading.Event()
            real = (
                auth_login.argon2_verify if kind == "login" else auth_login.HASHER.hash
            )

            def delayed(*args):
                answer = real(*args)
                entered.set()
                assert release.wait(15)
                return answer

            if kind == "login":
                monkeypatch.setattr(auth_login, "argon2_verify", delayed)
            else:
                monkeypatch.setattr(auth_login.HASHER, "hash", delayed)
            pending = workers.submit(write)
            try:
                assert entered.wait(10)
                assert execute(browser, key).status_code == 204
            finally:
                release.set()
            assert pending.result(timeout=15).status_code in (401, 409)
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchall()
                == []
            )


def test_writer_contention_leaves_key_unresolved(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        before = snapshot(path)
        with sqlite3.connect(path) as db:
            db.execute("BEGIN IMMEDIATE")
            response = execute(browser, key)
            assert response.status_code == 503
            assert response.headers["Retry-After"] == "1"
            assert response.json()["error"]["code"] == "DB_BUSY"
        assert snapshot(path) == before
        assert execute(browser, key).status_code == 204


def test_shared_flow_with_target_history_rolls_back_if_calling_authority_is_revoked(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "INSERT INTO sessions(token_hash,flow_id,issued_seq,member_id,kind,csrf_token,created_at,last_activity_at,absolute_expires_at,expires_at,revoked_at) VALUES ('synthetic-history',?,'0',?,'full','synthetic-csrf','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2099-01-01T00:00:00Z','2099-01-01T00:00:00Z','2026-10-01T00:00:00Z')",
                (browser.flow, TARGET),
            )
        before = snapshot(path)
        assert execute(browser, key).status_code == 401
        assert snapshot(path) == before
