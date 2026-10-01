import hashlib
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.auth_client import API, ORIGIN, Browser, signed_in
from tests.support import AUTH_MEMBERS, AUTH_PASSWORD

APPROVED = AUTH_MEMBERS["approved"][1]


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


def rows(path, sql, *args):
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        return [dict(row) for row in db.execute(sql, args)]


def test_login_needs_a_current_anonymous_session_and_a_login_permit(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        state = browser.state()
        assert state["session_generation"] == browser.generation
        # A permit for another kind cannot be spent on login.
        permit = browser.admit("logout")
        assert permit.status_code == 201
        refused = browser.execute_login(permit.json(), APPROVED)
        assert refused.status_code == 409
        assert refused.json()["error"]["code"] == "AUTH_STATE_CHANGED"


def test_login_issues_a_full_session_and_member_sees_only_that_session(
    member_app, server_clock
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        old_cookie = next(n for n in client.cookies if n.startswith("eduvibe_session_"))
        result = browser.login(APPROVED)
        assert result.status_code == 200
        body = result.json()
        user = body["user"]
        assert user == {
            "id": AUTH_MEMBERS["approved"][0],
            "login_id": APPROVED,
            "nickname": "승인 회원",
            "role": "user",
            "approved": True,
            "must_change_password": False,
            "session_kind": "full",
            "expires_at": "2026-10-01T00:30:00.000000Z",
            "email": None,
            "phone": None,
            "recent_auth_until": None,
        }
        assert "password_hash" not in result.text and "$argon2" not in result.text
        assert result.headers["Cache-Control"] == "private, no-store"
        assert result.headers["X-EduVibe-Flow-Id"] == browser.flow
        assert result.headers["X-EduVibe-Session-Generation"] != "1"
        cookies = [c for c in result.headers.get_list("set-cookie")]
        assert any(c.startswith(f"{old_cookie}=") and "Max-Age=0" in c for c in cookies)
        assert any(
            "HttpOnly" in c and "Max-Age" not in c.split("eduvibe_session")[-1]
            for c in cookies
            if c.startswith("eduvibe_session_dev_")
        )
        session = rows(path, "SELECT * FROM sessions WHERE member_id IS NOT NULL")[0]
        raw = client.cookies[
            f"eduvibe_session_dev_{browser.flow}_{session['issued_seq']}"
        ]
        assert session["token_hash"] == hashlib.sha256(raw.encode()).hexdigest()
        assert session["kind"] == "full"
        assert session["absolute_expires_at"] == "2026-10-01T08:00:00.000000Z"
        assert session["expires_at"] == "2026-10-01T00:30:00.000000Z"
        assert session["csrf_token"] == body["csrf_token"]
        assert rows(path, "SELECT revoked_at FROM sessions WHERE member_id IS NULL")[0][
            "revoked_at"
        ]
        state = browser.state(transition_id=f"{browser.flow}.4")
        assert state["session_generation"] == session["issued_seq"]
        assert state["last_identity_change_revision"] == state["revision"]
        assert state["pending_transition"] is None
        # The login result is recorded and the permit cannot run twice.
        transition = rows(path, "SELECT * FROM auth_transitions WHERE kind='login'")[0]
        assert transition["state"] == "succeeded"
        assert transition["result_session_generation"] == session["issued_seq"]


def test_me_restores_the_session_and_is_a_read_that_never_extends_it(
    member_app, server_clock
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        before = rows(path, "SELECT * FROM sessions WHERE member_id IS NOT NULL")[0]
        server_clock[0] += timedelta(minutes=20)
        me = browser.me()
        assert me.status_code == 200
        assert me.json()["nickname"] == "승인 회원"
        assert me.headers["Cache-Control"] == "private, no-store"
        csrf = client.get(f"{API}/csrf", headers={"X-EduVibe-Flow-Id": browser.flow})
        assert csrf.status_code == 200
        after = rows(path, "SELECT * FROM sessions WHERE member_id IS NOT NULL")[0]
        assert after == before
        server_clock[0] += timedelta(minutes=10)  # 30 minutes after login: boundary
        assert browser.me().status_code == 401


def test_anonymous_session_and_missing_cookie_are_not_members(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.me().json()["error"]["code"] == "AUTH_REQUIRED"
        client.cookies.clear()
        assert browser.me().json()["error"]["code"] == "AUTH_REQUIRED"


def test_absolute_eight_hour_limit_applies_even_with_a_later_inactivity_expiry(
    member_app, server_clock
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        with sqlite3.connect(path) as db:
            for table in ("sessions", "auth_flows", "recovery_credentials"):
                db.execute(
                    f"UPDATE {table} SET expires_at='2099-01-01T00:00:00.000000Z'"
                )
        server_clock[0] += timedelta(hours=8) - timedelta(microseconds=1)
        assert browser.me().status_code == 200
        server_clock[0] += timedelta(microseconds=1)
        assert browser.me().status_code == 401


@pytest.mark.parametrize(
    ("name", "password", "status", "code"),
    [
        ("approved", "wrong password 12345", 401, "INVALID_CREDENTIALS"),
        ("pending", AUTH_PASSWORD, 403, "ACCOUNT_NOT_APPROVED"),
        ("revoked", AUTH_PASSWORD, 403, "ACCOUNT_NOT_APPROVED"),
        ("pending", "wrong password 12345", 401, "INVALID_CREDENTIALS"),
        ("revoked", "wrong password 12345", 401, "INVALID_CREDENTIALS"),
    ],
)
def test_only_the_exact_password_learns_the_approval_state(
    member_app, name, password, status, code
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        result = browser.login(AUTH_MEMBERS[name][1], password)
        assert result.status_code == status
        assert result.json()["error"]["code"] == code
        assert "set-cookie" not in result.headers


def test_unknown_wrong_and_unusable_credentials_are_one_identical_response(
    member_app, monkeypatch
):
    app, path = member_app()
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET password_hash='unusable' WHERE login_id='admin-user'"
        )
    verified = []
    from app import auth_login

    real = auth_login.HASHER.verify
    monkeypatch.setattr(
        auth_login.HASHER,
        "verify",
        lambda password, hashed: verified.append(hashed) or real(password, hashed),
    )
    seen = []
    for login_id, password in [
        ("no-such-member", AUTH_PASSWORD),
        (APPROVED, "wrong password 12345"),
        ("admin-user", AUTH_PASSWORD),
    ]:
        with TestClient(app) as client:
            browser = Browser(client).prepare().anonymous()
            result = browser.login(login_id, password)
        error = result.json()["error"]
        seen.append((result.status_code, error["code"], error["message"]))
    assert len(set(seen)) == 1 and seen[0][:2] == (401, "INVALID_CREDENTIALS")
    # Every miss still pays for one Argon2 verification against a real hash.
    assert len(verified) == 3 and all(v.startswith("$argon2id$") for v in verified)


def test_a_rejected_login_keeps_the_anonymous_session_and_allows_another_attempt(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(APPROVED, "wrong password 12345").status_code == 401
        state = browser.state()
        assert state["pending_transition"] is None
        assert state["session_generation"] == browser.generation
        failed = rows(path, "SELECT * FROM auth_transitions WHERE kind='login'")[0]
        assert (failed["state"], failed["failure_code"]) == (
            "failed",
            "INVALID_CREDENTIALS",
        )
        assert browser.login(APPROVED).status_code == 200


def test_login_normalizes_nfc_and_keeps_the_password_exact(member_app):
    from unicodedata import normalize

    app, _ = member_app()
    with TestClient(app) as client:
        decomposed = normalize("NFD", "한글교사")
        browser = Browser(client).prepare().anonymous()
        assert (
            browser.login(decomposed, normalize("NFD", AUTH_PASSWORD)).status_code
            == 200
        )
    with TestClient(app) as other_client:
        other = Browser(other_client).prepare().anonymous()
        assert other.login("한글교사", AUTH_PASSWORD + " ").status_code == 401


def test_body_errors_are_distinct_and_do_not_spend_the_permit(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        headers = {
            **browser.session_headers(permit),
            "Content-Type": "application/json",
        }
        post = lambda **kw: client.post(f"{API}/login", headers=headers, **kw)
        assert post(content=b"{").status_code == 400
        assert post(content=b" " * 16385).status_code == 413
        for body in [
            {},
            {"login_id": "x", "password": "p"},
            {"login_id": APPROVED, "password": ""},
            {"login_id": APPROVED, "password": "p", "role": "admin"},
        ]:
            result = post(json=body)
            assert (result.status_code, result.json()["error"]["code"]) == (
                422,
                "VALIDATION_ERROR",
            )
        assert (
            rows(path, "SELECT state FROM auth_transitions WHERE kind='login'")[0][
                "state"
            ]
            == "admitted"
        )
        assert browser.execute_login(permit, APPROVED).status_code == 200


def test_a_legacy_short_password_is_verified_not_policy_checked(member_app):
    from pwdlib import PasswordHash

    app, path = member_app()
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET password_hash=? WHERE login_id=?",
            (PasswordHash.recommended().hash("x"), APPROVED),
        )
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(APPROVED, "x").status_code == 200


def test_login_and_admission_are_refused_for_an_already_authenticated_session(
    member_app,
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        refused = browser.admit("login")
        assert (refused.status_code, refused.json()["error"]["code"]) == (
            409,
            "ALREADY_AUTHENTICATED",
        )


def test_logout_revokes_only_this_session_and_other_devices_survive(member_app):
    app, path = member_app()
    with TestClient(app) as first, TestClient(app) as second:
        one, two = signed_in(first), signed_in(second)
        assert one.logout().status_code == 204
        assert one.me().status_code == 401
        assert one.state()["session_generation"] is None
        assert two.me().status_code == 200
        assert not any(n.startswith("eduvibe_session_") for n in first.cookies)
        assert any(n.startswith("eduvibe_recovery_") for n in first.cookies)
        transition = rows(path, "SELECT * FROM auth_transitions WHERE kind='logout'")[0]
        assert transition["state"] == "succeeded"


def test_logout_with_a_session_needs_csrf_and_a_logout_permit(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        permit = browser.admit("logout").json()
        headers = browser.session_headers(permit)
        assert (
            client.post(
                f"{API}/logout", headers={**headers, "X-CSRF-Token": "x"}
            ).json()["error"]["code"]
            == "CSRF_INVALID"
        )
        no_permit = browser.session_headers(
            {"revision": permit["revision"], "transition_id": f"{browser.flow}.0"}
        )
        assert client.post(f"{API}/logout", headers=no_permit).status_code == 409
        assert browser.me().status_code == 200
        assert client.post(f"{API}/logout", headers=headers).status_code == 204


def test_no_session_logout_still_succeeds_after_a_logout(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        assert browser.logout().status_code == 204
        assert client.post(f"{API}/logout", headers=ORIGIN).status_code == 204


@pytest.fixture
def change_during_hash(monkeypatch):
    """Run a database change after the permit is spent but before the commit."""
    from app import auth_login

    real = auth_login.HASHER.verify
    action = {}

    def verify(password, hashed):
        if action:
            action.pop("run")()
        return real(password, hashed)

    monkeypatch.setattr(auth_login.HASHER, "verify", verify)
    return action


def write(path, sql, *args):
    with sqlite3.connect(path) as db:
        db.execute(sql, args)


@pytest.mark.parametrize(
    ("sql", "status", "code"),
    [
        (
            "UPDATE members SET approval_status='revoked', account_version=2",
            403,
            "ACCOUNT_NOT_APPROVED",
        ),
        ("UPDATE members SET password_hash='unusable'", 401, "INVALID_CREDENTIALS"),
        ("UPDATE members SET password_hash=NULL", 401, "INVALID_CREDENTIALS"),
        ("DELETE FROM members", 401, "INVALID_CREDENTIALS"),
    ],
)
def test_a_member_change_during_hashing_never_signs_in_with_the_past_state(
    member_app, change_during_hash, sql, status, code
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        change_during_hash["run"] = lambda: write(
            path, sql + " WHERE login_id='member-a'"
        )
        result = browser.login(APPROVED)
        assert (result.status_code, result.json()["error"]["code"]) == (status, code)
        assert not rows(path, "SELECT 1 FROM sessions WHERE member_id IS NOT NULL")
        assert browser.state()["session_generation"] == browser.generation


def test_a_settlement_during_hashing_blocks_the_late_execution(
    member_app, change_during_hash
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()

        def settle():
            state = browser.state()
            result = client.post(
                f"{API}/transitions/{permit['transition_id']}/settle",
                json={"flow_id": browser.flow, "expected_revision": state["revision"]},
                headers=browser.recovery_headers(),
            )
            assert result.json()["result"]["state"] == "cancelled"

        change_during_hash["run"] = settle
        late = browser.execute_login(permit, APPROVED)
        assert (late.status_code, late.json()["error"]["code"]) == (
            409,
            "AUTH_STATE_CHANGED",
        )
        assert not rows(path, "SELECT 1 FROM sessions WHERE member_id IS NOT NULL")
        assert rows(path, "SELECT state FROM auth_transitions WHERE kind='login'") == [
            {"state": "cancelled"}
        ]


def test_an_expired_permit_cannot_commit_a_late_login(member_app, server_clock):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        server_clock[0] += timedelta(seconds=60)
        result = browser.execute_login(permit, APPROVED)
        assert result.json()["error"]["code"] == "AUTH_STATE_CHANGED"
        assert not rows(path, "SELECT 1 FROM sessions WHERE member_id IS NOT NULL")


def test_meta_advertises_the_working_login_logout_pair_and_nothing_else(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
    enabled = {key for key, value in capabilities.items() if value["enabled"]}
    assert enabled == {"apps_read", "auth_login", "auth_logout"}
    assert capabilities["auth_password_change"]["reasons"] == ["not_implemented"]


def test_the_recorded_hash_profile_is_the_installed_argon2id_recommendation():
    from argon2 import Type, extract_parameters

    from app.auth_login import HASHER

    parameters = extract_parameters(HASHER.hash("profile"))
    assert (parameters.type, parameters.memory_cost, parameters.time_cost) == (
        Type.ID,
        65536,
        3,
    )
    assert parameters.parallelism == 4


def test_only_an_admin_login_carries_a_recent_authentication_window(
    member_app, server_clock
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        user = browser.me().json()
        assert user["role"] == "admin"
        assert user["recent_auth_until"] == "2026-10-01T00:15:00.000000Z"
