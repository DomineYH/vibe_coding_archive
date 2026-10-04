import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.app_create_client import API, INPUT, create, error, issue, issued_key, read
from tests.auth_client import Browser, signed_in
from tests.contracts.test_admin_approval import cancel, execute, headers
from tests.contracts.test_admin_approval import issue as approval_issue
from tests.support import AUTH_MEMBERS

OPERATION_FIELDS = {
    "key",
    "kind",
    "target_id",
    "issued_at",
    "expires_at",
    "state",
    "db_applied_at",
    "finalized_at",
    "result_version",
    "rejection_code",
    "server_time",
}


@pytest.mark.parametrize("actor", ["approved", "admin"])
def test_full_member_issues_creates_replays_and_reads_minimal_result(member_app, actor):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, actor)
        issued = issue(browser)
        assert issued.status_code == 201, issued.text
        operation = issued.json()
        assert set(operation) == OPERATION_FIELDS
        assert operation["kind"] == "app_create"
        assert operation["state"] == "unresolved"
        assert all(
            operation[key] is None
            for key in (
                "target_id",
                "result_version",
                "db_applied_at",
                "finalized_at",
                "rejection_code",
            )
        )
        assert datetime.fromisoformat(operation["expires_at"]) - datetime.fromisoformat(
            operation["issued_at"]
        ) == timedelta(days=1)
        assert client.get(f"{API}/apps").json()["pagination"]["total"] == 0
        key = operation["key"]
        assert read(browser, key).json()["state"] == "unresolved"
        saved = create(browser, key)
        assert saved.status_code == 201, saved.text
        detail = saved.json()["item"]
        assert detail["owner"]["id"] == AUTH_MEMBERS[actor][0]
        assert (detail["version"], detail["url_version"]) == (1, 1)
        assert detail["health"] == {
            "result": {"state": "unchecked", "checked_at": None, "fresh_until": None},
            "latest_job": None,
            "next_check_at": None,
        }
        for field, value in INPUT.items():
            assert detail[field] == value
        assert create(browser, key).json()["item"] == detail
        resolved = read(browser, key)
        assert set(resolved.json()) == OPERATION_FIELDS
        assert resolved.json()["state"] == "succeeded"
        assert resolved.json()["target_id"] == detail["id"]
        assert resolved.json()["result_version"] == 1
        assert resolved.json()["db_applied_at"] == resolved.json()["finalized_at"]
        for result in (issued, resolved, saved):
            assert result.headers["Cache-Control"] == (
                "no-store" if result is saved else "private, no-store"
            )
            assert result.headers["X-EduVibe-Flow-Id"] == browser.flow
            assert result.headers["X-EduVibe-Auth-Revision"] == browser.revision
            assert result.headers["X-EduVibe-Session-Generation"] == browser.generation
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (1,)
            assert db.execute("SELECT count(*) FROM app_grades").fetchone() == (1,)
            assert db.execute("SELECT count(*) FROM health_results").fetchone() == (1,)


def test_key_matches_normalized_body_and_remains_bound_to_actor(member_app):
    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as foreign_client:
        browser = signed_in(client)
        other = signed_in(foreign_client, "hangul")
        body = {
            **INPUT,
            "name": " e\u0301 ",
            "prompt": "a\r\nb\u2028c",
            "stack_db": "   ",
        }
        key = issued_key(browser, body)
        canonical = {**body, "name": "é", "prompt": "a\nb\nc", "stack_db": None}
        for result in (
            create(other, key, canonical),
            read(other, key),
            create(browser, str(uuid4())),
            read(browser, str(uuid4())),
        ):
            error(result, 404, "OPERATION_NOT_FOUND")
        error(
            create(browser, key, {**canonical, "description": "changed"}),
            409,
            "OPERATION_KEY_MISMATCH",
        )
        assert read(browser, key).json()["state"] == "unresolved"
        saved = create(browser, key, canonical)
        assert saved.status_code == 201, saved.text
        assert saved.json()["item"]["name"] == "é"
        assert create(browser, key, body).json()["item"] == saved.json()["item"]
        error(
            create(browser, key, {**canonical, "is_public": False}),
            409,
            "OPERATION_KEY_MISMATCH",
        )
        error(create(other, key, canonical), 404, "OPERATION_NOT_FOUND")
        error(read(other, key), 404, "OPERATION_NOT_FOUND")


def test_key_expiry_and_other_kind_guards(member_app, monkeypatch):
    clock = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as fresh_client:
        admin = signed_in(client, "admin")
        app_key = issued_key(admin)
        error(cancel(admin, app_key), 409, "OPERATION_KEY_MISMATCH")
        error(execute(admin, app_key), 409, "OPERATION_KEY_MISMATCH")
        approval_key = approval_issue(admin).json()["key"]
        error(create(admin, approval_key), 409, "OPERATION_KEY_MISMATCH")
        expiry = read(admin, app_key).json()["expires_at"]
        assert create(admin, app_key).status_code == 201
        clock[0] = datetime.fromisoformat(expiry) - timedelta(seconds=1)
        fresh = signed_in(fresh_client, "admin")
        assert create(fresh, app_key).status_code == 201
        clock[0] = datetime.fromisoformat(expiry)
        for result in (create(fresh, app_key), read(fresh, app_key)):
            error(result, 410, "OPERATION_EXPIRED")
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (1,)


def test_invalid_keys_and_json_do_not_consume_operation(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        for keys in (
            [],
            [("Idempotency-Key", key)] * 2,
            [("Idempotency-Key", "bad")],
            [("Idempotency-Key", key.upper())],
        ):
            error(
                create(browser, key, headers=[*headers(browser).items(), *keys]),
                422,
                "VALIDATION_ERROR",
            )
        for url, content in (
            ("/apps", '{"name":"a","name":"b"}'),
            ("/write-operations", '{"kind":"app_create","kind":"user_approval"}'),
            ("/apps", "{bad"),
        ):
            error(
                client.post(
                    f"{API}{url}",
                    content=content,
                    headers={**headers(browser), "Content-Type": "application/json"},
                ),
                400,
                "BAD_REQUEST",
            )
        assert read(browser, key).json()["state"] == "unresolved"


@pytest.mark.parametrize(
    "state", ["anonymous", "pending", "revoked", "limited", "missing_cookie"]
)
def test_issue_create_and_result_require_current_full_approved_member(
    member_app, state
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        if state in ("pending", "revoked"):
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET approval_status=?,first_approved_at=? WHERE id=?",
                    (
                        state,
                        None if state == "pending" else "2026-09-28T12:00:00.000000Z",
                        AUTH_MEMBERS["approved"][0],
                    ),
                )
        elif state == "limited":
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00.000000Z' WHERE id=?",
                    (AUTH_MEMBERS["limited"][0],),
                )
            browser = signed_in(TestClient(app), "limited")
        elif state == "anonymous":
            browser = Browser(TestClient(app)).prepare().anonymous()
        else:
            for name in list(client.cookies.keys()):
                if "session" in name:
                    del client.cookies[name]
        for result in (issue(browser), create(browser, key), read(browser, key)):
            error(
                result,
                403 if state == "limited" else 401,
                "PASSWORD_CHANGE_REQUIRED" if state == "limited" else "AUTH_REQUIRED",
            )


def test_protected_request_headers_are_checked_on_issue_and_create(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        cases = [
            ("Origin", None, 403, "ORIGIN_REJECTED"),
            ("Origin", "https://evil.test", 403, "ORIGIN_REJECTED"),
            ("X-CSRF-Token", None, 403, "CSRF_INVALID"),
            ("X-CSRF-Token", "bad", 403, "CSRF_INVALID"),
            ("X-EduVibe-Flow-Id", str(uuid4()), 401, "AUTH_REQUIRED"),
            ("X-EduVibe-Flow-Id", "bad", 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Auth-Revision", "0", 409, "AUTH_STATE_CHANGED"),
            ("X-EduVibe-Session-Generation", "0", 409, "AUTH_STATE_CHANGED"),
            ("X-EduVibe-Auth-Revision", None, 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Session-Generation", None, 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Auth-Revision", "no", 422, "VALIDATION_ERROR"),
        ]
        for name, value, status, code in cases:
            selected = headers(browser)
            if value is None:
                selected.pop(name)
            else:
                selected[name] = value
            for result in (
                issue(browser, headers=selected),
                create(browser, key, headers={**selected, "Idempotency-Key": key}),
            ):
                error(result, status, code)
        # Protected result reads need revision/generation, but no Origin or CSRF.
        selected = {
            k: v
            for k, v in headers(browser).items()
            if k not in ("Origin", "X-CSRF-Token")
        }
        assert read(browser, key, headers=selected).status_code == 200
        permit = browser.admit("logout")
        assert permit.status_code == 201
        for result in (issue(browser), create(browser, key), read(browser, key)):
            error(result, 409, "AUTH_TRANSITION_PENDING")


def test_public_private_visibility_and_restart(member_app):
    app, _ = member_app()
    with (
        TestClient(app) as client,
        TestClient(app) as public,
        TestClient(app) as stranger_client,
        TestClient(app) as admin_client,
    ):
        owner = signed_in(client)
        stranger = signed_in(stranger_client, "hangul")
        admin = signed_in(admin_client, "admin")
        public_key = issued_key(owner)
        saved = create(owner, public_key).json()["item"]
        assert public.get(f"{API}/apps/{saved['id']}").json()["item"] == saved
        for query in (
            "",
            "?q=새",
            f"?subject={INPUT['subject']}",
            f"?grade={INPUT['grades'][0]}",
        ):
            page = public.get(f"{API}/apps{query}").json()
            assert page["pagination"]["total"] == 1
            assert [row["id"] for row in page["items"]] == [saved["id"]]
        before = public.get(f"{API}/apps").json()
        private_input = {**INPUT, "name": "숨긴 앱", "is_public": False}
        key = issued_key(owner, private_input)
        private = create(owner, key, private_input).json()["item"]
        after = public.get(f"{API}/apps").json()
        before.pop("server_time")
        after.pop("server_time")
        assert before == after
        assert public.get(f"{API}/apps?q=숨긴").json()["pagination"]["total"] == 0
        for browser in (owner, admin):
            result = browser.client.get(
                f"{API}/apps/{private['id']}", headers=headers(browser)
            )
            assert result.status_code == 200, result.text
            assert result.headers["Cache-Control"] == "private, no-store"
        for reader, selected in ((public, {}), (stranger_client, headers(stranger))):
            result = reader.get(f"{API}/apps/{private['id']}", headers=selected)
            absent = reader.get(f"{API}/apps/{uuid4()}", headers=selected)
            assert result.status_code == absent.status_code == 404
            assert result.json() == absent.json()
        cookies = dict(client.cookies)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        owner.client = restarted
        assert read(owner, key).json()["target_id"] == private["id"]
        assert create(owner, key, private_input).json()["item"] == private
        assert restarted.get(f"{API}/apps/{saved['id']}").json()["item"] == saved


def test_rejected_key_cannot_create_and_invalid_input_does_not_wait_for_write_lock(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        with sqlite3.connect(path) as blocker:
            blocker.execute("BEGIN IMMEDIATE")
            for result in (
                issue(browser, {**INPUT, "name": " "}),
                create(browser, key, {**INPUT, "name": " "}),
                issue(browser, {**INPUT, "is_public": "true"}),
                create(browser, key, {**INPUT, "is_public": "true"}),
            ):
                error(result, 422, "VALIDATION_ERROR")
            blocker.rollback()
            blocker.execute(
                "UPDATE write_operations SET state='rejected',failure_code='OPERATION_CANCELLED' WHERE key=?",
                (key,),
            )
        error(create(browser, key), 409, "OPERATION_ALREADY_RESOLVED")
        assert read(browser, key).json()["state"] == "rejected"
        assert client.get(f"{API}/apps").json()["pagination"]["total"] == 0


def test_expiry_cleanup_and_restore_invalidation_do_not_erase_saved_apps(member_app):
    from app.auth_maintenance import reconcile, sweep

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        saved = create(browser, key).json()["item"]
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE write_operations SET expires_at='2000-01-01T00:00:00.000000Z' WHERE key=?",
                (key,),
            )
        sweep(app.state.session_factory)
        error(read(browser, key), 404, "OPERATION_NOT_FOUND")
        error(create(browser, key), 404, "OPERATION_NOT_FOUND")
        second = issued_key(browser)
        reconcile(app.state.session_factory, restored=True)
        fresh = signed_in(TestClient(app))
        error(read(fresh, second), 404, "OPERATION_NOT_FOUND")
        error(create(fresh, second), 404, "OPERATION_NOT_FOUND")
        assert fresh.client.get(f"{API}/apps/{saved['id']}").json()["item"] == saved
