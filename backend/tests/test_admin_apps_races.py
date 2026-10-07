"""Separate connections change the app set or authority around admin app reads."""

import sqlite3

from fastapi.testclient import TestClient
from sqlalchemy import event

from tests.admin_apps_fixtures import (
    ADMIN_ID,
    APPROVED_ID,
    app_id,
    seed_apps,
)
from tests.auth_client import signed_in
from tests.contracts.test_admin_apps import MIXED, URL, code, context, get


def after_page(app, action):
    """Run action once, on another connection, right after the page statement."""
    done = []

    def hook(conn, cursor, statement, parameters, context_, executemany):
        if "FROM apps JOIN members" in statement and not done:
            done.append(True)
            action()

    event.listen(app.state.engine, "after_cursor_execute", hook)
    return lambda: event.remove(app.state.engine, "after_cursor_execute", hook)


def test_total_and_page_come_from_one_snapshot(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)

    def insert_other():
        seed_apps(path, [(9, APPROVED_ID, True, "2026-09-30T00:00:00.000000Z")])

    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        remove = after_page(app, insert_other)
        try:
            raced = get(client, admin, "?limit=24").json()
        finally:
            remove()
        assert len(raced["items"]) == raced["pagination"]["total"] == 4
        assert app_id(9) not in {item["id"] for item in raced["items"]}
        later = get(client, admin).json()
        assert later["pagination"]["total"] == 5
        assert later["items"][0]["id"] == app_id(9)


def test_authority_revoked_after_admission_finishes_only_that_snapshot(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)

    def revoke():
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET approval_status='revoked' WHERE id=?", (ADMIN_ID,)
            )

    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        remove = after_page(app, revoke)
        try:
            admitted = get(client, admin)
        finally:
            remove()
        assert admitted.status_code == 200
        refused = get(client, admin)
        assert (refused.status_code, code(refused)) == (401, "AUTH_REQUIRED")
        assert "items" not in refused.json()


def test_offset_paging_across_inserts_and_deletes_is_self_consistent(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        first = get(client, admin, "?limit=2").json()
        assert [item["id"] for item in first["items"]] == [app_id(4), app_id(3)]
        seed_apps(path, [(8, ADMIN_ID, False, "2026-09-30T00:00:00.000000Z")])
        second = get(client, admin, "?limit=2&offset=2").json()
        # Offset paging repeats the shifted row; totals stay whole-set accurate.
        assert [item["id"] for item in second["items"]] == [app_id(3), app_id(2)]
        assert second["pagination"] == {
            "limit": 2,
            "offset": 2,
            "total": 5,
            "has_more": True,
        }
        with sqlite3.connect(path) as db:
            db.execute(
                "DELETE FROM apps WHERE id IN (?,?,?)",
                (app_id(8), app_id(4), app_id(3)),
            )
        refreshed = get(client, admin, "?limit=2").json()
        assert [item["id"] for item in refreshed["items"]] == [app_id(2), app_id(1)]
        assert refreshed["pagination"]["total"] == 2
        assert refreshed["pagination"]["has_more"] is False


def test_expired_session_and_old_flow_are_refused(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client, TestClient(app) as other:
        admin = signed_in(client, "admin")
        old = context(admin)
        assert admin.logout().status_code in (200, 204)
        result = other.get(URL, headers=old)
        assert result.status_code in (401, 409)
        assert "items" not in result.json()
        fresh = signed_in(other, "admin")
        with sqlite3.connect(path) as db:
            db.execute("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000000Z'")
        expired = get(other, fresh)
        assert expired.status_code in (401, 409)
        assert "items" not in expired.json()
