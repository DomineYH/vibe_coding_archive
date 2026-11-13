"""The current recent administrator deletes an ordinary account atomically."""

import sqlite3

from fastapi.testclient import TestClient

from tests.auth_client import signed_in
from tests.user_delete_client import TARGET, execute, issue, result, snapshot


def test_zero_app_issue_is_unchanged_then_delete_and_read_without_target(member_app):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as target_client:
        admin = signed_in(client, "admin")
        target = signed_in(target_client)
        before = snapshot(path)
        maximum = issue(admin, count=9007199254740991)
        assert maximum.status_code == 409
        assert maximum.json()["error"]["code"] == "APP_COUNT_CONFLICT"
        assert snapshot(path) == before
        created = issue(admin)
        assert created.status_code == 201, created.text
        key = created.json()["key"]
        after = snapshot(path)
        for table in before:
            if table != "write_operations":
                assert after[table] == before[table]
        deleted = execute(admin, key)
        assert deleted.status_code == 204, deleted.text
        assert deleted.content == b""
        assert deleted.headers["Cache-Control"] == "no-store"
        body = result(admin, key).json()
        assert body["kind"] == "user_delete"
        assert body["state"] == "succeeded"
        assert body["db_applied_at"] and body["finalized_at"]
        assert target.me().status_code == 401
        assert (
            execute(admin, key).json()["error"]["code"] == "OPERATION_ALREADY_RESOLVED"
        )
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchall()
                == []
            )
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []


import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from tests.auth_client import Browser
from tests.password_reset_client import cancel, headers
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("login_id", ["member-a", "MEMBER-A"])
def test_deleted_login_id_registers_a_new_pending_member_without_inheritance(
    member_app, login_id
):
    from tests.app_update_client import registered
    from tests.contracts.test_auth_register import PASSWORD, register

    app, path = member_app()
    with (
        TestClient(app) as client,
        TestClient(app) as target_client,
        TestClient(app) as signup_client,
    ):
        admin = signed_in(client, "admin")
        target = signed_in(target_client)
        old_app = registered(target)
        applicant = Browser(signup_client).prepare().anonymous()
        duplicate = register(applicant, login_id=login_id)
        assert duplicate.status_code == 409
        assert code(duplicate) == "LOGIN_ID_TAKEN"
        key = issue(admin, count=1).json()["key"]
        assert execute(admin, key, count=1).status_code == 204
        assert target.me().status_code == 401

        created = register(applicant, login_id=login_id)
        assert created.status_code == 201, created.text
        member_id = created.json()["id"]
        assert member_id != TARGET
        assert created.json()["approved"] is False
        assert target.me().status_code == 401
        assert code(applicant.login(login_id, PASSWORD)) == "ACCOUNT_NOT_APPROVED"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT login_id_key,approval_status,is_admin,first_approved_at FROM members WHERE id=?",
                (member_id,),
            ).fetchone() == ("member-a", "pending", 0, None)
            assert (
                db.execute(
                    "SELECT id FROM apps WHERE id=? OR owner_id IN (?,?)",
                    (old_app["id"], TARGET, member_id),
                ).fetchall()
                == []
            )
            assert (
                db.execute(
                    "SELECT member_id FROM sessions WHERE member_id IN (?,?)",
                    (TARGET, member_id),
                ).fetchall()
                == []
            )
            assert db.execute(
                "SELECT count(*) FROM recovery_credentials WHERE flow_id=? AND revoked_at IS NULL",
                (target.flow,),
            ).fetchone() == (0,)


def code(response):
    return response.json()["error"]["code"]


@pytest.mark.parametrize("name", ["approved", "pending", "revoked", "admin"])
def test_actor_and_recent_auth_fences(member_app, name):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        client.cookies.clear()
        if name in ("pending", "revoked"):
            browser = Browser(client).prepare().anonymous()
            browser.login(AUTH_MEMBERS[name][1])
        else:
            browser = signed_in(client, name)
        if name == "admin":
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE sessions SET recent_auth_until=NULL WHERE member_id=?",
                    (AUTH_MEMBERS["admin"][0],),
                )
            assert code(issue(browser)) == "REAUTH_REQUIRED"
            assert code(execute(browser, key)) == "REAUTH_REQUIRED"
            assert result(browser, key).status_code == 200
        else:
            for response in (
                issue(browser),
                execute(browser, key),
                result(browser, key),
            ):
                assert response.status_code in (401, 403)


@pytest.mark.parametrize("state", ["anonymous", "change_only", "must_change"])
def test_anonymous_and_nonfull_administrator_cannot_delete(member_app, state):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        if state == "anonymous":
            client.cookies.clear()
            browser = Browser(client).prepare().anonymous()
        else:
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00Z' WHERE is_admin=1"
                )
                if state == "change_only":
                    db.execute(
                        "UPDATE sessions SET kind='change_only' WHERE member_id=?",
                        (AUTH_MEMBERS["admin"][0],),
                    )
        for response in (issue(browser), execute(browser, key), result(browser, key)):
            assert response.status_code in (401, 403)


@pytest.mark.parametrize("name", ["approved", "pending", "revoked"])
def test_all_ordinary_approval_states_are_deletable(member_app, name):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        target = AUTH_MEMBERS[name][0]
        key = issue(admin, target).json()["key"]
        assert execute(admin, key, target).status_code == 204
        assert result(admin, key).json()["target_id"] == target
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (target,)).fetchone()
                is None
            )
            assert (
                db.execute(
                    "SELECT * FROM member_deletions WHERE member_id=?", (target,)
                ).fetchall()
                == []
            )


@pytest.mark.parametrize("count", [True, False, "0", 0.0, None, -1, 9007199254740992])
def test_strict_app_count_at_issue_and_execution(member_app, count):
    app, path = member_app()
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        before = snapshot(path)
        assert issue(admin, count=count).status_code == 422
        assert execute(admin, key, count=count).status_code == 422
        assert snapshot(path) == before


@pytest.mark.parametrize(
    "problem",
    [
        "origin",
        "csrf",
        "revision",
        "generation",
        "flow",
        "pending",
        "duplicate_key",
        "missing_key",
        "malformed_key",
    ],
)
def test_write_fences_leave_original_key_unresolved(member_app, problem):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        values = headers(browser, key)
        field = {
            "origin": "Origin",
            "csrf": "X-CSRF-Token",
            "revision": "X-EduVibe-Auth-Revision",
            "generation": "X-EduVibe-Session-Generation",
            "flow": "X-EduVibe-Flow-Id",
        }.get(problem)
        if field:
            values[field] = "999" if problem in ("revision", "generation") else "wrong"
        if problem == "pending":
            browser.admit("logout")
        if problem == "duplicate_key":
            values = [*values.items(), ("Idempotency-Key", key)]
        if problem == "missing_key":
            del values["Idempotency-Key"]
        if problem == "malformed_key":
            values["Idempotency-Key"] = "bad"
        before = snapshot(path)
        response = client.request(
            "DELETE",
            f"/api/v1/admin/users/{TARGET}",
            json={"expected_app_count": 0},
            headers=values,
        )
        assert response.status_code in (401, 403, 409, 422), response.text
        assert snapshot(path) == before


@pytest.mark.parametrize("execute_request", [False, True])
@pytest.mark.parametrize(
    "problem,status",
    [
        ("extra", 422),
        ("duplicate", 400),
        ("nested", 400),
        ("malformed", 400),
        ("large", 413),
    ],
)
def test_delete_json_and_body_boundaries(member_app, execute_request, problem, status):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        value = {"expected_app_count": 0}
        if not execute_request:
            value.update(kind="user_delete", target_id=TARGET)
        if problem == "extra":
            value["unexpected"] = True
        raw = json.dumps(value)
        if problem == "duplicate":
            raw = raw[:-1] + ',"expected_app_count":0}'
        if problem == "nested":
            raw = raw[:-1] + ',"extra":{"x":1,"x":2}}'
        if problem == "malformed":
            raw = '{"'
        if problem == "large":
            raw += " " * 16384
        before = snapshot(path)
        response = client.request(
            "DELETE" if execute_request else "POST",
            f"/api/v1/admin/users/{TARGET}"
            if execute_request
            else "/api/v1/write-operations",
            content=raw,
            headers={**headers(browser, key), "Content-Type": "application/json"},
        )
        assert response.status_code == status, response.text
        assert "message" in response.json()["error"]
        assert snapshot(path) == before


def test_protection_mismatch_ownership_cancel_and_missing_target(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        before = snapshot(path)
        assert (
            code(issue(browser, AUTH_MEMBERS["admin"][0])) == "ADMIN_ACCOUNT_PROTECTED"
        )
        assert code(execute(browser, key, count=1)) == "OPERATION_KEY_MISMATCH"
        assert (
            code(execute(browser, key, AUTH_MEMBERS["pending"][0]))
            == "OPERATION_KEY_MISMATCH"
        )
        assert code(cancel(browser, key)) == "OPERATION_KIND_NOT_CANCELLABLE"
        assert snapshot(path) == before
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE write_operations SET actor_id=? WHERE key=?",
                (AUTH_MEMBERS["hangul"][0], key),
            )
        assert (
            code(result(browser, key))
            == code(result(browser, str(uuid4())))
            == "OPERATION_NOT_FOUND"
        )
        assert code(execute(browser, key)) == "OPERATION_NOT_FOUND"
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute("DELETE FROM members WHERE id=?", (TARGET,))
        assert execute(browser, key).status_code == 404
        assert result(browser, key).json()["rejection_code"] == "USER_NOT_FOUND"
        assert code(execute(browser, key)) == "OPERATION_ALREADY_RESOLVED"


def test_another_administrator_is_protected_at_issue_and_commit(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute("UPDATE members SET is_admin=1 WHERE id=?", (TARGET,))
        before = snapshot(path)
        refused = issue(browser)
        assert refused.status_code == 403
        assert code(refused) == "ADMIN_ACCOUNT_PROTECTED"
        assert snapshot(path) == before
        refused = execute(browser, key)
        assert refused.status_code == 403
        assert code(refused) == "ADMIN_ACCOUNT_PROTECTED"
        found = result(browser, key).json()
        assert found["state"] == "rejected"
        assert found["rejection_code"] == "ADMIN_ACCOUNT_PROTECTED"
        assert found["db_applied_at"] is None
        after = snapshot(path)
        for table in before:
            if table not in ("write_operations", "audit_logs"):
                assert after[table] == before[table]
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            assert ledger.execute(
                "SELECT count(*) FROM completed_user_delete_events"
            ).fetchone() == (0,)


def test_result_reads_need_auth_readiness_without_delete_ledger_readiness(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        before = snapshot(path)
        app.state.user_delete_ready = False
        assert result(browser, key).status_code == 200
        assert issue(browser).status_code == 503
        assert execute(browser, key).status_code == 503
        assert snapshot(path) == before
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE write_operations SET actor_id=? WHERE key=?", (TARGET, key)
            )
        assert (
            code(result(browser, key))
            == code(result(browser, str(uuid4())))
            == "OPERATION_NOT_FOUND"
        )
        app.state.auth_ready = False
        assert result(browser, key).status_code == 503


@pytest.mark.parametrize("boundary", ["recent", "key"])
@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_exact_recent_and_key_deadlines(member_app, monkeypatch, boundary, offset):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        if boundary == "key":
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE write_operations SET expires_at='2026-10-01T00:15:00.000000Z' WHERE key=?",
                    (key,),
                )
        value[0] += timedelta(seconds=900, microseconds=offset)
        if boundary == "recent":
            assert issue(browser).status_code == (201 if offset < 0 else 403)
            assert execute(browser, key).status_code == (204 if offset < 0 else 403)
            assert result(browser, key).status_code == 200
        else:
            assert result(browser, key).status_code == (200 if offset < 0 else 410)


def shared_browser_admin(client):
    """The target signs in and out, then the administrator signs in on the same browser flow."""
    browser = signed_in(client)
    assert browser.logout().status_code == 204
    browser.anonymous()
    assert browser.login(AUTH_MEMBERS["admin"][1]).status_code == 200
    return browser


def live_recovery(db, flow_id):
    return db.execute(
        "SELECT count(*) FROM recovery_credentials WHERE flow_id=? AND revoked_at IS NULL",
        (flow_id,),
    ).fetchone()[0]


def test_same_browser_flow_delete_keeps_the_calling_administrator(member_app):
    from app.auth_maintenance import reconcile

    app, path = member_app()
    with TestClient(app) as client:
        admin = shared_browser_admin(client)
        with sqlite3.connect(path) as db:
            old = db.execute(
                "SELECT flow_id,issued_seq FROM sessions WHERE member_id=?", (TARGET,)
            ).fetchall()
        assert [flow_id for flow_id, _ in old] == [admin.flow]
        key = issue(admin).json()["key"]
        deleted = execute(admin, key)
        assert deleted.status_code == 204, deleted.text
        assert result(admin, key).json()["state"] == "succeeded"
        assert admin.me().status_code == 200
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT revoked_at FROM auth_flows WHERE id=?", (admin.flow,)
            ).fetchone() == (None,)
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchall()
                == []
            )
            assert (
                db.execute(
                    "SELECT 1 FROM sessions WHERE member_id=?", (TARGET,)
                ).fetchall()
                == []
            )
            assert (
                db.execute(
                    "SELECT flow_id,issued_seq FROM auth_retired_credentials WHERE kind='session'"
                ).fetchall()
                == old
            )
            assert live_recovery(db, admin.flow) == 1
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        reconcile(app.state.session_factory)
        assert admin.me().status_code == 200
        assert admin.logout().status_code == 204
        again = admin.anonymous().login(AUTH_MEMBERS["approved"][1])
        assert again.status_code == 401
        assert code(again) == "INVALID_CREDENTIALS"


@pytest.mark.parametrize("left_as", ["anonymous", "signed_out"])
def test_delete_from_another_browser_keeps_a_flow_the_target_left(member_app, left_as):
    from app.auth_maintenance import reconcile

    app, path = member_app()
    with TestClient(app) as shared, TestClient(app) as admin_client:
        visitor = signed_in(shared)
        assert visitor.logout().status_code == 204
        if left_as == "anonymous":
            visitor.anonymous()
        admin = signed_in(admin_client, "admin")
        assert execute(admin, issue(admin).json()["key"]).status_code == 204
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT revoked_at FROM auth_flows WHERE id=?", (visitor.flow,)
            ).fetchone() == (None,)
            assert (
                db.execute(
                    "SELECT 1 FROM sessions WHERE member_id=?", (TARGET,)
                ).fetchall()
                == []
            )
            assert live_recovery(db, visitor.flow) == 1
        reconcile(app.state.session_factory)
        if left_as == "signed_out":
            visitor.anonymous()
        assert (
            shared.get(
                "/api/v1/auth/csrf", headers={"X-EduVibe-Flow-Id": visitor.flow}
            ).status_code
            == 200
        )
        assert code(visitor.login(AUTH_MEMBERS["approved"][1])) == "INVALID_CREDENTIALS"
        assert visitor.login(AUTH_MEMBERS["hangul"][1]).status_code == 200


def test_pending_login_on_a_flow_the_target_left_cannot_sign_in_the_deleted_member(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as shared, TestClient(app) as admin_client:
        visitor = signed_in(shared)
        assert visitor.logout().status_code == 204
        permit = visitor.anonymous().admit("login")
        assert permit.status_code == 201, permit.text
        admin = signed_in(admin_client, "admin")
        assert execute(admin, issue(admin).json()["key"]).status_code == 204
        late = visitor.execute_login(permit.json(), AUTH_MEMBERS["approved"][1])
        assert late.status_code == 401
        assert code(late) == "INVALID_CREDENTIALS"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT state,failure_code FROM auth_transitions WHERE transition_id=?",
                (permit.json()["transition_id"],),
            ).fetchone() == ("failed", "INVALID_CREDENTIALS")
            assert (
                db.execute(
                    "SELECT 1 FROM sessions WHERE member_id=?", (TARGET,)
                ).fetchall()
                == []
            )
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchall()
                == []
            )


def test_revoked_but_still_current_target_session_ends_its_flow(member_app):
    from app.auth_maintenance import reconcile
    from tests.contracts.test_admin_approval import execute as approval_execute
    from tests.contracts.test_admin_approval import issue as approval_issue

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as target_client:
        admin = signed_in(client, "admin")
        target = signed_in(target_client)
        other = approval_issue(admin, target_id=TARGET, approved=False).json()["key"]
        assert (
            approval_execute(admin, other, target_id=TARGET, approved=False).status_code
            == 200
        )
        with sqlite3.connect(path) as db:
            # Approval revoke leaves the revoked target session as the flow's current pointer.
            assert db.execute(
                "SELECT s.member_id,s.revoked_at IS NOT NULL FROM auth_flows f JOIN sessions s ON s.flow_id=f.id AND s.issued_seq=f.current_session_generation WHERE f.id=?",
                (target.flow,),
            ).fetchone() == (TARGET, 1)
        assert execute(admin, issue(admin).json()["key"]).status_code == 204
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT revoked_at IS NOT NULL,current_session_generation FROM auth_flows WHERE id=?",
                (target.flow,),
            ).fetchone() == (1, None)
            assert live_recovery(db, target.flow) == 0
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        reconcile(app.state.session_factory)
        assert target.me().status_code == 401
        assert admin.me().status_code == 200


def test_restore_replay_of_a_shared_flow_delete_revokes_all_restored_authority(
    member_app, tmp_path
):
    from app.auth_maintenance import reconcile

    app, path = member_app()
    backup = tmp_path / "backup.sqlite3"
    with TestClient(app) as client:
        admin = shared_browser_admin(client)
        with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
            src.backup(dst)
        assert execute(admin, issue(admin).json()["key"]).status_code == 204
        with sqlite3.connect(backup) as src, sqlite3.connect(path) as dst:
            src.backup(dst)
        for _ in range(2):
            reconcile(app.state.session_factory, restored=True)
            with sqlite3.connect(path) as db:
                assert (
                    db.execute(
                        "SELECT id FROM members WHERE id=?", (TARGET,)
                    ).fetchall()
                    == []
                )
                assert (
                    db.execute(
                        "SELECT 1 FROM sessions WHERE member_id=?", (TARGET,)
                    ).fetchall()
                    == []
                )
                for table in ("sessions", "recovery_credentials", "auth_flows"):
                    assert db.execute(
                        f"SELECT count(*) FROM {table} WHERE revoked_at IS NULL"
                    ).fetchone() == (0,)
                assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            assert admin.me().status_code == 401
