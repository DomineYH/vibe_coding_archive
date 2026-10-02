import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.auth_client import signed_in
from tests.support import AUTH_MEMBERS

API = "/api/v1"
PENDING_ID = AUTH_MEMBERS["pending"][0]


def headers(browser):
    return {
        **browser.session_headers(),
        "X-EduVibe-Auth-Revision": browser.revision,
    }


def issue(admin, target_id=PENDING_ID, version=1, approved=True):
    return admin.client.post(
        f"{API}/write-operations",
        headers=headers(admin),
        json={
            "kind": "user_approval",
            "target_id": target_id,
            "expected_account_version": version,
            "approved": approved,
        },
    )


def execute(admin, key, target_id=PENDING_ID, version=1, approved=True):
    return admin.client.patch(
        f"{API}/admin/users/{target_id}/approval",
        headers={
            **headers(admin),
            "Idempotency-Key": key,
        },
        json={"expected_account_version": version, "approved": approved},
    )


def read(admin, key):
    return admin.client.get(f"{API}/write-operations/{key}", headers=headers(admin))


def cancel(admin, key):
    return admin.client.post(
        f"{API}/write-operations/{key}/cancel", headers=headers(admin)
    )


@pytest.mark.parametrize("chunked", [False, True])
def test_approval_writes_bound_bodies_before_authentication(member_app, chunked):
    app, path = member_app()
    with TestClient(app) as client:
        for method, url in (
            ("POST", f"{API}/write-operations"),
            ("POST", f"{API}/write-operations/{PENDING_ID}/cancel"),
            ("PATCH", f"{API}/admin/users/{PENDING_ID}/approval"),
        ):
            content = iter([b" " * 9000, b" " * 9000]) if chunked else b" " * 18000
            result = client.request(method, url, content=content)
            assert (result.status_code, result.json()["error"]["code"]) == (
                413,
                "PAYLOAD_TOO_LARGE",
            )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )
            assert db.execute("SELECT count(*) FROM audit_logs").fetchone() == (0,)
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone() == (1,)


def test_cancel_fences_execution_and_never_undoes_committed_success(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        result = cancel(admin, key)
        assert result.status_code == 200, result.text
        assert result.json()["state"] == "rejected"
        assert result.json()["rejection_code"] == "OPERATION_CANCELLED"
        assert cancel(admin, key).json()["state"] == "rejected"
        denied = execute(admin, key)
        assert denied.status_code == 409
        assert denied.json()["error"]["code"] == "OPERATION_ALREADY_RESOLVED"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone() == (1,)
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='cancel_user_approval'"
            ).fetchone() == (1,)
        key = issue(admin).json()["key"]
        assert execute(admin, key).status_code == 200
        assert cancel(admin, key).json()["state"] == "succeeded"
        assert read(admin, key).json()["applied_account_version"] == 2


def test_approval_key_commits_history_version_audit_and_result_once(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        issued = issue(admin)
        assert issued.status_code == 201, issued.text
        operation = issued.json()
        assert operation["state"] == "unresolved"
        assert operation["kind"] == "user_approval"
        result = execute(admin, operation["key"])
        assert result.status_code == 200, result.text
        assert result.json()["approved"] is True
        assert result.json()["account_version"] == 2
        assert result.json()["first_approved_at"] is not None
        assert result.json()["pending_expires_at"] is None
        duplicate = execute(admin, operation["key"])
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["code"] == "OPERATION_ALREADY_RESOLVED"
        resolved = read(admin, operation["key"]).json()
        assert resolved["state"] == "succeeded"
        assert resolved["applied_account_version"] == 2
        assert resolved["applied_approved"] is True
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_approval'"
            ).fetchone() == (1,)
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE member_id=?", (PENDING_ID,)
            ).fetchone() == (0,)
        same = issue(admin, version=2)
        assert same.status_code == 201
        assert (
            execute(admin, same.json()["key"], version=2).json()["account_version"] == 3
        )


def test_admin_reads_current_members_and_full_statistics_without_contact(member_app):
    app, path = member_app()
    with sqlite3.connect(path) as db:
        db.execute("UPDATE members SET email='private@example.test',phone='123456789'")
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        result = client.get(f"{API}/admin/users?limit=1", headers=headers(admin))
        assert result.status_code == 200, result.text
        assert result.headers["Cache-Control"] == "private, no-store"
        assert result.headers["X-EduVibe-Auth-Revision"] == admin.revision
        assert result.headers["X-EduVibe-Session-Generation"] == admin.generation
        body = result.json()
        assert body["pagination"] == {
            "limit": 1,
            "offset": 0,
            "total": 6,
            "has_more": True,
        }
        assert body["items"][0]["id"] == PENDING_ID
        assert body["stats"]["total_users"] == 6
        assert body["stats"]["pending_users"] == 2
        assert body["stats"]["healthy_apps"] == 0
        detail = client.get(f"{API}/admin/users/{PENDING_ID}", headers=headers(admin))
        assert detail.status_code == 200
        assert detail.json() == body["items"][0]
        assert set(detail.json()) == {
            "id",
            "login_id",
            "nickname",
            "role",
            "approved",
            "account_version",
            "app_count",
            "created_at",
            "first_approved_at",
            "pending_expires_at",
        }


def test_admin_list_offset_bounds_return_defined_validation_errors(member_app):
    app, _ = member_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        admin = signed_in(client, "admin")
        for offset in (-1, 9007199254740992, 2**63, 10**30):
            result = client.get(
                f"{API}/admin/users?offset={offset}", headers=headers(admin)
            )
            assert result.status_code == 422, result.text
            assert result.json()["error"]["code"] == "VALIDATION_ERROR"
        result = client.get(
            f"{API}/admin/users?offset=9007199254740991", headers=headers(admin)
        )
        assert result.status_code == 200
        assert result.json()["items"] == []
        assert result.json()["pagination"]["has_more"] is False


def test_healthy_apps_counts_only_fresh_healthy_results(
    member_app, seed_public_and_private_apps, monkeypatch
):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 1, tzinfo=UTC)

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    seed_public_and_private_apps(path, public_count=3)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        unchecked = client.get(f"{API}/admin/users", headers=headers(admin)).json()
        assert unchecked["stats"]["healthy_apps"] == 0
        assert unchecked["stats"]["next_health_expiry_at"] is None
        with sqlite3.connect(path) as db:
            db.executemany(
                "UPDATE health_results SET state=?,checked_at='2026-09-30T23:00:00.000000Z',fresh_until=? WHERE app_id=?",
                [
                    (
                        state,
                        expiry,
                        f"00000000-0000-4000-8000-{index:012d}",
                    )
                    for index, state, expiry in (
                        (1, "healthy", "2026-10-01T01:00:00.000000Z"),
                        (2, "healthy", "2026-10-01T00:00:00.000000Z"),
                        (3, "http_error", "2026-10-01T00:30:00.000000Z"),
                    )
                ],
            )
        result = client.get(f"{API}/admin/users", headers=headers(admin))
        assert result.status_code == 200
        assert result.json()["stats"]["total_apps"] == 4
        assert result.json()["stats"]["healthy_apps"] == 1
        assert (
            result.json()["stats"]["next_health_expiry_at"]
            == "2026-10-01T01:00:00.000000Z"
        )


@pytest.mark.parametrize("deleted", [False, True])
def test_terminal_approval_rejection_is_audited_once_and_survives_key_cleanup(
    member_app, deleted
):
    from app.auth_maintenance import sweep

    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "DELETE FROM members WHERE id=?"
                if deleted
                else "UPDATE members SET account_version=2 WHERE id=?",
                (PENDING_ID,),
            )
        code = "USER_NOT_FOUND" if deleted else "USER_STATE_CONFLICT"
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        failed = execute(admin, key)
        assert (failed.status_code, failed.json()["error"]["code"]) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        unresolved = read(admin, key).json()
        assert (unresolved["state"], unresolved["rejection_code"]) == (
            "unresolved",
            None,
        )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM audit_logs").fetchone() == (0,)
            db.execute("DROP TRIGGER fail_audit")
        result = execute(admin, key)
        assert (result.status_code, result.json()["error"]["code"]) == (
            404 if deleted else 409,
            code,
        )
        resolved = read(admin, key).json()
        assert (resolved["state"], resolved["rejection_code"]) == ("rejected", code)
        repeated = execute(admin, key)
        assert (repeated.status_code, repeated.json()["error"]["code"]) == (
            409,
            "OPERATION_ALREADY_RESOLVED",
        )
        with sqlite3.connect(path) as db:
            audit = db.execute(
                "SELECT action,actor_id,target_id,occurred_at,outcome FROM audit_logs"
            ).fetchall()
            assert audit == [
                (
                    "user_approval",
                    AUTH_MEMBERS["admin"][0],
                    PENDING_ID,
                    resolved["finalized_at"],
                    "rejected",
                )
            ]
            db.execute(
                "UPDATE write_operations SET expires_at='2000-01-01T00:00:00.000000Z' WHERE key=?",
                (key,),
            )
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )
            assert (
                db.execute(
                    "SELECT action,actor_id,target_id,occurred_at,outcome FROM audit_logs"
                ).fetchall()
                == audit
            )


def test_admin_authority_and_key_ownership_are_checked_on_every_endpoint(member_app):
    app, path = member_app()
    with TestClient(app) as admin_client, TestClient(app) as other_client:
        admin = signed_in(admin_client, "admin")
        key = issue(admin).json()["key"]
        other = signed_in(other_client)
        for result in (
            other_client.get(f"{API}/admin/users", headers=headers(other)),
            issue(other),
            execute(other, key),
            read(other, key),
            cancel(other, key),
        ):
            assert (result.status_code, result.json()["error"]["code"]) == (
                403,
                "FORBIDDEN",
            )
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET is_admin=1 WHERE id=?",
                (AUTH_MEMBERS["approved"][0],),
            )
        for result in (read(other, key), cancel(other, key), execute(other, key)):
            assert (result.status_code, result.json()["error"]["code"]) == (
                404,
                "OPERATION_NOT_FOUND",
            )
        for result in (issue(admin, AUTH_MEMBERS["admin"][0]),):
            assert (result.status_code, result.json()["error"]["code"]) == (
                403,
                "ADMIN_ACCOUNT_PROTECTED",
            )
        for name in list(admin_client.cookies.keys()):
            if "session" in name:
                del admin_client.cookies[name]
        for result in (read(admin, key), cancel(admin, key), execute(admin, key)):
            assert (result.status_code, result.json()["error"]["code"]) == (
                401,
                "AUTH_REQUIRED",
            )
    with TestClient(app) as limited:
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET must_change_password=1,temporary_password_expires_at=? WHERE id=?",
                (
                    (datetime.now(UTC) + timedelta(days=1)).isoformat(),
                    AUTH_MEMBERS["admin"][0],
                ),
            )
        browser = signed_in(limited, "admin")
        for result in (
            limited.get(f"{API}/admin/users", headers=headers(browser)),
            issue(browser),
            read(browser, key),
            cancel(browser, key),
            execute(browser, key),
        ):
            assert (result.status_code, result.json()["error"]["code"]) == (
                403,
                "PASSWORD_CHANGE_REQUIRED",
            )


@pytest.mark.parametrize("column", ["audit", "result"])
def test_storage_failure_rolls_back_approval_history_sessions_and_operation(
    member_app, column
):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        trigger = (
            "BEFORE INSERT ON audit_logs"
            if column == "audit"
            else "BEFORE UPDATE ON write_operations"
        )
        with sqlite3.connect(path) as db:
            db.execute(
                f"CREATE TRIGGER fail_save {trigger} BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        failed = execute(admin, key)
        assert (failed.status_code, failed.json()["error"]["code"]) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert read(admin, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version,first_approved_at,approval_status FROM members WHERE id=?",
                (PENDING_ID,),
            ).fetchone() == (1, None, "pending")
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_approval'"
            ).fetchone() == (0,)
            db.execute("DROP TRIGGER fail_save")
        assert execute(admin, key).status_code == 200


def test_key_mismatch_version_conflict_and_strict_wire_input(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        for result in (
            execute(admin, key, approved=False),
            execute(admin, key, version=2),
            execute(admin, key, target_id=AUTH_MEMBERS["approved"][0]),
        ):
            assert (result.status_code, result.json()["error"]["code"]) == (
                409,
                "OPERATION_KEY_MISMATCH",
            )
            assert read(admin, key).json()["state"] == "unresolved"
        second = issue(admin).json()["key"]
        assert execute(admin, key).status_code == 200
        stale = execute(admin, second)
        assert (stale.status_code, stale.json()["error"]["code"]) == (
            409,
            "USER_STATE_CONFLICT",
        )
        assert read(admin, second).json()["rejection_code"] == "USER_STATE_CONFLICT"
        assert read(admin, key).json()["state"] == "succeeded"
        for version in (True, "2", 1.5, 0, 9007199254740992):
            result = issue(admin, version=version)
            assert (result.status_code, result.json()["error"]["code"]) == (
                422,
                "VALIDATION_ERROR",
            )


def test_revocation_permanently_revokes_all_old_sessions_and_preserves_public_apps(
    member_app, seed_public_and_private_apps
):
    app, path = member_app()
    seed_public_and_private_apps(path)
    id_ = AUTH_MEMBERS["approved"][0]
    app_id = "00000000-0000-4000-8000-000000000002"
    with sqlite3.connect(path) as db:
        db.execute("UPDATE apps SET owner_id=? WHERE id=?", (id_, app_id))
    with TestClient(app) as client, TestClient(app) as first, TestClient(app) as second:
        admin = signed_in(client, "admin")
        old = [signed_in(first), signed_in(second)]
        with TestClient(app) as public:
            detail = public.get(f"{API}/apps/{app_id}")
            assert detail.status_code == 200
            assert detail.json()["item"]["owner"]["id"] == id_
        key = issue(admin, id_, approved=False).json()["key"]
        assert execute(admin, key, id_, approved=False).status_code == 200
        with TestClient(app) as public:
            listed = public.get(f"{API}/apps").json()["items"]
            assert any(
                item["id"] == app_id and item["owner"]["id"] == id_ for item in listed
            )
            assert (
                public.get(f"{API}/apps/{app_id}").json()["item"]
                == detail.json()["item"]
            )
        for browser in old:
            assert (browser.me().status_code, browser.me().json()["error"]["code"]) == (
                401,
                "AUTH_REQUIRED",
            )
        key = issue(admin, id_, version=2).json()["key"]
        assert execute(admin, key, id_, version=2).status_code == 200
        for browser in old:
            assert browser.me().status_code == 401
        with TestClient(app) as public:
            listed = public.get(f"{API}/apps").json()["items"]
            assert any(
                item["id"] == app_id and item["owner"]["id"] == id_ for item in listed
            )
            assert (
                public.get(f"{API}/apps/{app_id}").json()["item"]
                == detail.json()["item"]
            )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE member_id=? AND revoked_at IS NULL",
                (id_,),
            ).fetchone() == (0,)
            assert (
                db.execute(
                    "SELECT first_approved_at FROM members WHERE id=?", (id_,)
                ).fetchone()[0]
                is not None
            )


def test_operation_exact_expiry_and_bounded_cleanup(member_app, monkeypatch):
    from app.auth_maintenance import sweep

    clock = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as fresh_client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        expiry = read(admin, key).json()["expires_at"]
        clock[0] = datetime.fromisoformat(expiry) - timedelta(microseconds=1)
        fresh = signed_in(fresh_client, "admin")
        assert read(fresh, key).status_code == 200
        clock[0] += timedelta(microseconds=1)
        for result in (read(fresh, key), execute(fresh, key), cancel(fresh, key)):
            assert (result.status_code, result.json()["error"]["code"]) == (
                410,
                "OPERATION_EXPIRED",
            )
        clock[0] += timedelta(minutes=59)
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM write_operations WHERE key=?", (key,)
            ).fetchone() == (0,)
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?", (PENDING_ID,)
            ).fetchone() == (1,)


def test_duplicate_json_and_idempotency_headers_are_rejected_without_mutation(
    member_app,
):
    app, _ = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        result = client.patch(
            f"{API}/admin/users/{PENDING_ID}/approval",
            headers={
                **headers(admin),
                "Idempotency-Key": key,
                "Content-Type": "application/json",
            },
            content='{"approved":false,"approved":true,"expected_account_version":1}',
        )
        assert (result.status_code, result.json()["error"]["code"]) == (
            400,
            "BAD_REQUEST",
        )
        for keys in (
            [],
            [("Idempotency-Key", key), ("Idempotency-Key", key)],
            [("Idempotency-Key", "bad-key")],
        ):
            result = client.patch(
                f"{API}/admin/users/{PENDING_ID}/approval",
                headers=[*headers(admin).items(), *keys],
                json={"approved": True, "expected_account_version": 1},
            )
            assert (result.status_code, result.json()["error"]["code"]) == (
                422,
                "VALIDATION_ERROR",
            )
        assert read(admin, key).json()["state"] == "unresolved"


def test_revocation_audit_failure_preserves_every_session_and_original_result(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as member_client:
        admin = signed_in(client, "admin")
        member = signed_in(member_client)
        id_ = AUTH_MEMBERS["approved"][0]
        key = issue(admin, id_, approved=False).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        result = execute(admin, key, id_, approved=False)
        assert (result.status_code, result.json()["error"]["code"]) == (
            503,
            "SERVICE_UNAVAILABLE",
        )
        assert member.me().status_code == 200
        assert read(admin, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT approval_status,account_version FROM members WHERE id=?", (id_,)
            ).fetchone() == ("approved", 1)
            db.execute("DROP TRIGGER fail_audit")
        assert execute(admin, key, id_, approved=False).status_code == 200
        assert member.me().status_code == 401


def test_restart_preserves_keys_and_target_deletion_does_not_erase_success(member_app):
    from app.auth_maintenance import reconcile

    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        assert execute(admin, key).status_code == 200
        unresolved = issue(admin, version=2).json()["key"]
        cookies = dict(client.cookies)
    with TestClient(app) as client:
        client.cookies.update(cookies)
        admin.client = client
        assert read(admin, key).json()["state"] == "succeeded"
        assert read(admin, unresolved).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("DELETE FROM members WHERE id=?", (PENDING_ID,))
        assert read(admin, key).json()["applied_account_version"] == 2
        result = execute(admin, key)
        assert (result.status_code, result.json()["error"]["code"]) == (
            409,
            "OPERATION_ALREADY_RESOLVED",
        )
        result = execute(admin, unresolved, version=2)
        assert (result.status_code, result.json()["error"]["code"]) == (
            404,
            "USER_NOT_FOUND",
        )
        assert read(admin, unresolved).json()["rejection_code"] == "USER_NOT_FOUND"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT target_id,outcome FROM audit_logs WHERE action='user_approval' ORDER BY id"
            ).fetchall() == [(PENDING_ID, "succeeded"), (PENDING_ID, "rejected")]
        reconcile(app.state.session_factory, restored=True)
        fresh = signed_in(TestClient(app), "admin")
        assert (
            read(fresh, key).status_code,
            read(fresh, key).json()["error"]["code"],
        ) == (404, "OPERATION_NOT_FOUND")
