import sqlite3
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from tests.app_create_client import API, INPUT, create, error, issued_key, read
from tests.app_update_client import (
    PATCH,
    detail,
    issue_update,
    registered,
    update,
    update_key,
)
from tests.auth_client import Browser, signed_in
from tests.contracts.test_admin_approval import cancel, execute, headers
from tests.contracts.test_app_create import OPERATION_FIELDS
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("actor", ["approved", "admin"])
def test_owner_issues_edits_replays_and_reads_minimal_persistent_result(
    member_app, actor
):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client, actor)
        original = registered(owner)
        issued = issue_update(owner, original["id"])
        assert issued.status_code == 201, issued.text
        op = issued.json()
        assert set(op) == OPERATION_FIELDS
        assert (op["kind"], op["target_id"], op["state"]) == (
            "app_update",
            original["id"],
            "unresolved",
        )
        assert all(
            op[field] is None
            for field in (
                "result_version",
                "db_applied_at",
                "finalized_at",
                "rejection_code",
            )
        )
        assert datetime.fromisoformat(op["expires_at"]) - datetime.fromisoformat(
            op["issued_at"]
        ) == timedelta(days=1)
        assert detail(owner, original["id"]).json()["item"] == original
        saved = update(owner, original["id"], op["key"])
        assert saved.status_code == 200, saved.text
        item = saved.json()["item"]
        assert item["name"] == PATCH["name"]
        assert item["version"] == 2 and item["url_version"] == 1
        assert (
            item["owner"] == original["owner"]
            and item["created_at"] == original["created_at"]
        )
        assert item["updated_at"] > original["updated_at"]
        result = read(owner, op["key"])
        assert set(result.json()) == OPERATION_FIELDS
        assert result.json()["state"] == "succeeded"
        assert result.json()["result_version"] == 2
        assert (
            result.json()["db_applied_at"]
            == result.json()["finalized_at"]
            == item["updated_at"]
        )
        assert result.json()["expires_at"] == op["expires_at"]
        for response in (issued, saved, result):
            assert response.headers["Cache-Control"] == (
                "no-store" if response is saved else "private, no-store"
            )
            assert response.headers["X-EduVibe-Flow-Id"] == owner.flow
        error(
            update(owner, original["id"], op["key"]), 409, "OPERATION_ALREADY_RESOLVED"
        )
        error(
            update(owner, original["id"], op["key"], {"name": "different"}),
            409,
            "OPERATION_KEY_MISMATCH",
        )
        for result in (
            update(owner, str(uuid4()), op["key"]),
            update(owner, original["id"], op["key"], version=2),
        ):
            error(result, 409, "OPERATION_KEY_MISMATCH")
        assert detail(owner, original["id"]).json()["item"] == item
        cookies = dict(client.cookies)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        owner.client = restarted
        assert detail(owner, item["id"]).json()["item"] == item
        with sqlite3.connect(path) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("DELETE FROM apps WHERE id=?", (item["id"],))
        assert read(owner, op["key"]).json()["result_version"] == 2


def test_patch_route_exists_on_unchanged_source(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        error(update(owner, item["id"], str(uuid4())), 404, "OPERATION_NOT_FOUND")


@pytest.mark.parametrize("public", [True, False])
@pytest.mark.parametrize("actor", ["hangul"])
def test_other_member_cannot_edit_foreign_target(member_app, public, actor):
    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as foreign_client:
        owner, other = signed_in(client), signed_in(foreign_client, actor)
        item = registered(owner, {**INPUT, "is_public": public})
        key = update_key(other, registered(other)["id"])
        for result in (issue_update(other, item["id"]), update(other, item["id"], key)):
            # Execution verifies key binding before target authority.
            code = (
                "OPERATION_KEY_MISMATCH"
                if result.request.method == "PATCH"
                else ("FORBIDDEN" if public else "NOT_FOUND")
            )
            error(
                result,
                409 if result.request.method == "PATCH" else (403 if public else 404),
                code,
            )
        if not public:
            absent = issue_update(other, str(uuid4()))
            denied = issue_update(other, item["id"])
            assert denied.status_code == absent.status_code == 404
            left, right = denied.json(), absent.json()
            left["error"].pop("request_id")
            right["error"].pop("request_id")
            assert left == right
            assert denied.headers == absent.headers
            assert denied.headers["Cache-Control"] == "no-store"
            assert denied.headers["Content-Type"] == "application/json"
        own_key = update_key(owner, item["id"])
        error(update(other, item["id"], own_key), 404, "OPERATION_NOT_FOUND")
        error(read(other, own_key), 404, "OPERATION_NOT_FOUND")
        assert detail(owner, item["id"]).json()["item"] == item


@pytest.mark.parametrize(
    "state", ["anonymous", "pending", "revoked", "limited", "missing_cookie"]
)
def test_issue_patch_result_require_current_approved_full_session(member_app, state):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = update_key(owner, item["id"])
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
            owner = signed_in(TestClient(app), "limited")
        elif state == "anonymous":
            owner = Browser(TestClient(app)).prepare().anonymous()
        else:
            for name in list(client.cookies):
                if "session" in name:
                    del client.cookies[name]
        for result in (
            issue_update(owner, item["id"]),
            update(owner, item["id"], key),
            read(owner, key),
        ):
            error(
                result,
                403 if state == "limited" else 401,
                "PASSWORD_CHANGE_REQUIRED" if state == "limited" else "AUTH_REQUIRED",
            )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT name,version FROM apps").fetchall() == [
                (INPUT["name"], 1)
            ]
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_edit_protected_headers_and_pending_transition(member_app, writer):
    app, _ = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        key = update_key(actor, item["id"])
        for name, value, status, code in [
            ("Origin", None, 403, "ORIGIN_REJECTED"),
            ("Origin", "https://evil.test", 403, "ORIGIN_REJECTED"),
            ("X-CSRF-Token", None, 403, "CSRF_INVALID"),
            ("X-CSRF-Token", "bad", 403, "CSRF_INVALID"),
            ("X-EduVibe-Flow-Id", None, 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Flow-Id", "bad", 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Flow-Id", str(uuid4()), 401, "AUTH_REQUIRED"),
            ("X-EduVibe-Auth-Revision", None, 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Auth-Revision", "bad", 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Auth-Revision", "0", 409, "AUTH_STATE_CHANGED"),
            ("X-EduVibe-Session-Generation", None, 422, "VALIDATION_ERROR"),
            ("X-EduVibe-Session-Generation", "0", 409, "AUTH_STATE_CHANGED"),
        ]:
            selected = headers(actor)
            if value is None:
                selected.pop(name)
            else:
                selected[name] = value
            for result in (
                issue_update(actor, item["id"], headers=selected),
                update(
                    actor, item["id"], key, headers={**selected, "Idempotency-Key": key}
                ),
            ):
                error(result, status, code)
            if name not in ("Origin", "X-CSRF-Token"):
                error(read(actor, key, headers=selected), status, code)
        assert (
            read(
                actor,
                key,
                headers={
                    k: v
                    for k, v in headers(actor).items()
                    if k not in ("Origin", "X-CSRF-Token")
                },
            ).status_code
            == 200
        )
        assert actor.admit("logout").status_code == 201
        for result in (
            issue_update(actor, item["id"]),
            update(actor, item["id"], key),
            read(actor, key),
        ):
            error(result, 409, "AUTH_TRANSITION_PENDING")


def test_mismatch_conflict_and_registration_replay_are_distinct(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client, "admin")
        create_key = issued_key(owner)
        item = create(owner, create_key).json()["item"]
        key = update_key(owner, item["id"])
        for result in (
            update(owner, str(uuid4()), key),
            update(owner, item["id"], key, version=2),
            update(owner, item["id"], create_key),
            create(owner, key),
            execute(owner, key),
        ):
            error(result, 409, "OPERATION_KEY_MISMATCH")
        error(cancel(owner, key), 409, "OPERATION_KIND_NOT_CANCELLABLE")
        assert read(owner, key).json()["state"] == "unresolved"
        second = update_key(owner, item["id"])
        assert update(owner, item["id"], key).status_code == 200
        for response in (
            issue_update(owner, item["id"]),
            update(owner, item["id"], second),
        ):
            error(response, 409, "VERSION_CONFLICT")
            assert response.json()["error"]["message"] == (
                "다른 곳에서 먼저 바뀌었어요. 최신 내용을 확인해 주세요."
            )
            assert response.headers["Cache-Control"] == "no-store"
            assert "Retry-After" not in response.headers
        result = read(owner, second).json()
        assert (
            result["state"] == "rejected"
            and result["rejection_code"] == "VERSION_CONFLICT"
        )
        assert result["db_applied_at"] is None and result["result_version"] is None
        assert result["finalized_at"] is not None
        error(update(owner, item["id"], second), 409, "OPERATION_ALREADY_RESOLVED")
        assert create(owner, create_key).status_code == 201
        assert read(owner, create_key).json()["kind"] == "app_create"


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_visibility_changes_immediately_hide_lists_facets_and_detail(
    member_app, writer
):
    app, _ = member_app()
    with (
        TestClient(app) as client,
        TestClient(app) as guest,
        TestClient(app) as other_client,
        TestClient(app) as admin_client,
    ):
        owner, other, admin = (
            signed_in(client),
            signed_in(other_client, "hangul"),
            signed_in(admin_client, "admin"),
        )
        item = registered(owner)
        for version, public in [(1, False), (2, True)]:
            patch = {"is_public": public}
            writer_actor = admin if writer == "admin" else owner
            key = update_key(writer_actor, item["id"], patch, version)
            saved = update(writer_actor, item["id"], key, patch, version)
            assert saved.status_code == 200, saved.text
            for query in (
                "",
                "?q=새",
                f"?subject={INPUT['subject']}",
                f"?grade={INPUT['grades'][0]}",
            ):
                page = guest.get(f"{API}/apps{query}").json()
                assert page["pagination"]["total"] == int(public)
                assert len(page["items"]) == int(public)
                assert page["facets"]["subjects_in_use"] == (
                    [INPUT["subject"]] if public else []
                )
            for reader, selected in ((guest, {}), (other_client, headers(other))):
                response = reader.get(f"{API}/apps/{item['id']}", headers=selected)
                assert response.status_code == (200 if public else 404)
                if not public:
                    assert (
                        response.json()
                        == reader.get(f"{API}/apps/{uuid4()}", headers=selected).json()
                    )
            for actor in (owner, admin):
                assert detail(actor, item["id"]).json()["item"]["is_public"] is public


def test_ownership_is_rechecked_at_execution_and_key_is_not_consumed(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = update_key(owner, item["id"])
        for public in (True, False):
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE apps SET owner_id=?,is_public=? WHERE id=?",
                    (AUTH_MEMBERS["hangul"][0], int(public), item["id"]),
                )
            error(
                update(owner, item["id"], key),
                403 if public else 404,
                "FORBIDDEN" if public else "NOT_FOUND",
            )
            assert read(owner, key).json()["state"] == "unresolved"


def test_expired_edit_keys_never_extend_and_shared_sweep_restore_remove_them(
    member_app, monkeypatch
):
    from datetime import UTC

    from app.auth_maintenance import reconcile, sweep

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
        expiry = read(owner, key).json()["expires_at"]
        clock[0] = datetime.fromisoformat(expiry) - timedelta(seconds=1)
        fresh = signed_in(fresh_client)
        assert read(fresh, key).json()["expires_at"] == expiry
        clock[0] = datetime.fromisoformat(expiry)
        for result in (read(fresh, key), update(fresh, item["id"], key)):
            error(result, 410, "OPERATION_EXPIRED")
        sweep(app.state.session_factory)
        error(read(fresh, key), 404, "OPERATION_NOT_FOUND")
        new = update_key(fresh, item["id"])
        reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM write_operations WHERE key=?", (new,)
            ).fetchone() == (0,)
            assert db.execute("SELECT version FROM apps").fetchone() == (1,)


def test_edit_unavailable_and_version_overflow_do_not_resolve_key(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        with sqlite3.connect(path) as db:
            db.execute("UPDATE apps SET version=9007199254740991")
        key = update_key(owner, item["id"], version=9007199254740991)
        error(
            update(owner, item["id"], key, version=9007199254740991),
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert read(owner, key).json()["state"] == "unresolved"
        app.state.auth_ready = False
        for result in (
            issue_update(owner, item["id"]),
            update(owner, item["id"], key),
            read(owner, key),
        ):
            error(result, 503, "FEATURE_UNAVAILABLE")
