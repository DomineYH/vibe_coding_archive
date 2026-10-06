"""Real hash barriers, separate SQLite transactions, and injected storage failures."""

import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError

from tests.password_reset_client import (
    admin,
    cancel,
    execute,
    issue,
    reset_app,
    result,
    snapshot,
    supply,
)
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize(
    "mutation,expected",
    [
        ("cancel", 409),
        ("loss", 503),
        ("rotation", 503),
        ("logout", 401),
        ("readiness", 503),
        ("cli", 401),
        ("role", 403),
        ("must_change", 403),
        ("target_version", 409),
        ("target_delete", 404),
        ("target_admin", 403),
        ("key_expiry", 410),
        ("recent_expiry", 403),
        ("same_key", 409),
        ("other_key", 409),
        ("reauth", 401),
    ],
)
def test_hashing_request_cannot_overwrite_winning_change(
    make_test_app, tmp_path, monkeypatch, mutation, expected
):
    from app.auth_login import HASHER
    from tests.contracts.test_auth_reauth import reauth

    app, path, secret = reset_app(make_test_app, tmp_path)
    entered, release = threading.Event(), threading.Event()
    real = HASHER.hash
    with TestClient(app) as client, ThreadPoolExecutor() as workers:
        browser = admin(client)
        key = issue(browser).json()["key"]
        other_key = issue(browser).json()["key"] if mutation == "other_key" else None

        def delayed(value):
            answer = real(value)
            if not entered.is_set():
                entered.set()
                assert release.wait(15)
            return answer

        monkeypatch.setattr(HASHER, "hash", delayed)
        pending = workers.submit(execute, browser, key)
        try:
            assert entered.wait(10)
            if mutation == "cancel":
                assert cancel(browser, key).status_code == 200
            elif mutation == "readiness":
                app.state.auth_ready = False
            elif mutation == "loss":
                secret.unlink()
            elif mutation == "rotation":
                supply(secret)
            elif mutation == "logout":
                assert browser.logout().status_code == 204
            elif mutation == "cli":
                from tests.admin_cli import run_admin_cli
                from tests.support import AUTH_PASSWORD

                status, output = run_admin_cli(
                    "recover-admin",
                    path,
                    app.state.settings.password_blocklist_path,
                    [
                        ("Login ID: ", "admin-user"),
                        ("Temporary password: ", AUTH_PASSWORD),
                        ("Confirm temporary password: ", AUTH_PASSWORD),
                        ("Type YES to confirm: ", "YES"),
                    ],
                )
                assert status == 0 and AUTH_PASSWORD not in output
            elif mutation == "reauth":
                assert reauth(browser).status_code == 200
            elif mutation in ("same_key", "other_key"):
                assert execute(browser, other_key or key).status_code == 204
            else:
                sql = {
                    "role": "UPDATE members SET is_admin=0 WHERE login_id='admin-user'",
                    "must_change": "UPDATE members SET must_change_password=1 WHERE login_id='admin-user'",
                    "target_version": "UPDATE members SET account_version=2 WHERE login_id='member-a'",
                    "target_delete": "DELETE FROM members WHERE login_id='member-a'",
                    "target_admin": "UPDATE members SET is_admin=1 WHERE login_id='member-a'",
                    "key_expiry": "UPDATE write_operations SET expires_at='2000-01-01T00:00:00Z'",
                    "recent_expiry": "UPDATE sessions SET recent_auth_until='2000-01-01T00:00:00Z' WHERE member_id='"
                    + AUTH_MEMBERS["admin"][0]
                    + "'",
                }[mutation]
                with sqlite3.connect(path) as db:
                    db.execute(sql)
            before = snapshot(path)
        finally:
            release.set()
        response = pending.result(timeout=15)
        assert response.status_code == expected, response.text
        after = snapshot(path)
        if mutation == "readiness":
            app.state.auth_ready = True
        for table in ("members", "sessions"):
            assert after[table] == before[table]
        if mutation in ("loss", "rotation"):
            assert (
                result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"
            )
            assert issue(browser).status_code == 503
        elif mutation in (
            "target_version",
            "target_delete",
            "target_admin",
            "other_key",
        ):
            assert result(browser, key).json()["state"] == "rejected"
        elif mutation not in (
            "logout",
            "cli",
            "reauth",
            "role",
            "must_change",
            "key_expiry",
        ):
            assert result(browser, key).status_code == 200


@pytest.mark.parametrize(
    "failure", ["audit", "sessions", "result", "commit", "cancel_audit"]
)
def test_storage_failure_rolls_back_all_effects(make_test_app, tmp_path, failure):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        before = snapshot(path)

        def fail(conn, cursor, statement, params, context, many):
            needles = {
                "audit": "INSERT INTO audit_logs",
                "sessions": "UPDATE sessions SET revoked_at",
                "result": "UPDATE write_operations SET state='succeeded'",
                "cancel_audit": "INSERT INTO audit_logs",
            }
            if needles.get(failure, "NEVER") in statement:
                raise OperationalError(
                    "injected safe failure", None, Exception("injected")
                )

        def fail_commit(conn):
            raise OperationalError(
                "injected commit failure", None, Exception("injected")
            )

        event.listen(app.state.engine, "before_cursor_execute", fail)
        if failure == "commit":
            event.listen(app.state.engine, "commit", fail_commit)
        try:
            response = (
                cancel(browser, key)
                if failure == "cancel_audit"
                else execute(browser, key)
            )
            assert response.status_code == 503, response.text
        finally:
            event.remove(app.state.engine, "before_cursor_execute", fail)
            if failure == "commit":
                event.remove(app.state.engine, "commit", fail_commit)
        assert snapshot(path) == before


@pytest.mark.parametrize("first", ["reset", "approval"])
@pytest.mark.parametrize("approved", [True, False])
def test_approval_and_reset_do_not_overwrite_each_others_versions(
    make_test_app, tmp_path, first, approved
):
    from tests.contracts.test_admin_approval import execute as approval_execute
    from tests.contracts.test_admin_approval import issue as approval_issue

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        approval_key = approval_issue(
            browser, target_id=AUTH_MEMBERS["approved"][0], approved=approved
        ).json()["key"]
        if first == "reset":
            assert execute(browser, key).status_code == 204
            assert (
                approval_execute(
                    browser,
                    approval_key,
                    target_id=AUTH_MEMBERS["approved"][0],
                    approved=approved,
                ).status_code
                == 409
            )
        else:
            assert (
                approval_execute(
                    browser,
                    approval_key,
                    target_id=AUTH_MEMBERS["approved"][0],
                    approved=approved,
                ).status_code
                == 200
            )
            assert execute(browser, key).status_code == 409
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version FROM members WHERE login_id='member-a'"
            ).fetchone() == (2,)


@pytest.mark.parametrize("first", ["login", "reset"])
def test_login_final_fence_or_revocation_blocks_the_old_credential(
    make_test_app, tmp_path, monkeypatch, first
):
    from app import auth_login
    from tests.auth_client import Browser

    app, _path, _ = reset_app(make_test_app, tmp_path)
    with (
        TestClient(app) as client,
        TestClient(app) as target_client,
        ThreadPoolExecutor() as workers,
    ):
        browser = admin(client)
        target = Browser(target_client).prepare().anonymous()
        key = issue(browser).json()["key"]
        if first == "login":
            assert target.login("member-a").status_code == 200
            assert execute(browser, key).status_code == 204
            assert target.me().status_code == 401
        else:
            entered, release = threading.Event(), threading.Event()
            real = auth_login.argon2_verify

            def delayed(stored, password):
                answer = real(stored, password)
                entered.set()
                assert release.wait(10)
                return answer

            monkeypatch.setattr(auth_login, "argon2_verify", delayed)
            pending = workers.submit(target.login, "member-a")
            try:
                assert entered.wait(10)
                assert execute(browser, key).status_code == 204
            finally:
                release.set()
            assert pending.result(timeout=10).status_code == 409


@pytest.mark.parametrize("kind", ["create", "update", "delete"])
@pytest.mark.parametrize("first", ["app", "reset"])
def test_reset_revokes_authority_for_existing_app_write_keys(
    make_test_app, tmp_path, kind, first
):
    from tests.app_create_client import create, issued_key
    from tests.app_delete_client import delete, delete_key
    from tests.app_update_client import registered, update, update_key
    from tests.auth_client import signed_in

    app, _path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = admin(client)
        owner = signed_in(owner_client)
        key = issue(browser).json()["key"]
        if kind == "create":
            app_key = issued_key(owner)
            write = lambda: create(owner, app_key)
            expected = 201
        else:
            item = registered(owner)
            if kind == "update":
                app_key = update_key(owner, item["id"])
                write = lambda: update(owner, item["id"], app_key)
                expected = 200
            else:
                app_key = delete_key(owner, item["id"])
                write = lambda: delete(owner, item["id"], app_key)
                expected = 204
        if first == "app":
            assert write().status_code == expected
        assert execute(browser, key).status_code == 204
        if first == "reset":
            assert write().status_code == 401


@pytest.mark.parametrize("first", ["change", "reset"])
def test_self_change_and_reset_recheck_current_version_and_session(
    make_test_app, tmp_path, monkeypatch, first
):
    from app.auth_login import HASHER
    from tests.auth_client import signed_in
    from tests.contracts.test_auth_password import change

    app, path, _ = reset_app(make_test_app, tmp_path)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00Z' WHERE login_id='member-a'"
        )
    with (
        TestClient(app) as client,
        TestClient(app) as target_client,
        ThreadPoolExecutor() as workers,
    ):
        browser = admin(client)
        target = signed_in(target_client)
        key = issue(browser).json()["key"]
        if first == "change":
            assert change(target).status_code == 200
            assert execute(browser, key).status_code == 409
        else:
            entered, release = threading.Event(), threading.Event()
            real = HASHER.hash

            def delayed(value):
                answer = real(value)
                if not entered.is_set():
                    entered.set()
                    assert release.wait(10)
                return answer

            monkeypatch.setattr(HASHER, "hash", delayed)
            pending = workers.submit(change, target)
            try:
                assert entered.wait(10)
                assert execute(browser, key).status_code == 204
            finally:
                release.set()
            assert pending.result(timeout=10).status_code in (401, 409)


@pytest.mark.parametrize("boundary", ["recent", "key", "idle", "absolute", "flow"])
def test_expiry_after_business_writes_rolls_back_every_effect(
    make_test_app, tmp_path, boundary
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        before = snapshot(path)

        def expire(conn, cursor, statement, params, context, many):
            if "UPDATE write_operations SET state='succeeded'" in statement:
                sql = {
                    "recent": "UPDATE sessions SET recent_auth_until='2000-01-01T00:00:00Z' WHERE member_id=?",
                    "idle": "UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE member_id=?",
                    "absolute": "UPDATE sessions SET absolute_expires_at='2000-01-01T00:00:00Z' WHERE member_id=?",
                    "key": "UPDATE write_operations SET expires_at='2000-01-01T00:00:00Z' WHERE actor_id=?",
                    "flow": "UPDATE auth_flows SET expires_at='2000-01-01T00:00:00Z' WHERE id=?",
                }[boundary]
                cursor.execute(
                    sql,
                    (browser.flow if boundary == "flow" else AUTH_MEMBERS["admin"][0],),
                )

        event.listen(app.state.engine, "after_cursor_execute", expire)
        try:
            assert execute(browser, key).status_code in (401, 403, 410)
        finally:
            event.remove(app.state.engine, "after_cursor_execute", expire)
        assert snapshot(path) == before


@pytest.mark.parametrize("failure", ["result", "audit"])
def test_rejected_result_storage_is_atomic(make_test_app, tmp_path, failure):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute("UPDATE members SET account_version=2 WHERE login_id='member-a'")
            table = "write_operations" if failure == "result" else "audit_logs"
            action = "UPDATE" if failure == "result" else "INSERT"
            db.execute(
                f"CREATE TRIGGER refuse_reset_rejection BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        before = snapshot(path)
        assert execute(browser, key).status_code == 503
        assert snapshot(path) == before


def test_hash_gate_exhaustion_leaves_reset_unresolved(make_test_app, tmp_path):
    from app.auth_login import HashGate

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        app.state.hash_gate = HashGate(running=1, waiting=0)
        before = snapshot(path)
        with app.state.hash_gate:
            response = execute(browser, key)
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "AUTH_BUSY"
        assert snapshot(path) == before


def test_secret_loss_after_business_writes_rolls_back_then_invalidates_in_fresh_transaction(
    make_test_app, tmp_path
):
    app, path, secret = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        before = snapshot(path)

        def lose(conn, cursor, statement, params, context, many):
            if "UPDATE write_operations SET state='succeeded'" in statement:
                secret.unlink()

        event.listen(app.state.engine, "after_cursor_execute", lose)
        try:
            assert execute(browser, key).status_code == 503
        finally:
            event.remove(app.state.engine, "after_cursor_execute", lose)
        after = snapshot(path)
        for table in ("members", "sessions"):
            assert after[table] == before[table]
        assert result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_password_reset'"
            ).fetchone() == (0,)


def test_writer_contention_is_retryable_and_does_not_consume_reset(
    make_test_app, tmp_path
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        before = snapshot(path)
        with sqlite3.connect(path) as lock:
            lock.execute("BEGIN IMMEDIATE")
            response = execute(browser, key)
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "DB_BUSY"
        assert snapshot(path) == before


def test_cancel_final_readiness_failure_rolls_back_result_and_audit(
    make_test_app, tmp_path
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        before = snapshot(path)

        def close_auth(conn, cursor, statement, params, context, many):
            if "INSERT INTO audit_logs" in statement:
                app.state.auth_ready = False

        event.listen(app.state.engine, "after_cursor_execute", close_auth)
        try:
            assert cancel(browser, key).status_code == 503
        finally:
            event.remove(app.state.engine, "after_cursor_execute", close_auth)
        assert snapshot(path) == before
