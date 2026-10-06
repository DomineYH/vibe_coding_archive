"""Admin reauthentication on the durable permit and current-session boundary."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from tests.auth_client import API, Browser, signed_in
from tests.contracts.test_auth_login import rows
from tests.contracts.test_auth_password import temporary_admin
from tests.support import AUTH_MEMBERS, AUTH_PASSWORD


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


ADMIN = AUTH_MEMBERS["admin"][1]
WRONG = "wrong synthetic password 1234"


def execute(browser, permit, password=AUTH_PASSWORD, **extra):
    result = browser.client.post(
        f"{API}/reauth",
        json={"password": password},
        headers=browser.session_headers(permit),
        **extra,
    )
    if result.status_code == 200:
        browser.csrf = result.json()["csrf_token"]
        browser.generation = result.headers["X-EduVibe-Session-Generation"]
        browser.revision = result.headers["X-EduVibe-Auth-Revision"]
    return result


def reauth(browser, password=AUTH_PASSWORD):
    permit = browser.admit("reauthenticate")
    assert permit.status_code == 201, permit.text
    return execute(browser, permit.json(), password)


def test_rotation_inherits_absolute_expiry_and_identity_and_leaves_other_device_untouched(
    member_app, server_clock
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as other:
        browser = signed_in(client, "admin")
        second = signed_in(other, "admin")
        assert browser.me().json()["recent_auth_until"] == "2026-10-01T00:15:00.000000Z"
        original = rows(
            path, "SELECT * FROM sessions WHERE flow_id=? AND kind='full'", browser.flow
        )[0]
        untouched = rows(path, "SELECT * FROM sessions WHERE flow_id=?", second.flow)
        identity = browser.state()["last_identity_change_revision"]
        old_cookie = dict(client.cookies)
        old_headers = {
            **browser.session_headers(),
            "X-EduVibe-Auth-Revision": browser.revision,
        }
        server_clock[0] += timedelta(minutes=10)
        result = reauth(browser)
        assert result.status_code == 200, result.text
        assert result.headers["cache-control"] == "private, no-store"
        assert set(result.json()) == {"user", "csrf_token"}
        assert (
            result.json()["user"]["recent_auth_until"] == "2026-10-01T00:25:00.000000Z"
        )
        current = rows(
            path,
            "SELECT * FROM sessions WHERE flow_id=? AND revoked_at IS NULL",
            browser.flow,
        )[0]
        assert current["absolute_expires_at"] == original["absolute_expires_at"]
        assert current["expires_at"] == "2026-10-01T00:40:00.000000Z"
        assert current["csrf_token"] != original["csrf_token"]
        assert current["token_hash"] != original["token_hash"]
        assert browser.state()["last_identity_change_revision"] == identity
        assert (
            rows(path, "SELECT * FROM sessions WHERE flow_id=?", second.flow)
            == untouched
        )
        assert rows(
            path, "SELECT account_version FROM members WHERE login_id=?", ADMIN
        ) == [{"account_version": 1}]
        with TestClient(app) as stale:
            stale.cookies.update(old_cookie)
            assert stale.get(f"{API}/me", headers=old_headers).status_code == 401
        # Existing activity can reach the original eight-hour boundary, but rotation cannot extend it.
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE sessions SET expires_at=absolute_expires_at WHERE flow_id=? AND revoked_at IS NULL",
                (browser.flow,),
            )
            db.execute(
                "UPDATE auth_flows SET expires_at='2026-10-02T00:00:00.000000Z' WHERE id=?",
                (browser.flow,),
            )
            db.execute(
                "UPDATE recovery_credentials SET expires_at='2026-10-02T00:00:00.000000Z' WHERE flow_id=?",
                (browser.flow,),
            )
        server_clock[0] += timedelta(hours=7, minutes=49)
        result = reauth(browser)
        assert result.status_code == 200
        assert result.json()["user"]["expires_at"] == "2026-10-01T08:00:00.000000Z"
        assert (
            result.json()["user"]["recent_auth_until"] == "2026-10-01T08:14:00.000000Z"
        )


@pytest.mark.parametrize("phase", ["admission", "execute"])
@pytest.mark.parametrize(
    "mutation,status,code",
    [
        ("anonymous", 401, "AUTH_REQUIRED"),
        ("pending", 401, "AUTH_REQUIRED"),
        ("revoked", 401, "AUTH_REQUIRED"),
        ("ordinary", 403, "FORBIDDEN"),
        ("must_change", 403, "PASSWORD_CHANGE_REQUIRED"),
        ("expired", 401, "AUTH_REQUIRED"),
        ("change_only", 403, "PASSWORD_CHANGE_REQUIRED"),
    ],
)
def test_only_current_approved_full_admin_can_admit_and_execute(
    member_app, phase, mutation, status, code
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        permit = browser.admit("reauthenticate") if phase == "execute" else None
        if permit is not None:
            assert permit.status_code == 201
        sql = {
            "anonymous": "UPDATE sessions SET member_id=NULL,kind='anonymous' WHERE revoked_at IS NULL",
            "pending": "UPDATE members SET approval_status='pending',first_approved_at=NULL WHERE login_id='admin-user'",
            "revoked": "UPDATE members SET approval_status='revoked' WHERE login_id='admin-user'",
            "ordinary": "UPDATE members SET is_admin=0 WHERE login_id='admin-user'",
            "must_change": "UPDATE members SET must_change_password=1 WHERE login_id='admin-user'",
            "expired": "UPDATE sessions SET absolute_expires_at='2000-01-01T00:00:00.000000Z' WHERE kind='full'",
            "change_only": "UPDATE sessions SET kind='change_only' WHERE kind='full'",
        }
        with sqlite3.connect(path) as db:
            if mutation == "change_only":
                db.execute(
                    "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00.000000Z' WHERE login_id='admin-user'"
                )
            db.execute(sql[mutation])
        result = (
            execute(browser, permit.json())
            if permit is not None
            else browser.admit("reauthenticate")
        )
        assert result.status_code == status, result.text
        assert result.json()["error"]["code"] == code


def test_change_only_admin_is_refused(member_app):
    app, path = member_app()
    temporary_admin(path)
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        assert (
            browser.admit("reauthenticate").json()["error"]["code"]
            == "PASSWORD_CHANGE_REQUIRED"
        )


@pytest.mark.parametrize("delta", [-1, 0, 1, None, "full_expired"])
@pytest.mark.parametrize("write", [False, True], ids=["read", "write"])
def test_recent_admin_boundary_uses_server_time_and_current_authority(
    member_app, server_clock, delta, write
):
    from app.auth_boundary import AuthError
    from app.auth_reauth import require_recent_admin

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        if delta == "full_expired":
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE sessions SET absolute_expires_at='2000-01-01T00:00:00.000000Z' WHERE kind='full'"
                )
        elif delta is None:
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE sessions SET recent_auth_until=NULL WHERE kind='full'"
                )
        else:
            server_clock[0] += timedelta(minutes=15, microseconds=delta)
        headers = {
            **browser.session_headers(),
            "X-EduVibe-Auth-Revision": browser.revision,
            "Cookie": "; ".join(f"{k}={v}" for k, v in client.cookies.items()),
        }
        request = Request(
            {
                "type": "http",
                "method": "POST" if write else "GET",
                "path": "/helper",
                "headers": [
                    (k.lower().encode(), v.encode()) for k, v in headers.items()
                ],
                "app": app,
            }
        )
        with app.state.session_factory() as db:
            if delta == -1:
                assert (
                    require_recent_admin(db, request, write=write)[1]["id"]
                    == AUTH_MEMBERS["admin"][0]
                )
            else:
                with pytest.raises(AuthError) as error:
                    require_recent_admin(db, request, write=write)
                assert error.value.code == (
                    "AUTH_REQUIRED" if delta == "full_expired" else "REAUTH_REQUIRED"
                )
        expected = 401 if delta == "full_expired" else 200
        assert browser.me().status_code == expected
        assert (
            client.get("/api/v1/admin/users", headers=headers).status_code == expected
        )


def test_wrong_password_and_cancel_keep_original_admin_and_never_reexecute(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        original = rows(path, "SELECT * FROM sessions WHERE kind='full'")
        permit = browser.admit("reauthenticate").json()
        result = execute(browser, permit, WRONG)
        assert result.status_code == 401
        assert result.json()["error"]["code"] == "INVALID_CREDENTIALS"
        assert WRONG not in result.text and AUTH_PASSWORD not in result.text
        assert rows(path, "SELECT * FROM sessions WHERE kind='full'") == original
        assert execute(browser, permit).status_code == 409
        browser.revision = browser.state()["revision"]
        assert browser.me().status_code == 200
        permit = browser.admit("reauthenticate").json()
        settled = client.post(
            f"{API}/transitions/{permit['transition_id']}/settle",
            json={"flow_id": browser.flow, "expected_revision": permit["revision"]},
            headers=browser.recovery_headers(),
        )
        assert settled.json()["result"]["state"] == "cancelled"
        browser.revision = browser.state()["revision"]
        assert browser.me().status_code == 200
        assert execute(browser, permit).status_code == 409


@pytest.mark.parametrize(
    "header,value,status",
    [
        ("Origin", None, 403),
        ("Origin", "http://evil.test", 403),
        ("X-CSRF-Token", None, 403),
        ("X-CSRF-Token", "wrong", 403),
        ("X-EduVibe-Flow-Id", None, 422),
        ("X-EduVibe-Auth-Revision", None, 422),
        ("X-EduVibe-Auth-Revision", "0", 409),
        ("X-EduVibe-Session-Generation", None, 422),
        ("X-EduVibe-Session-Generation", "0", 409),
        ("X-EduVibe-Transition-Id", "other", 409),
    ],
)
def test_execution_fences(member_app, header, value, status):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201
        headers = browser.session_headers(permit.json())
        if value is None:
            headers.pop(header)
        else:
            headers[header] = value
        result = client.post(
            f"{API}/reauth", json={"password": AUTH_PASSWORD}, headers=headers
        )
        assert result.status_code == status, result.text
        assert "set-cookie" not in result.headers


@pytest.mark.parametrize(
    "body,status",
    [
        (
            '{"password":"wrong synthetic password 1234","password":"another synthetic password"}',
            400,
        ),
        ("{", 400),
        ('{"password":"short"}', 422),
        ('{"password":123}', 422),
        ('{"password":"' + "x" * 129 + '"}', 422),
        ('{"password":"wrong synthetic password 1234","login_id":"admin-user"}', 422),
        ('{"password":"wrong synthetic password 1234","member_id":"other"}', 422),
        ('{"password":"wrong synthetic password 1234","target_id":"other"}', 422),
        ('{"password":"' + "x" * 16370 + '"}', 413),
    ],
    ids=[
        "duplicate",
        "malformed",
        "short",
        "type",
        "long",
        "login_id",
        "member_id",
        "target_id",
        "oversize",
    ],
)
def test_strict_input_is_rejected_without_secret_reflection_or_counted_failures(
    member_app, body, status
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201
        result = client.post(
            f"{API}/reauth",
            content=body,
            headers={
                **browser.session_headers(permit.json()),
                "Content-Type": "application/json",
            },
        )
        assert result.status_code == status, result.text
        assert WRONG not in result.text
        assert "no-store" in result.headers["cache-control"]
        assert (
            rows(
                path,
                "SELECT * FROM rate_limit_events WHERE purpose IN ('login_account','login_ip')",
            )
            == []
        )


@pytest.mark.parametrize("login_first", [True, False])
def test_login_and_reauth_share_failure_windows_without_success_clearing(
    member_app, login_first
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as other:
        browser = signed_in(client, "admin")
        login = Browser(other).prepare().anonymous()
        for _ in range(5):
            result = (
                login.login(ADMIN, WRONG) if login_first else reauth(browser, WRONG)
            )
            assert result.status_code == 401
        assert reauth(browser).status_code == 200
        for _ in range(5):
            result = (
                reauth(browser, WRONG) if login_first else login.login(ADMIN, WRONG)
            )
            assert result.status_code == 401
        blocked = reauth(browser) if login_first else login.login(ADMIN)
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "RATE_LIMITED"
        assert rows(
            path,
            "SELECT count(*) AS count FROM rate_limit_events WHERE purpose IN ('login_account','login_ip')",
        ) == [{"count": 20}]


def test_capability_is_prepared_only_and_other_phase_five_features_remain_off(
    member_app,
):
    app, _ = member_app()
    with TestClient(app) as client:
        meta = client.get("/api/v1/meta")
        assert meta.json()["capabilities"]["admin_reauth"] == {
            "enabled": True,
            "reasons": [],
        }
        for key in [
            "admin_password_reset",
            "admin_user_delete",
            "admin_apps_read",
            "admin_apps_manage",
        ]:
            assert not meta.json()["capabilities"][key]["enabled"]


@pytest.mark.parametrize(
    "problem", ["hash_busy", "db_busy", "cookie_count", "cookie_bytes"]
)
def test_resource_rejection_keeps_source_session_and_counts_no_credentials(
    member_app, monkeypatch, problem
):
    from app import auth_login
    from app.auth_login import HashGate

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        original = rows(path, "SELECT * FROM sessions WHERE kind='full'")
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201
        if problem == "hash_busy":
            app.state.hash_gate = HashGate(running=1, waiting=0)
            app.state.hash_gate.slots.acquire()
        elif problem == "cookie_count":
            for seq in range(6):
                client.cookies.set(
                    f"eduvibe_session_dev_00000000-0000-4000-8000-000000000115_{seq}",
                    "unknown",
                )
        elif problem == "cookie_bytes":
            client.cookies.set(
                "eduvibe_session_dev_00000000-0000-4000-8000-000000000115_1", "x" * 2048
            )
        calls = []
        real = auth_login.argon2_verify

        def record(stored, password):
            calls.append(True)
            return real(stored, password)

        monkeypatch.setattr(auth_login, "argon2_verify", record)
        if problem == "db_busy":
            with sqlite3.connect(path) as locked:
                locked.execute("BEGIN IMMEDIATE")
                result = execute(browser, permit.json())
        else:
            result = execute(browser, permit.json())
        assert result.status_code == (
            503 if problem in ("hash_busy", "db_busy") else 409
        ), result.text
        assert (
            result.json()["error"]["code"]
            == {
                "hash_busy": "AUTH_BUSY",
                "db_busy": "DB_BUSY",
                "cookie_count": "AUTH_COOKIE_BUDGET_EXCEEDED",
                "cookie_bytes": "AUTH_COOKIE_BUDGET_EXCEEDED",
            }[problem]
        )
        assert calls == []
        assert rows(path, "SELECT * FROM sessions WHERE kind='full'") == original
        assert (
            rows(
                path,
                "SELECT * FROM rate_limit_events WHERE purpose IN ('login_account','login_ip')",
            )
            == []
        )


@pytest.mark.parametrize("ready,kind", [(False, "reauthenticate"), (True, "logout")])
def test_recovery_readiness_and_wrong_kind_permit_are_not_bypassed(
    member_app, ready, kind
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        state = browser.state()
        if not ready:
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE auth_flows SET recovery_ready=0 WHERE id=?", (browser.flow,)
                )
            result = client.post(
                f"{API}/transitions",
                json={
                    "flow_id": browser.flow,
                    "transition_id": state["next_transition_id"],
                    "kind": kind,
                    "expected_revision": state["revision"],
                    "expected_session_generation": browser.generation,
                },
                headers=browser.session_headers(),
            )
        else:
            result = execute(browser, browser.admit(kind).json())
        assert result.status_code == 409
        assert result.json()["error"]["code"] == "AUTH_STATE_CHANGED"


@pytest.mark.parametrize("size,chunked", [(16384, False), (16384, True), (16385, True)])
def test_streamed_body_limit_is_exact(member_app, size, chunked):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201
        raw = ('{"password":"' + AUTH_PASSWORD + '"}').encode()
        raw += b" " * (size - len(raw))
        body = iter([raw[:8000], raw[8000:]]) if chunked else raw
        result = client.post(
            f"{API}/reauth",
            content=body,
            headers={
                **browser.session_headers(permit.json()),
                "Content-Type": "application/json",
            },
        )
        assert result.status_code == (200 if size == 16384 else 413), result.text


def test_no_recent_grant_is_needed_for_reauth_or_owned_result_reads(member_app):
    from tests.contracts.test_admin_approval import issue

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute("UPDATE sessions SET recent_auth_until=NULL WHERE kind='full'")
        headers = {
            **browser.session_headers(),
            "X-EduVibe-Auth-Revision": browser.revision,
        }
        assert (
            client.get(f"/api/v1/write-operations/{key}", headers=headers).status_code
            == 200
        )
        assert reauth(browser).status_code == 200


def test_missing_committed_cookie_is_discarded_and_late_cookie_never_revives_it(
    member_app,
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        before = dict(client.cookies)
        permit = browser.admit("reauthenticate")
        assert permit.status_code == 201
        result = client.post(
            f"{API}/reauth",
            json={"password": AUTH_PASSWORD},
            headers=browser.session_headers(permit.json()),
        )
        assert result.status_code == 200
        committed = dict(client.cookies)
        client.cookies.clear()
        client.cookies.update(before)
        state = browser.state(transition_id=permit.json()["transition_id"])
        assert not state["session_cookie_present"]
        assert state["requested_transition"]["state"] == "succeeded"
        discard = client.post(
            f"{API}/transitions/{permit.json()['transition_id']}/discard-session",
            json={
                "flow_id": browser.flow,
                "expected_revision": state["revision"],
                "expected_session_generation": state["session_generation"],
            },
            headers=browser.recovery_headers(),
        )
        assert discard.status_code == 200, discard.text
        client.cookies.update(committed)
        browser.csrf = result.json()["csrf_token"]
        browser.generation = result.headers["X-EduVibe-Session-Generation"]
        browser.revision = browser.state()["revision"]
        assert browser.me().status_code == 401
        assert execute(browser, permit.json()).status_code == 401


@pytest.mark.parametrize(
    "problem",
    [
        "origin_missing",
        "origin_wrong",
        "csrf_missing",
        "csrf_wrong",
        "recovery_csrf",
        "revision",
        "header_revision",
        "generation",
        "transition",
        "session_missing",
    ],
)
def test_admission_spends_current_session_proof_and_expected_context(
    member_app, problem
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        state = browser.state()
        body = {
            "flow_id": browser.flow,
            "transition_id": state["next_transition_id"],
            "kind": "reauthenticate",
            "expected_revision": state["revision"],
            "expected_session_generation": browser.generation,
        }
        headers = browser.session_headers()
        if problem == "origin_missing":
            headers.pop("Origin")
        elif problem == "origin_wrong":
            headers["Origin"] = "http://evil.test"
        elif problem == "csrf_missing":
            headers.pop("X-CSRF-Token")
        elif problem == "csrf_wrong":
            headers["X-CSRF-Token"] = "wrong"
        elif problem == "recovery_csrf":
            headers["X-CSRF-Token"] = browser.recovery_csrf
        elif problem == "revision":
            body["expected_revision"] = "0"
        elif problem == "header_revision":
            headers["X-EduVibe-Auth-Revision"] = "0"
        elif problem == "generation":
            body["expected_session_generation"] = "0"
        elif problem == "transition":
            body["transition_id"] = "foreign-transition"
        elif problem == "session_missing":
            for cookie in list(client.cookies):
                if cookie.startswith("eduvibe_session_"):
                    del client.cookies[cookie]
        result = client.post(f"{API}/transitions", json=body, headers=headers)
        assert result.status_code == (
            401
            if problem == "session_missing"
            else (
                409
                if problem
                in ["revision", "header_revision", "generation", "transition"]
                else 403
            )
        ), result.text
        assert "set-cookie" not in result.headers
        assert (
            rows(
                path,
                "SELECT * FROM rate_limit_events WHERE purpose IN ('login_account','login_ip')",
            )
            == []
        )


def test_admission_uses_body_flow_context_without_execution_headers(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        state = browser.state()
        result = client.post(
            f"{API}/transitions",
            json={
                "flow_id": browser.flow,
                "transition_id": state["next_transition_id"],
                "kind": "reauthenticate",
                "expected_revision": state["revision"],
                "expected_session_generation": browser.generation,
            },
            headers={"Origin": "http://localhost:5174", "X-CSRF-Token": browser.csrf},
        )
        assert result.status_code == 201, result.text
