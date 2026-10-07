import sqlite3
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.app_create_client import API, INPUT, error, read
from tests.app_delete_client import delete, delete_key, issue_delete
from tests.app_update_client import detail, registered, update, update_key
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import headers
from tests.contracts.test_app_create import OPERATION_FIELDS
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("actor", ["approved", "admin"])
@pytest.mark.parametrize("public", [True, False])
def test_delete_issue_execution_history_and_read_effects(member_app, actor, public):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as guest:
        owner = signed_in(client, actor)
        original = registered(owner, {**INPUT, "is_public": public})
        edit_key = update_key(owner, original["id"])
        issued = issue_delete(owner, original["id"])
        assert issued.status_code == 201, issued.text
        op = issued.json()
        assert set(op) == OPERATION_FIELDS
        assert op["kind"] == "app_delete" and op["state"] == "unresolved"
        assert all(
            op[f] is None
            for f in (
                "db_applied_at",
                "finalized_at",
                "result_version",
                "rejection_code",
            )
        )
        assert datetime.fromisoformat(op["expires_at"]) - datetime.fromisoformat(
            op["issued_at"]
        ) == timedelta(days=1)
        assert detail(owner, original["id"]).json()["item"] == original
        saved = delete(owner, original["id"], op["key"])
        assert saved.status_code == 204, saved.text
        assert saved.content == b"" and saved.headers["Cache-Control"] == "no-store"
        result = read(owner, op["key"])
        assert result.status_code == 200 and set(result.json()) == OPERATION_FIELDS
        assert result.json()["state"] == "succeeded"
        assert result.json()["result_version"] is None
        assert (
            result.json()["db_applied_at"] is not None
            and result.json()["finalized_at"] is not None
        )
        assert result.json()["expires_at"] == op["expires_at"]
        for response in (issued, result):
            assert response.headers["Cache-Control"] == "private, no-store"
        error(
            delete(owner, original["id"], op["key"]), 409, "OPERATION_ALREADY_RESOLVED"
        )
        error(
            delete(owner, original["id"], op["key"], 2), 409, "OPERATION_KEY_MISMATCH"
        )
        missing = detail(owner, original["id"])
        assert (
            missing.status_code == 404
            and missing.json()["error"]["code"] == "NOT_FOUND"
        )
        assert read(owner, edit_key).json()["state"] == "unresolved"
        error(update(owner, original["id"], edit_key), 404, "NOT_FOUND")
        assert read(owner, edit_key).json()["rejection_code"] == "NOT_FOUND"
        for suffix in ("", "?q=새", f"?subject={INPUT['subject']}"):
            page = guest.get(f"{API}/apps{suffix}").json()
            assert page["items"] == [] and page["pagination"]["total"] == 0
        with sqlite3.connect(path) as db:
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            for table in ("apps", "app_grades", "health_results"):
                assert db.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
            assert db.execute(
                "SELECT action,outcome FROM audit_logs WHERE action='app_delete'"
            ).fetchall() == [("app_delete", "db_applied")]
            assert db.execute("SELECT count(*) FROM app_delete_outbox").fetchone() == (
                1,
            )


def test_delete_route_and_key_boundary_before_target(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        error(delete(owner, item["id"], str(uuid4())), 404, "OPERATION_NOT_FOUND")


def test_delete_stale_version_message_at_both_boundaries(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        assert (
            update(owner, item["id"], update_key(owner, item["id"])).status_code == 200
        )
        for response in (
            issue_delete(owner, item["id"]),
            delete(owner, item["id"], key),
        ):
            error(response, 409, "VERSION_CONFLICT")
            assert response.json()["error"]["message"] == (
                "다른 곳에서 먼저 바뀌었어요. 최신 내용을 확인해 주세요."
            )
            assert response.headers["Cache-Control"] == "no-store"
            assert "Retry-After" not in response.headers
        assert detail(owner, item["id"]).json()["item"]["version"] == 2
        result = read(owner, key).json()
        assert result["state"] == "rejected"
        assert result["rejection_code"] == "VERSION_CONFLICT"


@pytest.mark.parametrize("public", [True, False])
@pytest.mark.parametrize("actor", ["hangul"])
def test_delete_ownership_private_absence_parity_and_key_isolation(
    member_app, public, actor
):
    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as other_client:
        owner, other = signed_in(client), signed_in(other_client, actor)
        item = registered(owner, {**INPUT, "is_public": public})
        denied = issue_delete(other, item["id"], 100)
        error(denied, 403 if public else 404, "FORBIDDEN" if public else "NOT_FOUND")
        if not public:
            absent = issue_delete(other, str(uuid4()), 100)
            left, right = denied.json(), absent.json()
            left["error"].pop("request_id")
            right["error"].pop("request_id")
            assert left == right and denied.headers == absent.headers
        key = delete_key(owner, item["id"])
        error(delete(other, item["id"], key), 404, "OPERATION_NOT_FOUND")
        error(read(other, key), 404, "OPERATION_NOT_FOUND")


@pytest.mark.parametrize(
    "version", [True, False, 0, -1, 1.0, "1", None, 9007199254740992]
)
@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_delete_strict_versions_at_both_boundaries(member_app, version, writer):
    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        if writer == "admin":
            client = actor_client
        error(issue_delete(actor, item["id"], version), 422, "VALIDATION_ERROR")
        error(delete(actor, item["id"], str(uuid4()), version), 422, "VALIDATION_ERROR")


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_delete_protected_headers(member_app, writer):
    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        if writer == "admin":
            client = actor_client
        key = delete_key(actor, item["id"])
        for name, value, status, code in [
            ("Origin", None, 403, "ORIGIN_REJECTED"),
            ("Origin", "https://evil.test", 403, "ORIGIN_REJECTED"),
            ("X-CSRF-Token", None, 403, "CSRF_INVALID"),
            ("X-CSRF-Token", "bad", 403, "CSRF_INVALID"),
            ("X-EduVibe-Flow-Id", None, 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Flow-Id", str(uuid4()), 401, "AUTH_REQUIRED"),
            ("X-EduVibe-Auth-Revision", "0", 409, "AUTH_STATE_CHANGED"),
            ("X-EduVibe-Session-Generation", "0", 409, "AUTH_STATE_CHANGED"),
        ]:
            selected = headers(actor)
            if value is None:
                selected.pop(name)
            else:
                selected[name] = value
            error(issue_delete(actor, item["id"], headers=selected), status, code)
            error(
                delete(
                    actor, item["id"], key, headers={**selected, "Idempotency-Key": key}
                ),
                status,
                code,
            )
        assert read(actor, key).json()["state"] == "unresolved"


@pytest.mark.parametrize(
    "state", ["anonymous", "pending", "revoked", "limited", "missing_cookie"]
)
def test_delete_requires_current_approved_full_authority(member_app, state):
    from tests.auth_client import Browser

    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        if state in ("pending", "revoked"):
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET approval_status=?, first_approved_at=? WHERE id=?",
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
            owner = signed_in(TestClient(app), "limited")
        elif state == "anonymous":
            owner = Browser(TestClient(app)).prepare().anonymous()
        else:
            for name in list(client.cookies):
                if "session" in name:
                    del client.cookies[name]
        for result in (
            issue_delete(owner, item["id"]),
            delete(owner, item["id"], key),
            read(owner, key),
        ):
            error(
                result,
                403 if state == "limited" else 401,
                "PASSWORD_CHANGE_REQUIRED" if state == "limited" else "AUTH_REQUIRED",
            )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)
            assert db.execute("SELECT count(*) FROM app_delete_outbox").fetchone() == (
                0,
            )


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_delete_json_and_streamed_limits_preserve_auth_limit(member_app, writer):
    import json

    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        if writer == "admin":
            client = actor_client
        key = delete_key(actor, item["id"])
        selected = {
            **headers(actor),
            "Idempotency-Key": key,
            "Content-Type": "application/json",
        }
        for raw, status, code in [
            ("{", 400, "BAD_REQUEST"),
            ('{"expected_version":1,"expected_version":1}', 400, "BAD_REQUEST"),
            ('{"expected_version":1,"extra":1}', 422, "VALIDATION_ERROR"),
        ]:
            error(
                client.request(
                    "DELETE", f"{API}/apps/{item['id']}", content=raw, headers=selected
                ),
                status,
                code,
            )
        error(
            client.request(
                "DELETE",
                f"{API}/apps/{item['id']}",
                content=iter([b" " * 524288, b" " * 524289]),
                headers=selected,
            ),
            413,
            "PAYLOAD_TOO_LARGE",
        )
        padded = " " * 20000 + json.dumps(
            {"kind": "app_delete", "target_id": item["id"], "expected_version": 1}
        )
        assert (
            client.post(
                f"{API}/write-operations", content=padded, headers=selected
            ).status_code
            == 201
        )
        error(
            client.post(
                f"{API}/auth/flows", content=" " * 20000 + "{}", headers=selected
            ),
            413,
            "PAYLOAD_TOO_LARGE",
        )
        assert (
            client.request(
                "DELETE",
                f"{API}/apps/{item['id']}",
                content=" " * 20000 + '{"expected_version":1}',
                headers=selected,
            ).status_code
            == 204
        )


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_delete_missing_duplicate_malformed_keys_and_expiry(member_app, writer):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        if writer == "admin":
            client = actor_client
        key = delete_key(actor, item["id"])
        for value in (None, "bad", key.upper()):
            selected = headers(actor)
            if value is not None:
                selected["Idempotency-Key"] = value
            error(
                delete(actor, item["id"], key, headers=selected),
                422,
                "VALIDATION_ERROR",
            )
        error(
            delete(
                actor,
                item["id"],
                key,
                headers=list(headers(actor).items())
                + [("Idempotency-Key", key), ("Idempotency-Key", key)],
            ),
            422,
            "VALIDATION_ERROR",
        )
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE write_operations SET expires_at='2000-01-01T00:00:00Z' WHERE key=?",
                (key,),
            )
        for result in (read(actor, key), delete(actor, item["id"], key)):
            error(result, 410, "OPERATION_EXPIRED")


@pytest.mark.parametrize("pending", [False, True])
def test_delete_read_isolation_and_admin_counts_include_private_db_applied_effect(
    member_app, pending
):
    app, path = member_app()
    with (
        TestClient(app) as client,
        TestClient(app) as admin_client,
        TestClient(app) as foreign_client,
    ):
        owner, admin, other = (
            signed_in(client),
            signed_in(admin_client, "admin"),
            signed_in(foreign_client, "hangul"),
        )
        item = registered(owner, {**INPUT, "is_public": False})
        before = admin_client.get(f"{API}/admin/users", headers=headers(admin)).json()[
            "stats"
        ]["total_apps"]
        key = delete_key(owner, item["id"])
        if pending:
            with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
                ledger.execute("BEGIN IMMEDIATE")
                error(
                    delete(owner, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING"
                )
        else:
            assert delete(owner, item["id"], key).status_code == 204
        assert (
            admin_client.get(f"{API}/admin/users", headers=headers(admin)).json()[
                "stats"
            ]["total_apps"]
            == before - 1
        )
        for actor in (owner, admin, other):
            assert detail(actor, item["id"]).status_code == 404
        for actor in (admin, other):
            error(read(actor, key), 404, "OPERATION_NOT_FOUND")
