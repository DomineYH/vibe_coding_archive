"""Read-only administrator app list: authority, paging, DTO allowlist, statistics."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.admin_apps_fixtures import (
    ADMIN_ID,
    APPROVED_ID,
    SENTINELS,
    app_id,
    seed_apps,
)
from tests.auth_client import Browser, signed_in
from tests.support import AUTH_MEMBERS

API = "/api/v1"
URL = f"{API}/admin/apps"
PAGE_KEYS = {"items", "pagination", "server_time"}
ITEM_KEYS = {
    "id",
    "owner",
    "name",
    "url",
    "is_public",
    "theme_id",
    "version",
    "url_version",
    "created_at",
    "health",
}


def context(browser):
    return {
        "X-EduVibe-Flow-Id": browser.flow,
        "X-EduVibe-Auth-Revision": browser.revision,
        "X-EduVibe-Session-Generation": browser.generation,
    }


def get(client, browser, query=""):
    return client.get(f"{URL}{query}", headers=context(browser))


def code(result):
    return result.json()["error"]["code"]


def database_dump(path):
    with sqlite3.connect(path) as db:
        tables = [
            row[0]
            for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        return {
            table: sorted(db.execute(f"SELECT * FROM {table}").fetchall(), key=repr)
            for table in tables
        }


MIXED = [
    (1, APPROVED_ID, True, "2026-09-28T12:00:00.000000Z"),
    (2, ADMIN_ID, False, "2026-09-28T12:00:00.000000Z"),
    (3, APPROVED_ID, False, "2026-09-28T12:00:00.000000Z"),
    (4, ADMIN_ID, True, "2026-09-29T08:00:00.000000Z"),
]


def test_full_admin_without_recent_auth_reads_the_exact_minimal_page(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        with sqlite3.connect(path) as db:
            db.execute("UPDATE sessions SET recent_auth_until=NULL")
        result = get(client, admin, "?limit=2")
        assert result.status_code == 200, result.text
        assert result.headers["Cache-Control"] == "private, no-store"
        assert result.headers["X-EduVibe-Flow-Id"] == admin.flow
        assert result.headers["X-EduVibe-Auth-Revision"] == admin.revision
        assert result.headers["X-EduVibe-Session-Generation"] == admin.generation
        page = result.json()
        assert set(page) == PAGE_KEYS
        assert page["pagination"] == {
            "limit": 2,
            "offset": 0,
            "total": 4,
            "has_more": True,
        }
        assert [item["id"] for item in page["items"]] == [app_id(4), app_id(3)]
        for item in page["items"]:
            assert set(item) == ITEM_KEYS
            assert set(item["owner"]) == {"id", "nickname"}
            assert set(item["health"]) == {"state", "checked_at", "fresh_until"}
        assert page["items"][0] == {
            "id": app_id(4),
            "owner": {"id": ADMIN_ID, "nickname": AUTH_MEMBERS["admin"][2]},
            "name": "앱 4",
            "url": "https://example.test/4",
            "is_public": True,
            "theme_id": page["items"][0]["theme_id"],
            "version": 3,
            "url_version": 2,
            "created_at": "2026-09-29T08:00:00.000000Z",
            "health": {"state": "unchecked", "checked_at": None, "fresh_until": None},
        }
        assert page["items"][1]["is_public"] is False
        raw = result.text
        for sentinel in (*SENTINELS, AUTH_MEMBERS["admin"][1]):
            assert sentinel not in raw


def test_ties_order_by_descending_id_and_pages_are_stable(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        seen = []
        for offset in range(4):
            page = get(client, admin, f"?limit=1&offset={offset}").json()
            assert page["pagination"]["total"] == 4
            assert page["pagination"]["has_more"] is (offset < 3)
            seen += [item["id"] for item in page["items"]]
        assert seen == [app_id(4), app_id(3), app_id(2), app_id(1)]


def test_defaults_boundaries_and_out_of_range_offsets_are_ok(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        default = get(client, admin).json()["pagination"]
        assert default == {"limit": 24, "offset": 0, "total": 4, "has_more": False}
        assert get(client, admin, "?limit=100").status_code == 200
        assert get(client, admin, "?limit=001&offset=00").status_code == 200
        for offset in (4, 5, 9007199254740991):
            page = get(client, admin, f"?offset={offset}")
            assert page.status_code == 200
            assert page.json()["items"] == []
            assert page.json()["pagination"] == {
                "limit": 24,
                "offset": offset,
                "total": 4,
                "has_more": False,
            }


@pytest.mark.parametrize(
    "query",
    [
        "?limit=0",
        "?limit=101",
        "?limit=-1",
        "?limit=1.0",
        "?limit=1e1",
        "?limit=%201",
        "?limit=",
        "?limit=true",
        "?limit=abc",
        "?limit=%EF%BC%91",
        "?offset=-1",
        "?offset=1.5",
        "?offset=",
        "?offset=9007199254740992",
        "?offset=" + "9" * 40,
        "?limit=1&limit=2",
        "?offset=1&offset=2",
        "?sort=name",
        "?limit=1&search=x",
    ],
)
def test_invalid_paging_input_is_a_safe_422(member_app, query):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app, raise_server_exceptions=False) as client:
        admin = signed_in(client, "admin")
        result = get(client, admin, query)
        assert result.status_code == 422, result.text
        assert code(result) == "VALIDATION_ERROR"
        assert result.headers["Cache-Control"] == "no-store"
        assert set(result.json()) == {"error"}
        assert "items" not in result.text
        echoed = query.lstrip("?").split("=")[-1]
        assert not echoed or echoed not in result.json()["error"]["message"]


def tamper(path, sql, *args):
    with sqlite3.connect(path) as db:
        db.execute(sql, args)


def refuse(client, browser, expected):
    result = get(client, browser)
    assert (result.status_code, code(result)) == expected, result.text
    assert "items" not in result.json()
    assert result.headers["Cache-Control"] == "no-store"


def test_anonymous_and_headerless_requests_never_fall_back_to_public(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client, TestClient(app) as other:
        anonymous = Browser(client).prepare().anonymous()
        refuse(client, anonymous, (401, "AUTH_REQUIRED"))
        admin = signed_in(other, "admin")
        result = other.get(URL)
        assert (result.status_code, code(result)) == (422, "VALIDATION_ERROR")
        assert "items" not in result.json()
        with TestClient(app) as bare:
            result = bare.get(URL)
            assert result.status_code in (401, 422)
            assert "items" not in result.json()
        assert get(other, admin).status_code == 200


@pytest.mark.parametrize("name", ["pending", "revoked"])
def test_unapproved_members_are_refused(member_app, name):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        browser.login(AUTH_MEMBERS[name][1])
        refuse(client, browser, (401, "AUTH_REQUIRED"))


def test_ordinary_member_is_forbidden(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        refuse(client, signed_in(client, "approved"), (403, "FORBIDDEN"))


def test_approval_revoked_after_sign_in_is_refused(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        assert get(client, admin).status_code == 200
        tamper(
            path, "UPDATE members SET approval_status='revoked' WHERE id=?", ADMIN_ID
        )
        refuse(client, admin, (401, "AUTH_REQUIRED"))


def test_admin_role_removed_after_sign_in_is_refused(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        tamper(path, "UPDATE members SET is_admin=0 WHERE id=?", ADMIN_ID)
        refuse(client, admin, (403, "FORBIDDEN"))


@pytest.mark.parametrize("state", ["change_only", "must_change"])
def test_change_only_and_must_change_administrators_are_refused(member_app, state):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        tamper(
            path,
            "UPDATE members SET must_change_password=1,temporary_password_expires_at=? WHERE id=?",
            (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            ADMIN_ID,
        )
        if state == "change_only":
            tamper(
                path,
                "UPDATE sessions SET kind='change_only' WHERE member_id=?",
                ADMIN_ID,
            )
        refuse(client, admin, (403, "PASSWORD_CHANGE_REQUIRED"))


@pytest.mark.parametrize(
    "drop",
    [
        ["X-EduVibe-Flow-Id"],
        ["X-EduVibe-Auth-Revision"],
        ["X-EduVibe-Session-Generation"],
        ["X-EduVibe-Auth-Revision", "X-EduVibe-Session-Generation"],
    ],
)
def test_partial_read_context_is_rejected_without_data(member_app, drop):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        headers = {k: v for k, v in context(admin).items() if k not in drop}
        result = client.get(URL, headers=headers)
        assert (result.status_code, code(result)) == (422, "VALIDATION_ERROR")
        assert "items" not in result.json()


def test_stale_revision_or_generation_keeps_the_existing_errors(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        stale_revision = {**context(admin), "X-EduVibe-Auth-Revision": "0"}
        result = client.get(URL, headers=stale_revision)
        assert (result.status_code, code(result)) == (409, "AUTH_STATE_CHANGED")
        wrong_generation = {
            **context(admin),
            "X-EduVibe-Session-Generation": str(int(admin.generation) + 7),
        }
        result = client.get(URL, headers=wrong_generation)
        assert (result.status_code, code(result)) == (409, "AUTH_STATE_CHANGED")
        assert get(client, admin).status_code == 200


def test_pending_transition_is_conflict_not_public_fallback(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        assert admin.admit("reauthenticate").status_code == 201
        result = client.get(URL, headers=context(admin))
        assert (result.status_code, code(result)) == (409, "AUTH_TRANSITION_PENDING")
        assert "items" not in result.json()


def test_logged_out_session_cannot_read(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        context_before = context(admin)
        assert admin.logout().status_code in (200, 204)
        result = client.get(URL, headers=context_before)
        assert result.status_code in (401, 409)
        assert "items" not in result.json()


@pytest.mark.parametrize("auth", ["without_csrf_headers", "refused"])
def test_reading_writes_nothing_and_needs_no_csrf_or_origin(member_app, auth):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        before = database_dump(path)
        cookies = dict(client.cookies)
        if auth == "refused":
            tamper(path, "UPDATE members SET is_admin=0 WHERE id=?", ADMIN_ID)
            before = database_dump(path)
            assert get(client, admin).status_code == 403
        else:
            result = client.get(URL, headers=context(admin))
            assert result.status_code == 200
            assert "set-cookie" not in result.headers
        assert database_dump(path) == before
        assert dict(client.cookies) == cookies


def test_admin_owned_apps_are_listed_without_account_protection_errors(member_app):
    app, path = member_app()
    seed_apps(path, MIXED)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        owners = {item["owner"]["id"] for item in get(client, admin).json()["items"]}
        assert owners == {ADMIN_ID, APPROVED_ID}


def test_absent_health_row_is_unchecked_and_recorded_results_are_kept(member_app):
    app, path = member_app()
    seed_apps(
        path,
        [
            (
                5,
                APPROVED_ID,
                True,
                "2026-09-30T00:00:00.000000Z",
                (
                    "healthy",
                    "2026-09-30T00:00:00.000000Z",
                    "2026-09-30T01:00:00.000000Z",
                ),
            ),
            (
                6,
                APPROVED_ID,
                True,
                "2026-09-29T00:00:00.000000Z",
                (
                    "http_error",
                    "2026-09-29T00:00:00.000000Z",
                    "2026-09-29T01:00:00.000000Z",
                ),
            ),
            (7, APPROVED_ID, False, "2026-09-28T00:00:00.000000Z"),
        ],
    )
    tamper(path, "DELETE FROM health_results WHERE app_id=?", app_id(7))
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        health = {
            item["id"]: item["health"] for item in get(client, admin).json()["items"]
        }
        assert health[app_id(5)] == {
            "state": "healthy",
            "checked_at": "2026-09-30T00:00:00.000000Z",
            "fresh_until": "2026-09-30T01:00:00.000000Z",
        }
        assert health[app_id(6)]["state"] == "http_error"
        assert health[app_id(7)] == {
            "state": "unchecked",
            "checked_at": None,
            "fresh_until": None,
        }


def test_server_statistics_are_independent_of_the_requested_page(
    member_app, monkeypatch
):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 1, tzinfo=UTC)

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    checked = "2026-09-30T23:00:00.000000Z"
    seed_apps(
        path,
        [
            (
                1,
                APPROVED_ID,
                True,
                "2026-09-28T12:00:00.000000Z",
                ("healthy", checked, "2026-10-01T01:00:00.000000Z"),
            ),
            (
                2,
                ADMIN_ID,
                False,
                "2026-09-28T13:00:00.000000Z",
                ("healthy", checked, "2026-10-01T00:00:00.000000Z"),
            ),
            (
                3,
                APPROVED_ID,
                False,
                "2026-09-28T14:00:00.000000Z",
                ("http_error", checked, "2026-10-01T02:00:00.000000Z"),
            ),
            (4, APPROVED_ID, True, "2026-09-28T15:00:00.000000Z"),
        ],
    )
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        stats = client.get(f"{API}/admin/users", headers=context(admin)).json()["stats"]
        assert stats["total_apps"] == 4
        assert stats["healthy_apps"] == 1
        for query in ("?limit=1", "?limit=2&offset=3", "?limit=100"):
            assert get(client, admin, query).json()["pagination"]["total"] == 4
            assert (
                client.get(f"{API}/admin/users", headers=context(admin)).json()["stats"]
                == stats
            )
