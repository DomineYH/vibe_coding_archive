"""Password reset HTTP lifecycle and minimal durable results."""

import sqlite3
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from tests.auth_client import signed_in
from tests.password_reset_client import (
    admin,
    cancel,
    execute,
    issue,
    reset_app,
    result,
    snapshot,
)
from tests.support import AUTH_MEMBERS


def test_issue_does_not_hash_or_mutate_and_execution_revokes_every_target_session(
    make_test_app, tmp_path, monkeypatch
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client, TestClient(app) as target_client:
        browser = admin(client)
        target = signed_in(target_client)
        before = snapshot(path)

        def no_hash(*args):
            raise AssertionError("Issuance must not hash")

        with monkeypatch.context() as patch:
            patch.setattr("app.auth_login.HASHER.hash", no_hash)
            created = issue(browser)
        assert created.status_code == 201, created.text
        key = created.json()["key"]
        after = snapshot(path)
        for table in ("members", "sessions", "audit_logs"):
            assert after[table] == before[table]
        applied = execute(browser, key)
        assert applied.status_code == 204, applied.text
        assert "set-cookie" not in applied.headers
        body = result(browser, key).json()
        assert body["state"] == "succeeded"
        assert body["applied_account_version"] == 2
        assert datetime.fromisoformat(
            body["temporary_password_expires_at"]
        ) - datetime.fromisoformat(body["finalized_at"]) == timedelta(days=1)
        assert set(body) == {
            "key",
            "kind",
            "target_id",
            "issued_at",
            "expires_at",
            "state",
            "applied_account_version",
            "temporary_password_expires_at",
            "finalized_at",
            "rejection_code",
            "server_time",
        }
        assert target.me().status_code == 401
        assert (
            execute(browser, key).json()["error"]["code"]
            == "OPERATION_ALREADY_RESOLVED"
        )
        assert cancel(browser, key).json()["state"] == "succeeded"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT approval_status,must_change_password,account_version FROM members WHERE id=?",
                (AUTH_MEMBERS["approved"][0],),
            ).fetchone() == ("approved", 1, 2)
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_password_reset' AND outcome='succeeded'"
            ).fetchone() == (1,)


from uuid import uuid4

import pytest

from tests.password_reset_client import BASE, PASSWORD, TARGET, headers


@pytest.fixture(name="server_clock")
def reset_clock(monkeypatch):
    from datetime import UTC

    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


def code(response):
    return response.json()["error"]["code"]


@pytest.mark.parametrize("name", ["approved", "pending", "revoked", "admin"])
def test_actor_and_recent_auth_fences(make_test_app, tmp_path, name):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        issuer = admin(client)
        owned_key = issue(issuer).json()["key"]
        client.cookies.clear()
        if name in ("pending", "revoked"):
            from tests.auth_client import Browser

            browser = Browser(client).prepare().anonymous()
            browser.login(AUTH_MEMBERS[name][1])
        else:
            browser = signed_in(client, name)
        if name == "admin":
            key = issue(browser).json()["key"]
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE sessions SET recent_auth_until=NULL WHERE member_id=?",
                    (AUTH_MEMBERS["admin"][0],),
                )
            assert code(issue(browser)) == "REAUTH_REQUIRED"
            assert code(execute(browser, key)) == "REAUTH_REQUIRED"
            assert result(browser, key).status_code == 200
            assert (
                cancel(browser, key).json()["rejection_code"] == "OPERATION_CANCELLED"
            )
        else:
            for response in (
                issue(browser),
                execute(browser, owned_key),
                result(browser, owned_key),
                cancel(browser, owned_key),
            ):
                assert response.status_code in (401, 403), response.text


@pytest.mark.parametrize("name", ["pending", "revoked", "approved"])
def test_reset_preserves_approval_for_all_ordinary_targets(
    make_test_app, tmp_path, name
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    target = AUTH_MEMBERS[name][0]
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser, target).json()["key"]
        assert execute(browser, key, target).status_code == 204
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT approval_status FROM members WHERE id=?", (target,)
            ).fetchone() == ("approved" if name == "approved" else name,)


def test_mismatch_ownership_protected_target_and_cancel(make_test_app, tmp_path):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client, TestClient(app) as foreign_client:
        browser = admin(client)
        foreign = admin(foreign_client)
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET is_admin=1 WHERE id=?", (AUTH_MEMBERS["hangul"][0],)
            )
        for target in (AUTH_MEMBERS["admin"][0], AUTH_MEMBERS["hangul"][0]):
            assert code(issue(browser, target)) == "ADMIN_ACCOUNT_PROTECTED"
        key = issue(browser).json()["key"]
        for kwargs in (
            {"password": "Different temporary password 167"},
            {"version": 2},
            {"target": AUTH_MEMBERS["pending"][0]},
        ):
            assert code(execute(browser, key, **kwargs)) == "OPERATION_KEY_MISMATCH"
        assert result(browser, key).json()["state"] == "unresolved"
        # Ownership is the internal actor, so another device of the same admin can read it.
        assert result(foreign, key).status_code == 200
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE write_operations SET actor_id=? WHERE key=?",
                (AUTH_MEMBERS["hangul"][0], key),
            )
        assert code(result(browser, key)) == "OPERATION_NOT_FOUND"
        assert code(execute(browser, key)) == "OPERATION_NOT_FOUND"
        assert code(result(browser, str(uuid4()))) == "OPERATION_NOT_FOUND"


@pytest.mark.parametrize("version", [True, "1", 1.0, None, 0, 9007199254740992])
def test_strict_version_and_safe_error_inputs(make_test_app, tmp_path, version, caplog):
    app, _, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        response = issue(browser, version=version)
        assert response.status_code == 422
        assert PASSWORD not in response.text + caplog.text


@pytest.mark.parametrize(
    "problem",
    ["extra", "duplicate", "nested_duplicate", "large", "surrogate", "blocklist"],
)
def test_request_body_boundaries(make_test_app, tmp_path, problem, caplog):
    import json

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        value = {
            "kind": "user_password_reset",
            "target_id": TARGET,
            "expected_account_version": 1,
            "new_password": PASSWORD,
        }
        status = 422
        if problem == "extra":
            value["unexpected"] = {"new_password": PASSWORD}
        if problem == "surrogate":
            value["new_password"] = "x" * 16 + "\ud800"
        if problem == "blocklist":
            value["new_password"] = next(
                p for p in app.state.password_blocklist if 15 <= len(p) <= 128
            )
        raw = json.dumps(value)
        if problem == "duplicate":
            raw = raw[:-1] + ',"new_password":"secret duplicate"}'
            status = 400
        if problem == "nested_duplicate":
            raw = raw[:-1] + ',"extra":{"new_password":"a","new_password":"b"}}'
            status = 400
        if problem == "large":
            raw += " " * 16384
            status = 413
        response = client.post(
            f"{BASE}/write-operations",
            content=raw,
            headers={**headers(browser), "Content-Type": "application/json"},
        )
        assert response.status_code == status, response.text
        assert PASSWORD not in response.text + caplog.text
        assert snapshot(path)["write_operations"] == []


@pytest.mark.parametrize(
    "problem", ["origin", "csrf", "revision", "generation", "pending", "duplicate_key"]
)
def test_write_context_and_duplicate_key_fences(make_test_app, tmp_path, problem):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        values = headers(browser, key)
        if problem == "origin":
            values["Origin"] = "https://wrong.test"
        if problem == "csrf":
            values["X-CSRF-Token"] = "wrong"
        if problem == "revision":
            values["X-EduVibe-Auth-Revision"] = "999"
        if problem == "generation":
            values["X-EduVibe-Session-Generation"] = "999"
        if problem == "pending":
            browser.admit("logout")
        if problem == "duplicate_key":
            values = [*values.items(), ("Idempotency-Key", key)]
        before = snapshot(path)
        response = client.post(
            f"{BASE}/admin/users/{TARGET}/password-reset",
            json={"new_password": PASSWORD, "expected_account_version": 1},
            headers=values,
        )
        assert response.status_code in (403, 409, 422), response.text
        assert snapshot(path) == before


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_exact_recent_auth_boundary(make_test_app, tmp_path, server_clock, offset):
    app, _, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        server_clock[0] += timedelta(seconds=900, microseconds=offset)
        response = issue(browser)
        assert response.status_code == (201 if offset < 0 else 403), response.text


@pytest.mark.parametrize("state", ["change_only", "must_change", "anonymous"])
def test_nonfull_admin_or_anonymous_is_refused_on_all_reset_surfaces(
    make_test_app, tmp_path, state
):
    from tests.auth_client import Browser

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        if state == "anonymous":
            client.cookies.clear()
            browser = Browser(client).prepare().anonymous()
        else:
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00Z' WHERE login_id='admin-user'"
                )
                if state == "change_only":
                    db.execute(
                        "UPDATE sessions SET kind='change_only' WHERE member_id=?",
                        (AUTH_MEMBERS["admin"][0],),
                    )
        for response in (
            issue(browser),
            execute(browser, key),
            result(browser, key),
            cancel(browser, key),
        ):
            assert response.status_code in (401, 403), response.text


def test_other_operation_kind_cancel_is_409_and_does_not_mutate(
    make_test_app, tmp_path
):
    from tests.app_create_client import issued_key

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issued_key(browser)
        before = snapshot(path)
        response = cancel(browser, key)
        assert response.status_code == 409
        assert code(response) == "OPERATION_KIND_NOT_CANCELLABLE"
        assert snapshot(path) == before


def test_nfc_precedes_codepoint_validation_and_spaces_are_bound(
    make_test_app, tmp_path
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        value = " e\u0301" + "x" * 124 + " "
        created = issue(browser, password=value)
        assert created.status_code == 201, created.text
        key = created.json()["key"]
        assert execute(browser, key, password=value.strip()).status_code == 409
        assert (
            execute(browser, key, password=value.replace("e\u0301", "é")).status_code
            == 204
        )
        with sqlite3.connect(path) as db:
            row = db.execute(
                "SELECT reset_key_id,reset_request_hmac,request_hash FROM write_operations WHERE key=?",
                (key,),
            ).fetchone()
            assert row[2] is None
            assert all(len(field) == 64 for field in row[:2])


def test_maximum_account_version_is_unavailable_without_consuming_key(
    make_test_app, tmp_path
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET account_version=9007199254740991 WHERE login_id='member-a'"
            )
        before = snapshot(path)
        assert issue(browser, version=9007199254740991).status_code == 503
        assert snapshot(path) == before


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_key_expiry_is_checked_at_the_exact_deadline(
    make_test_app, tmp_path, server_clock, offset
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE write_operations SET expires_at='2026-10-01T00:15:00.000000Z' WHERE key=?",
                (key,),
            )
            db.execute(
                "UPDATE sessions SET recent_auth_until='2099-01-01T00:00:00Z' WHERE member_id=?",
                (AUTH_MEMBERS["admin"][0],),
            )
        server_clock[0] += timedelta(seconds=900, microseconds=offset)
        assert result(browser, key).status_code == (200 if offset < 0 else 410)
        assert execute(browser, key).status_code == (204 if offset < 0 else 410)


@pytest.mark.parametrize("method", ["get", "post"])
def test_malformed_result_or_cancel_key_has_safe_422(make_test_app, tmp_path, method):
    app, _, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        path = f"{BASE}/write-operations/not-a-uuid" + (
            "/cancel" if method == "post" else ""
        )
        response = getattr(client, method)(path, headers=headers(browser))
        assert response.status_code == 422
        assert code(response) == "VALIDATION_ERROR"
