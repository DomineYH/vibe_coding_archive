import sqlite3
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from tests.auth_client import API, Browser
from tests.support import AUTH_MEMBERS

NEW_PASSWORD = "  새 본인 비밀번호 보존 AbC 1234  "
ADMIN = AUTH_MEMBERS["admin"][1]


def temporary_admin(path):
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET must_change_password=1, temporary_password_expires_at=? WHERE login_id=?",
            (
                (datetime.now(UTC) + timedelta(hours=24))
                .isoformat()
                .replace("+00:00", "Z"),
                ADMIN,
            ),
        )


def change(browser, password=NEW_PASSWORD):
    permit = browser.admit("password_change")
    assert permit.status_code == 201
    result = browser.client.post(
        f"{API}/password",
        json={"password": password},
        headers=browser.session_headers(permit.json()),
    )
    if result.status_code == 200:
        browser.csrf = result.json()["csrf_token"]
        browser.generation = result.headers["X-EduVibe-Session-Generation"]
        browser.revision = result.headers["X-EduVibe-Auth-Revision"]
    return result


def test_temporary_admin_gets_restricted_self_then_only_completing_browser_gets_full(
    member_app,
):
    app, path = member_app()
    temporary_admin(path)
    with TestClient(app) as client, TestClient(app) as other_client:
        first = Browser(client).prepare().anonymous()
        second = Browser(other_client).prepare().anonymous()
        login = first.login(ADMIN)
        assert login.status_code == 200
        user = login.json()["user"]
        assert user["session_kind"] == "change_only"
        assert user["must_change_password"] is True
        assert not {"email", "phone", "recent_auth_until"} & user.keys()
        assert first.me().json() == user
        assert second.login(ADMIN).status_code == 200
        result = change(first)
        assert result.status_code == 200
        full = first.me().json()
        assert full["session_kind"] == "full"
        assert full["must_change_password"] is False
        assert full["recent_auth_until"] is not None
        assert second.me().status_code == 401
        with sqlite3.connect(path) as db:
            row = db.execute(
                "SELECT must_change_password,temporary_password_expires_at,account_version FROM members WHERE login_id=?",
                (ADMIN,),
            ).fetchone()
            assert row == (0, None, 2)
        first.logout()
        first.anonymous()
        assert first.login(ADMIN, NEW_PASSWORD).status_code == 200
        assert first.me().json()["recent_auth_until"] is None


import pytest

from tests.support import AUTH_PASSWORD


@pytest.mark.parametrize("password", ["short", AUTH_PASSWORD])
def test_invalid_or_equal_password_is_a_terminal_rejection_and_can_be_corrected(
    member_app, password
):
    app, path = member_app()
    temporary_admin(path)
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(ADMIN).status_code == 200
        result = change(browser, password)
        assert result.status_code == 422
        assert result.json()["error"]["fields"].keys() == {"password"}
        assert browser.state()["pending_transition"] is None
        assert change(browser).status_code == 200


def test_whole_blocklist_policy_does_not_trim_casefold_or_use_substrings(
    member_app, password_blocklist
):
    # Choose a fixed source row by index/length without including any leaked entry in source or output.
    entries = password_blocklist.read_text().split("\n")
    blocked = next(
        value for value in entries if len(value) >= 15 and value != value.upper()
    )
    app, path = member_app()
    temporary_admin(path)
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(ADMIN).status_code == 200
        result = change(browser, blocked)
        assert result.status_code == 422
        assert (
            result.json()["error"]["fields"]["password"]
            == "흔한 비밀번호는 사용할 수 없습니다."
        )
        # A containing password (including whitespace and changed case) is allowed whole-string.
        extended = "  " + blocked.upper() + " 합성 보강 "
        assert change(browser, extended).status_code == 200
        browser.logout()
        browser.anonymous()
        assert browser.login(ADMIN, extended.strip()).status_code == 401
        assert browser.login(ADMIN, extended.lower()).status_code == 401
        assert browser.login(ADMIN, extended).status_code == 200


def test_full_session_cannot_admit_own_temporary_password_change(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(ADMIN).status_code == 200
        result = browser.admit("password_change")
        assert result.status_code == 403
        assert result.json()["error"]["code"] == "SESSION_KIND_NOT_ALLOWED"
        direct = client.post(
            f"{API}/password",
            json={"password": NEW_PASSWORD},
            headers=browser.session_headers(),
        )
        assert direct.status_code == 403
        assert direct.json()["error"]["code"] == "SESSION_KIND_NOT_ALLOWED"


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


def test_short_expiry_uses_the_earlier_temporary_deadline_and_full_clocks_start_at_change(
    member_app, server_clock
):
    app, path = member_app()
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET must_change_password=1,temporary_password_expires_at='2026-10-01T00:10:00.000000Z' WHERE login_id=?",
            (ADMIN,),
        )
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert (
            browser.login(ADMIN).json()["user"]["expires_at"]
            == "2026-10-01T00:10:00.000000Z"
        )
        server_clock[0] += timedelta(minutes=5)
        full = change(browser).json()["user"]
        assert full["expires_at"] == "2026-10-01T00:35:00.000000Z"
        assert full["recent_auth_until"] == "2026-10-01T00:20:00.000000Z"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT absolute_expires_at FROM sessions WHERE kind='full'"
            ).fetchone() == ("2026-10-01T08:05:00.000000Z",)
        # Reading Self never extends either clock and a restart preserves recent auth.
        cookies = dict(client.cookies)
    with TestClient(app) as restarted:
        browser.client = restarted
        restarted.cookies.update(cookies)
        assert browser.me().json() == full


@pytest.mark.parametrize(
    "mutation",
    [
        "session_expired",
        "session_revoked",
        "temporary_expired",
        "member_version",
        "member_hash",
        "permit_expired",
        "flow_revoked",
        "settled",
    ],
)
def test_final_change_commit_rechecks_live_proof_credential_member_and_permit(
    member_app, monkeypatch, mutation
):
    import concurrent.futures
    import threading

    from app import auth_login

    app, path = member_app()
    temporary_admin(path)
    started, release = threading.Event(), threading.Event()
    real = auth_login.argon2_verify

    def delayed(stored, password):
        verdict = real(stored, password)
        if password == NEW_PASSWORD:
            started.set()
            assert release.wait(10)
        return verdict

    monkeypatch.setattr(auth_login, "argon2_verify", delayed)
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert browser.login(ADMIN).status_code == 200
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(change, browser)
            assert started.wait(10)
            statements = {
                "session_expired": "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000000Z' WHERE kind='change_only'",
                "session_revoked": "UPDATE sessions SET revoked_at='2000-01-01T00:00:00.000000Z' WHERE kind='change_only'",
                "temporary_expired": "UPDATE members SET temporary_password_expires_at='2000-01-01T00:00:00.000000Z' WHERE login_id='admin-user'",
                "member_version": "UPDATE members SET account_version=account_version+1 WHERE login_id='admin-user'",
                "member_hash": "UPDATE members SET password_hash='test-unusable' WHERE login_id='admin-user'",
                "permit_expired": "UPDATE auth_transitions SET permit_expires_at='2000-01-01T00:00:00.000000Z' WHERE kind='password_change'",
                "flow_revoked": "UPDATE auth_flows SET revoked_at='2000-01-01T00:00:00.000000Z'",
                "settled": "UPDATE auth_transitions SET state='cancelled',terminal_at='2000-01-01T00:00:00.000000Z' WHERE kind='password_change'",
            }
            with sqlite3.connect(path) as db:
                db.execute(statements[mutation])
            release.set()
            result = future.result(timeout=10)
        assert result.status_code in (401, 403, 409)
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT must_change_password FROM members WHERE login_id='admin-user'"
            ).fetchone() == (1,)
            assert db.execute(
                "SELECT COUNT(*) FROM sessions WHERE kind='full'"
            ).fetchone() == (0,)


def test_auth_enabled_startup_refuses_missing_or_corrupt_blocklist(
    member_app, tmp_path
):
    from app.main import create_app

    app, _ = member_app()
    # Settings are observed from the initialized app, then modified only for a test-owned bad file.
    with TestClient(app):
        settings = app.state.settings
    path = tmp_path / "missing.txt"
    for raw in (None, b"invalid source"):
        if raw is not None:
            path.write_bytes(raw)
        bad = create_app(
            settings.model_copy(update={"password_blocklist_path": path}),
            auth_testing=True,
        )
        with (
            pytest.raises(RuntimeError, match="verified password blocklist"),
            TestClient(bad),
        ):
            pass


def test_two_browsers_racing_to_consume_one_temporary_credential_commit_once(
    member_app, monkeypatch
):
    import concurrent.futures
    import threading

    from app import auth_login

    app, path = member_app()
    temporary_admin(path)
    barrier = threading.Barrier(2)
    real = auth_login.argon2_verify

    def delay(stored, password):
        verdict = real(stored, password)
        if password.startswith("  새 본인"):
            barrier.wait(timeout=10)
        return verdict

    monkeypatch.setattr(auth_login, "argon2_verify", delay)
    with TestClient(app) as first_client, TestClient(app) as second_client:
        first = Browser(first_client).prepare().anonymous()
        second = Browser(second_client).prepare().anonymous()
        assert first.login(ADMIN).status_code == second.login(ADMIN).status_code == 200
        with concurrent.futures.ThreadPoolExecutor() as pool:
            one = pool.submit(change, first)
            two = pool.submit(change, second, NEW_PASSWORD + "second")
            results = [one.result(timeout=15), two.result(timeout=15)]
        assert sorted(r.status_code for r in results) == [200, 401]
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT account_version FROM members WHERE login_id='admin-user'"
            ).fetchone() == (2,)
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE kind='full' AND revoked_at IS NULL"
            ).fetchone() == (1,)


def test_operating_cookie_attributes_apply_to_change_only_and_full(member_app):
    app, path = member_app()
    temporary_admin(path)
    with TestClient(app, base_url="https://archive.example.test") as client:
        client.app.state.settings = client.app.state.settings.model_copy(
            update={
                "app_env": "production",
                "public_origin": "https://archive.example.test",
            }
        )
        # Existing browser helper uses development Origin, so override just the test request origin.
        from tests.auth_client import ORIGIN

        original = ORIGIN["Origin"]
        ORIGIN["Origin"] = "https://archive.example.test"
        try:
            browser = Browser(client).prepare().anonymous()
            restricted = browser.login(ADMIN)
            full = change(browser)
            for result in (restricted, full):
                cookies = [
                    header
                    for header in result.headers.get_list("set-cookie")
                    if "Max-Age=0" not in header
                ]
                assert len(cookies) == 1
                cookie = cookies[0]
                assert cookie.startswith("__Host-eduvibe_session_")
                for flag in ("HttpOnly", "Path=/", "SameSite=lax", "Secure"):
                    assert flag in cookie
                assert (
                    "Domain=" not in cookie
                    and "Max-Age=" not in cookie
                    and "expires=" not in cookie.lower()
                )
                assert result.headers["cache-control"] == "private, no-store"
        finally:
            ORIGIN["Origin"] = original
