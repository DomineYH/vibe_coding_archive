"""Administrators manage apps through the same member write API."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from tests.app_create_client import API, INPUT, error, read
from tests.app_delete_client import delete, delete_key, issue_delete
from tests.app_update_client import detail, issue_update, registered, update, update_key
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import headers
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("owner_kind", ["approved", "admin", "hangul"])
@pytest.mark.parametrize("public", [True, False])
def test_admin_manages_public_private_own_and_other_admin_apps(
    member_app, owner_kind, public
):
    app, path = member_app()
    if owner_kind == "hangul":
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET is_admin=1 WHERE id=?", (AUTH_MEMBERS["hangul"][0],)
            )
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner = signed_in(owner_client, owner_kind)
        admin = signed_in(admin_client, "admin")
        original = registered(owner, {**INPUT, "is_public": public})
        listing = admin_client.get(f"{API}/admin/apps", headers=headers(admin))
        assert listing.json()["items"][0]["id"] == original["id"]
        patch = {"name": "관리자가 편집한 앱", "is_public": not public}
        key = update_key(admin, original["id"], patch)
        assert detail(owner, original["id"]).json()["item"] == original
        if owner_kind != "admin":
            error(read(owner, key), 404, "OPERATION_NOT_FOUND")
        result = update(admin, original["id"], key, patch)
        assert result.status_code == 200, result.text
        edited = result.json()["item"]
        assert edited["name"] == patch["name"]
        assert edited["is_public"] is not public
        assert edited["version"] == 2
        assert edited["owner"] == original["owner"]
        assert detail(owner, original["id"]).json()["item"] == edited
        assert read(admin, key).json()["result_version"] == 2
        with sqlite3.connect(path) as db:
            audits = db.execute(
                "SELECT actor_id,target_id,occurred_at,outcome FROM audit_logs WHERE action='app_update'"
            ).fetchall()
        assert audits == (
            []
            if owner_kind == "admin"
            else [
                (
                    AUTH_MEMBERS["admin"][0],
                    original["id"],
                    edited["updated_at"],
                    "succeeded",
                )
            ]
        )
        error(
            update(admin, original["id"], key, patch), 409, "OPERATION_ALREADY_RESOLVED"
        )
        key = delete_key(admin, original["id"], version=2)
        result = delete(admin, original["id"], key, version=2)
        assert result.status_code == 204 and result.content == b""
        assert read(admin, key).json()["state"] == "succeeded"
        missing = detail(owner, original["id"])
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "NOT_FOUND"
        assert (
            admin_client.get(f"{API}/admin/apps", headers=headers(admin)).json()[
                "items"
            ]
            == []
        )


def test_admin_edit_audit_failure_rolls_back_the_entire_edit(member_app):
    app, path = member_app()
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner = signed_in(owner_client)
        admin = signed_in(admin_client, "admin")
        original = registered(owner)
        patch = {
            "name": "감사와 함께 편집",
            "url": "https://example.com/changed",
            "is_public": False,
            "grades": ["중1"],
        }
        key = update_key(admin, original["id"], patch)
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs "
                "WHEN NEW.action='app_update' BEGIN SELECT RAISE(ABORT,'injected'); END"
            )
        error(update(admin, original["id"], key, patch), 503, "SERVICE_UNAVAILABLE")
        assert detail(owner, original["id"]).json()["item"] == original
        assert read(admin, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            db.execute("DROP TRIGGER fail_audit")
        assert update(admin, original["id"], key, patch).status_code == 200
        error(
            update(admin, original["id"], key, patch), 409, "OPERATION_ALREADY_RESOLVED"
        )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT action,actor_id,target_id,outcome FROM audit_logs WHERE action='app_update'"
            ).fetchall() == [
                ("app_update", AUTH_MEMBERS["admin"][0], original["id"], "succeeded")
            ]
            # The existing schema stores minimum metadata, never the edit body.
            assert {r[1] for r in db.execute("PRAGMA table_info(audit_logs)")} == {
                "id",
                "action",
                "actor_id",
                "target_id",
                "occurred_at",
                "outcome",
            }


@pytest.mark.parametrize("kind", ["update", "delete"])
@pytest.mark.parametrize("public", [True, False])
def test_demoted_admin_loses_new_foreign_writes_but_keeps_actor_bound_history(
    member_app, kind, public
):
    app, path = member_app()
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner, admin = signed_in(owner_client), signed_in(admin_client, "admin")
        item = registered(owner, {**INPUT, "is_public": public})
        issue, apply = (
            (issue_update, update) if kind == "update" else (issue_delete, delete)
        )
        key = issue(admin, item["id"]).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET is_admin=0 WHERE id=?", (AUTH_MEMBERS["admin"][0],)
            )
        for result in (issue(admin, item["id"]), apply(admin, item["id"], key)):
            error(
                result, 403 if public else 404, "FORBIDDEN" if public else "NOT_FOUND"
            )
        assert read(admin, key).json()["state"] == "unresolved"
        assert detail(owner, item["id"]).json()["item"] == item


@pytest.mark.parametrize("kind", ["update", "delete"])
def test_demoted_actor_can_read_completed_minimum_result_without_target_access(
    member_app, kind
):
    app, path = member_app()
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner, admin = signed_in(owner_client), signed_in(admin_client, "admin")
        item = registered(owner, {**INPUT, "is_public": False})
        issue, apply = (
            (issue_update, update) if kind == "update" else (issue_delete, delete)
        )
        key = issue(admin, item["id"]).json()["key"]
        assert apply(admin, item["id"], key).status_code == (
            200 if kind == "update" else 204
        )
        result = read(admin, key).json()
        assert result["state"] == "succeeded"
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET is_admin=0 WHERE id=?", (AUTH_MEMBERS["admin"][0],)
            )
        assert detail(admin, item["id"]).status_code == 404
        history = read(admin, key).json()
        history.pop("server_time")
        result.pop("server_time")
        assert history == result


@pytest.mark.parametrize("kind", ["update", "delete"])
@pytest.mark.parametrize("recent", [None, "2000-01-01T00:00:00.000000Z"])
def test_admin_app_writes_do_not_require_recent_account_authentication(
    member_app, kind, recent
):
    app, path = member_app()
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner, admin = signed_in(owner_client), signed_in(admin_client, "admin")
        item = registered(owner, {**INPUT, "is_public": False})
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE sessions SET recent_auth_until=? WHERE member_id=?",
                (recent, AUTH_MEMBERS["admin"][0]),
            )
        issue, apply = (
            (issue_update, update) if kind == "update" else (issue_delete, delete)
        )
        issued = issue(admin, item["id"])
        assert issued.status_code == 201
        assert apply(admin, item["id"], issued.json()["key"]).status_code == (
            200 if kind == "update" else 204
        )


@pytest.mark.parametrize("public", [True, False])
def test_admin_key_is_invisible_to_owner_and_another_admin(member_app, public):
    app, path = member_app()
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET is_admin=1 WHERE id=?", (AUTH_MEMBERS["hangul"][0],)
        )
    with (
        TestClient(app) as owner_client,
        TestClient(app) as admin_client,
        TestClient(app) as other_client,
    ):
        owner = signed_in(owner_client)
        admin = signed_in(admin_client, "admin")
        other = signed_in(other_client, "hangul")
        item = registered(owner, {**INPUT, "is_public": public})
        for issue, apply in ((issue_update, update), (issue_delete, delete)):
            key = issue(admin, item["id"]).json()["key"]
            for stranger in (owner, other):
                error(read(stranger, key), 404, "OPERATION_NOT_FOUND")
                error(apply(stranger, item["id"], key), 404, "OPERATION_NOT_FOUND")


@pytest.mark.parametrize("kind", ["update", "delete"])
@pytest.mark.parametrize(
    "state",
    ["pending", "revoked", "must_change", "change_only", "session_expired", "unready"],
)
def test_admin_foreign_app_operations_require_current_approved_full_authority(
    member_app, kind, state
):
    app, path = member_app()
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner, admin = signed_in(owner_client), signed_in(admin_client, "admin")
        item = registered(owner, {**INPUT, "is_public": False})
        issue, apply = (
            (issue_update, update) if kind == "update" else (issue_delete, delete)
        )
        issued = issue(admin, item["id"])
        assert issued.status_code == 201
        key = issued.json()["key"]
        with sqlite3.connect(path) as db:
            actor_id = AUTH_MEMBERS["admin"][0]
            if state in ("pending", "revoked"):
                db.execute(
                    "UPDATE members SET approval_status=?,first_approved_at=? WHERE id=?",
                    (
                        state,
                        None if state == "pending" else "2026-09-28T12:00:00.000000Z",
                        actor_id,
                    ),
                )
            elif state in ("must_change", "change_only"):
                db.execute(
                    "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00.000000Z' WHERE id=?",
                    (actor_id,),
                )
                if state == "change_only":
                    db.execute(
                        "UPDATE sessions SET kind='change_only' WHERE member_id=?",
                        (actor_id,),
                    )
            elif state == "session_expired":
                db.execute(
                    "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000000Z' WHERE member_id=?",
                    (actor_id,),
                )
        if state == "unready":
            app.state.auth_ready = False
        try:
            status, code = (
                (403, "PASSWORD_CHANGE_REQUIRED")
                if state in ("must_change", "change_only")
                else (503, "FEATURE_UNAVAILABLE")
                if state == "unready"
                else (401, "AUTH_REQUIRED")
            )
            for result in (
                issue(admin, item["id"]),
                apply(admin, item["id"], key),
                read(admin, key),
            ):
                error(result, status, code)
        finally:
            app.state.auth_ready = True
        assert detail(owner, item["id"]).json()["item"] == item
