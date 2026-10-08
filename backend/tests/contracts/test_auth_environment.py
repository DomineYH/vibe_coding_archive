"""Environment activation preserves the real authentication boundary."""

import sqlite3
from http.cookies import SimpleCookie
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings
from tests.auth_client import API, ORIGIN, Browser
from tests.support import (
    AUTH_MEMBERS,
    populate_auth_members,
    populate_public_and_private_apps,
)

AUTH_BUNDLE = {
    "admin_reauth",
    "auth_login",
    "auth_logout",
    "auth_password_change",
    "auth_register",
    "admin_users_read",
    "admin_approval",
    "admin_apps_read",
    "admin_apps_manage",
    "admin_user_delete",
    "admin_summary",
    "apps_create",
    "apps_update_own",
    "apps_delete_own",
}
PREPARE_COMMAND = (
    "APP_ENV=development uv run --frozen python -m app.cli prepare-password-blocklist"
)
PRIVATE = "00000000-0000-4000-8000-000000000003"


@pytest.fixture
def development_settings(tmp_path, migrate_test_database, password_blocklist):
    path = tmp_path / "dev.sqlite3"
    migrate_test_database(path)
    return Settings.from_environment(
        {
            "APP_ENV": "development",
            "DATABASE_PATH": str(path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "PASSWORD_BLOCKLIST_PATH": str(password_blocklist),
        },
        backend_root=tmp_path,
    )


def assert_auth_disabled(client):
    capabilities = client.get("/api/v1/meta").json()["capabilities"]
    assert all(not capabilities[key]["enabled"] for key in AUTH_BUNDLE)
    result = client.post(f"{API}/flows", json={"restart_from": []}, headers=ORIGIN)
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "FEATURE_UNAVAILABLE"


def test_development_meta_enables_only_auth_bundle(
    development_settings, make_test_app, tmp_path
):
    with TestClient(make_test_app(tmp_path / "ordinary.sqlite3")) as ordinary:
        baseline = ordinary.get("/api/v1/meta").json()["capabilities"]
    with TestClient(create_app(development_settings)) as client:
        assert client.get("/readyz").status_code == 200
        response = client.get("/api/v1/meta")
        assert response.status_code == 200
        capabilities = response.json()["capabilities"]
        assert {key for key, value in capabilities.items() if value["enabled"]} == (
            AUTH_BUNDLE | {"apps_read", "health_read"}
        )
        assert capabilities.keys() == baseline.keys()
        for key, value in capabilities.items():
            assert value == (
                {"enabled": True, "reasons": []}
                if key in AUTH_BUNDLE
                else baseline[key]
            )


def test_development_auth_flow_and_login_work(development_settings):
    populate_auth_members(development_settings.database_path)
    with TestClient(
        create_app(development_settings), base_url="http://localhost:5174"
    ) as client:
        browser = Browser(client).prepare().anonymous()
        for kind in ("recovery", "session"):
            cookies = [
                cookie
                for cookie in client.cookies.jar
                if cookie.name.startswith(f"eduvibe_{kind}_dev_{browser.flow}_")
            ]
            assert len(cookies) == 1
            cookie = cookies[0]
            assert cookie.path == "/" and not cookie.secure
            assert cookie.has_nonstandard_attr("HttpOnly")
            assert cookie.get_nonstandard_attr("SameSite").lower() == "lax"
            assert cookie.expires is None
        assert browser.login(AUTH_MEMBERS["approved"][1]).status_code == 200
        me = browser.me()
        assert me.status_code == 200
        assert me.json()["id"] == AUTH_MEMBERS["approved"][0]
        permit = browser.admit("logout").json()
        headers = browser.session_headers(permit)
        for invalid_headers, code in [
            ({**headers, "Origin": "http://wrong.example"}, "ORIGIN_REJECTED"),
            ({**headers, "X-CSRF-Token": "wrong"}, "CSRF_INVALID"),
        ]:
            refused = client.post(f"{API}/logout", headers=invalid_headers)
            assert refused.status_code == 403
            assert refused.json()["error"]["code"] == code
        assert browser.me().status_code == 200
        # Cookie deletion retains the same loopback-only policy.
        result = client.post(f"{API}/logout", headers=browser.session_headers(permit))
        assert result.status_code == 204
        for header in result.headers.get_list("set-cookie"):
            _, attributes = next(iter(SimpleCookie(header).items()))
            assert attributes["httponly"] and not attributes["secure"]
            assert attributes["samesite"].lower() == "lax"
            assert attributes["path"] == "/" and not attributes["domain"]


@pytest.mark.parametrize("raw", [None, b"invalid source"])
def test_development_startup_refuses_missing_or_corrupt_blocklist(
    development_settings, tmp_path, raw
):
    path = tmp_path / "bad-blocklist.txt"
    if raw is not None:
        path.write_bytes(raw)
    settings = development_settings.model_copy(update={"password_blocklist_path": path})
    with (
        pytest.raises(RuntimeError, match="verified password blocklist") as error,
        TestClient(create_app(settings)),
    ):
        pass
    assert PREPARE_COMMAND in str(error.value)


def test_production_auth_stays_disabled_without_blocklist(tmp_path):
    from app.auth_runtime import runtime_enabled

    settings = Settings(
        app_env="production",
        database_path=Path("/srv/eduvibe/data/api.sqlite3"),
        public_origin="https://archive.example.test",
        password_blocklist_path=Path("/srv/eduvibe/data/missing.txt"),
    )
    assert not runtime_enabled(settings)


def test_test_environment_without_override_stays_disabled(
    make_test_app, tmp_path, monkeypatch
):
    monkeypatch.setenv("PASSWORD_BLOCKLIST_PATH", str(tmp_path / "missing.txt"))
    app = make_test_app(tmp_path / "test-off.sqlite3", auth_testing=False)
    with TestClient(app) as client:
        assert_auth_disabled(client)


@pytest.mark.parametrize("app_env", ["development", "production"])
def test_auth_testing_remains_test_only(tmp_path, migrate_test_database, app_env):
    path = tmp_path / "guard.sqlite3"
    migrate_test_database(path)
    settings = Settings(
        app_env=app_env,
        database_path=path,
        public_origin="http://localhost:5174",
        password_blocklist_path=tmp_path / "missing.txt",
    )
    with (
        pytest.raises(
            RuntimeError, match="Authentication test boundary requires APP_ENV=test"
        ),
        TestClient(create_app(settings, auth_testing=True)),
    ):
        pass


def test_development_readiness_failure_closes_auth(development_settings, monkeypatch):
    def fail(factory):
        raise RuntimeError("Synthetic verification failure")

    monkeypatch.setattr("app.main.reconcile", fail)
    with TestClient(create_app(development_settings)) as client:
        assert client.get("/readyz").status_code == 503
        assert client.get("/healthz").status_code == 200
        assert client.get("/api/v1/apps").status_code == 200
        assert_auth_disabled(client)


def test_development_private_detail_allows_owner_only(development_settings):
    path = development_settings.database_path
    populate_auth_members(path)
    populate_public_and_private_apps(path)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE apps SET owner_id=? WHERE id=?",
            (AUTH_MEMBERS["approved"][0], PRIVATE),
        )
    with TestClient(
        create_app(development_settings), base_url="http://localhost:5174"
    ) as client:
        browser = Browser(client).prepare().anonymous()

        def detail():
            return client.get(
                f"/api/v1/apps/{PRIVATE}",
                headers={
                    "X-EduVibe-Flow-Id": browser.flow,
                    "X-EduVibe-Auth-Revision": browser.revision,
                    "X-EduVibe-Session-Generation": browser.generation,
                },
            )

        assert detail().status_code == 404
        assert browser.login(AUTH_MEMBERS["approved"][1]).status_code == 200
        result = detail()
        assert result.status_code == 200
        assert result.json()["item"]["is_public"] is False
        assert result.headers["Cache-Control"] == "private, no-store"
        assert client.get(f"/api/v1/apps/{PRIVATE}").status_code == 404


@pytest.mark.parametrize(
    "environment,testing,valid,expected",
    [
        ("development", False, True, True),
        ("development", False, False, False),
        ("test", False, True, False),
        ("test", True, True, True),
        ("production", False, True, False),
    ],
)
def test_reset_capability_requires_verified_supply_and_explicit_auth_boundary(
    tmp_path,
    migrate_test_database,
    password_blocklist,
    environment,
    testing,
    valid,
    expected,
):
    from tests.password_reset_client import supply

    path = tmp_path / "reset-environment.sqlite3"
    migrate_test_database(path)
    secret = supply(tmp_path / "reset.json")
    if not valid:
        secret.unlink()
    settings = Settings(
        app_env=environment,
        database_path=path,
        public_origin="http://localhost:5174"
        if environment != "production"
        else "https://archive.example.test",
        password_blocklist_path=password_blocklist,
        password_reset_hmac_path=secret,
    )
    if environment == "production":
        from app.auth_runtime import runtime_enabled

        assert not runtime_enabled(settings)
        return
    with TestClient(create_app(settings, auth_testing=testing)) as client:
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
        assert capabilities["admin_password_reset"] == {
            "enabled": expected,
            "reasons": [] if expected else ["operational_restriction"],
        }
        assert capabilities["admin_user_delete"]["enabled"] is (
            environment == "development" or testing
        )
        assert capabilities["admin_apps_manage"]["enabled"] is (
            environment == "development" or testing
        )
        assert client.get("/readyz").status_code == 200


@pytest.mark.parametrize("app_env", ["development", "production"])
@pytest.mark.parametrize(
    "arguments",
    [
        {"auth_testing": True},
        {"health_testing": True},
        {"auth_testing": True, "health_testing": True},
    ],
)
def test_test_only_arguments_rejected_before_database_open(
    tmp_path, monkeypatch, app_env, arguments
):
    def reject_open(*args):
        raise AssertionError("test-only flag opened a database")

    monkeypatch.setattr("app.main.make_engine", reject_open)
    settings = Settings(
        app_env=app_env,
        database_path=tmp_path / "absent.sqlite3",
        public_origin="https://archive.example.test",
    )
    with (
        pytest.raises(RuntimeError, match="test boundary requires APP_ENV=test"),
        TestClient(create_app(settings, **arguments)),
    ):
        pass


@pytest.fixture
def candidate_app(member_app, candidate, monkeypatch):
    from tests.test_auth_runtime import evaluate

    settings, record = candidate
    monkeypatch.setattr(
        "app.auth_runtime.runtime_enabled", lambda _: evaluate(settings, record)
    )
    app, database = member_app()
    with TestClient(app, base_url="http://localhost:5174") as client:
        app.state.auth_candidate = True
        app.state.auth_revoked = False
        yield client, app, database, settings.auth_activation_path, record


# Shared fixture creates only synthetic test/temp metadata.
from tests.test_auth_runtime import candidate as candidate_fixture  # noqa: F401


@pytest.mark.parametrize(
    "mutation", ["removed", "revoked", "corrupt", "mode", "binding", "pending"]
)
def test_candidate_revocation_closes_existing_sessions_and_operations(
    candidate_app, mutation
):
    import json

    client, _app, database, path, record = candidate_app
    browser = Browser(client).prepare().anonymous()
    assert browser.login(AUTH_MEMBERS["approved"][1]).status_code == 200
    capabilities = client.get("/api/v1/meta").json()["capabilities"]
    assert all(capabilities[key]["enabled"] for key in AUTH_BUNDLE)
    assert all(
        not capabilities[key]["enabled"]
        for key in (
            "health_check",
            "health_batch",
            "email_collection",
            "phone_collection",
        )
    )
    with sqlite3.connect(database) as db:
        before = db.execute("SELECT count(*) FROM members").fetchone()
    if mutation == "removed":
        path.unlink()
    elif mutation == "corrupt":
        path.write_text("invalid")
    elif mutation == "mode":
        path.chmod(0o644)
    else:
        path.write_text(
            json.dumps(
                {
                    **record,
                    **(
                        {"release_id": "changed"}
                        if mutation == "binding"
                        else {"status": mutation}
                    ),
                }
            )
        )
    from tests.app_create_client import INPUT

    headers = browser.session_headers()
    for method, url, body in [
        ("GET", f"{API}/me", None),
        ("POST", f"{API}/register", {}),
        ("POST", f"{API}/login", {}),
        ("POST", f"{API}/logout", None),
        ("POST", f"{API}/password", {}),
        ("POST", f"{API}/reauth", {}),
        ("GET", "/api/v1/admin/users", None),
        ("GET", "/api/v1/admin/apps", None),
        (
            "POST",
            "/api/v1/write-operations",
            {
                "kind": "user_approval",
                "target_id": AUTH_MEMBERS["pending"][0],
                "expected_account_version": 1,
                "approved": True,
            },
        ),
        ("POST", "/api/v1/apps", INPUT),
        (
            "PATCH",
            f"/api/v1/apps/{PRIVATE}",
            {"expected_version": 1, "name": "후보 수정"},
        ),
        ("DELETE", f"/api/v1/apps/{PRIVATE}", {"expected_version": 1}),
    ]:
        response = client.request(
            method, url, headers=headers, **({"json": body} if body is not None else {})
        )
        assert response.status_code == 503, url
        assert response.json()["error"]["code"] == "FEATURE_UNAVAILABLE"
    capabilities = client.get("/api/v1/meta").json()["capabilities"]
    for key in AUTH_BUNDLE | {"admin_password_reset"}:
        assert capabilities[key] == {
            "enabled": False,
            "reasons": ["operational_restriction"],
        }
    assert client.get("/api/v1/apps").status_code == 200
    assert (
        client.get(
            f"/api/v1/apps/{PRIVATE}",
            headers={
                "X-EduVibe-Flow-Id": browser.flow,
                "X-EduVibe-Auth-Revision": browser.revision,
                "X-EduVibe-Session-Generation": browser.generation,
            },
        ).status_code
        == 404
    )
    assert client.get("/healthz").status_code == 200
    assert client.get("/readyz").status_code == 200
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT count(*) FROM members").fetchone() == before
    path.write_text(json.dumps(record))
    path.chmod(0o600)
    assert_auth_disabled(client)


@pytest.mark.parametrize("action", ["register", "login", "password", "reauth"])
def test_candidate_revocation_during_two_phase_write(
    candidate_app, monkeypatch, action
):
    from app.auth_login import HASHER
    from tests.support import AUTH_PASSWORD

    client, _app, database, path, _record = candidate_app
    browser = Browser(client).prepare().anonymous()
    if action in {"password", "reauth"}:
        name = "approved" if action == "password" else "admin"
        if action == "password":
            from app.auth_boundary import after, now

            with sqlite3.connect(database) as db:
                db.execute(
                    "UPDATE members SET must_change_password=1, temporary_password_expires_at=? WHERE id=?",
                    (after(now(), 86400), AUTH_MEMBERS[name][0]),
                )
        assert browser.login(AUTH_MEMBERS[name][1]).status_code == 200
    from app import auth_login

    real_hash, real_verify = HASHER.hash, auth_login.argon2_verify
    with sqlite3.connect(database) as db:
        before = db.execute(
            "SELECT id,password_hash,account_version FROM members ORDER BY id"
        ).fetchall()
        sessions = db.execute("SELECT count(*) FROM sessions").fetchone()

    def hash_and_revoke(value):
        result = real_hash(value)
        path.unlink()
        return result

    def verify_and_revoke(value, password):
        result = real_verify(value, password)
        path.unlink(missing_ok=True)
        return result

    if action == "register":
        monkeypatch.setattr(HASHER, "hash", hash_and_revoke)
        response = client.post(
            f"{API}/register",
            json={
                "login_id": "candidate-new",
                "nickname": "후보 회원",
                "password": AUTH_PASSWORD,
            },
            headers=browser.session_headers()
            | {"X-EduVibe-Auth-Revision": browser.revision},
        )
    else:
        kind = {
            "login": "login",
            "password": "password_change",
            "reauth": "reauthenticate",
        }[action]
        permit = browser.admit(kind).json()
        monkeypatch.setattr(auth_login, "argon2_verify", verify_and_revoke)
        body = (
            {"login_id": AUTH_MEMBERS["approved"][1], "password": AUTH_PASSWORD}
            if action == "login"
            else {
                "password": AUTH_PASSWORD + "!new"
                if action == "password"
                else AUTH_PASSWORD
            }
        )
        response = client.post(
            f"{API}/{action}", json=body, headers=browser.session_headers(permit)
        )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "FEATURE_UNAVAILABLE"
    with sqlite3.connect(database) as db:
        unchanged = (
            db.execute(
                "SELECT id,password_hash,account_version FROM members ORDER BY id"
            ).fetchall()
            == before
        )
        assert unchanged
        assert db.execute("SELECT count(*) FROM sessions").fetchone() == sessions
    assert_auth_disabled(client)


@pytest.mark.parametrize("fault", ["missing", "mismatch", "unreadable"])
def test_candidate_hmac_failure_is_local_to_reset(
    make_test_app, tmp_path, candidate, monkeypatch, fault
):
    from tests.auth_client import signed_in
    from tests.password_reset_client import (
        TARGET,
        cancel,
        execute,
        headers,
        issue,
        reset_app,
        result,
    )
    from tests.test_auth_runtime import evaluate

    settings, record = candidate
    monkeypatch.setattr(
        "app.auth_runtime.runtime_enabled", lambda _: evaluate(settings, record)
    )
    app, _database, secret = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        app.state.auth_candidate = True
        app.state.auth_revoked = False
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        if fault == "missing":
            secret.unlink()
        elif fault == "mismatch":
            from tests.password_reset_client import supply

            supply(secret)
        else:
            secret.chmod(0o644)
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
        assert not capabilities["admin_password_reset"]["enabled"]
        assert all(capabilities[name]["enabled"] for name in AUTH_BUNDLE)
        assert browser.me().status_code == 200
        assert (
            client.get("/api/v1/admin/users", headers=headers(browser)).status_code
            == 200
        )
        assert issue(browser).json()["error"]["code"] == "SERVICE_UNAVAILABLE"
        assert execute(browser, key).json()["error"]["code"] == "SERVICE_UNAVAILABLE"
        assert result(browser, key).status_code == 200
        assert cancel(browser, key).status_code == 200
        settings.auth_activation_path.unlink()
        for response in (
            result(browser, key),
            cancel(browser, key),
            client.post(
                f"/api/v1/admin/users/{TARGET}/password-reset",
                json={
                    "expected_account_version": 1,
                    "new_password": "Synthetic reset password 1234!",
                },
                headers=headers(browser),
            ),
        ):
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "FEATURE_UNAVAILABLE"


def test_candidate_https_cookie_and_independent_gates(
    make_test_app, tmp_path, candidate, monkeypatch
):
    from tests.support import AUTH_PASSWORD
    from tests.test_auth_runtime import evaluate

    settings, record = candidate
    monkeypatch.setattr(
        "app.auth_runtime.runtime_enabled", lambda _: evaluate(settings, record)
    )
    monkeypatch.setattr(
        "tests.auth_client.ORIGIN", {"Origin": "https://archive.example.test"}
    )
    database = tmp_path / "https.sqlite3"
    app = make_test_app(database, auth_testing=True)
    populate_auth_members(database)
    with TestClient(app, base_url="https://archive.example.test") as client:
        app.state.settings = app.state.settings.model_copy(
            update={"public_origin": "https://archive.example.test"}
        )
        app.state.auth_candidate = True
        app.state.auth_revoked = False
        browser = Browser(client).prepare().anonymous()
        for cookie in client.cookies.jar:
            assert cookie.name.startswith("__Host-")
            assert cookie.secure and cookie.path == "/" and cookie.expires is None
            assert cookie.has_nonstandard_attr("HttpOnly")
            assert cookie.get_nonstandard_attr("SameSite").lower() == "lax"
            assert not cookie.domain_specified
        response = client.post(
            f"{API}/register",
            json={
                "login_id": "optional-info",
                "nickname": "후보 회원",
                "password": AUTH_PASSWORD,
                "email": "synthetic@example.test",
                "phone": "synthetic",
            },
            headers=browser.session_headers()
            | {"X-EduVibe-Auth-Revision": browser.revision},
        )
        assert response.status_code == 422
        assert set(response.json()["error"]["fields"]) == {"email", "phone"}
        assert browser.login(AUTH_MEMBERS["approved"][1]).status_code == 200
        with sqlite3.connect(database) as db:
            before = db.execute(
                "SELECT absolute_expires_at,expires_at FROM sessions WHERE flow_id=? ORDER BY issued_seq",
                (browser.flow,),
            ).fetchall()
        assert browser.me().status_code == 200
        with sqlite3.connect(database) as db:
            assert (
                db.execute(
                    "SELECT absolute_expires_at,expires_at FROM sessions WHERE flow_id=? ORDER BY issued_seq",
                    (browser.flow,),
                ).fetchall()
                == before
            )
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
        for key in (
            "health_check",
            "health_batch",
            "email_collection",
            "phone_collection",
        ):
            assert not capabilities[key]["enabled"]
        response = browser.logout()
        assert response.status_code == 204
        for header in response.headers.get_list("set-cookie"):
            name, attributes = next(iter(SimpleCookie(header).items()))
            assert name.startswith("__Host-")
            assert attributes["secure"] and attributes["httponly"]
            assert attributes["path"] == "/" and not attributes["domain"]
            assert attributes["samesite"].lower() == "lax"


@pytest.mark.parametrize("actor", ["member", "admin"])
def test_candidate_revocation_after_write_reservation(candidate_app, actor):
    from sqlalchemy import event

    from tests.app_create_client import issue as app_issue
    from tests.contracts.test_admin_approval import issue as admin_issue

    client, app, database, path, _record = candidate_app
    browser = Browser(client).prepare().anonymous()
    name = "approved" if actor == "member" else "admin"
    assert browser.login(AUTH_MEMBERS[name][1]).status_code == 200
    observed = []

    def revoke_after_lock(conn, cursor, statement, parameters, context, executemany):
        if statement == "BEGIN IMMEDIATE" and not observed:
            observed.append(True)
            path.unlink()

    event.listen(app.state.engine, "after_cursor_execute", revoke_after_lock)
    try:
        response = app_issue(browser) if actor == "member" else admin_issue(browser)
    finally:
        event.remove(app.state.engine, "after_cursor_execute", revoke_after_lock)
    assert observed
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "FEATURE_UNAVAILABLE"
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM apps").fetchone() == (0,)


def test_explicit_test_settings_require_isolated_temporary_storage(monkeypatch):
    def reject_open(*args):
        raise AssertionError("unisolated test boundary opened a database")

    monkeypatch.setattr("app.main.make_engine", reject_open)
    settings = Settings(
        app_env="test",
        database_path=Path("/srv/eduvibe/data/api.sqlite3"),
        public_origin="http://localhost:5174",
    )
    with (
        pytest.raises(
            RuntimeError,
            match="Application configuration or database revision is invalid",
        ),
        TestClient(create_app(settings, auth_testing=True)),
    ):
        pass


def test_candidate_revocation_closes_issued_member_and_admin_keys(candidate_app):
    from tests.app_create_client import issued_key
    from tests.auth_client import signed_in
    from tests.contracts.test_admin_approval import cancel, execute, issue, read

    client, app, database, path, _record = candidate_app
    member = signed_in(client)
    member_key = issued_key(member)
    # The fixture owns lifespan; this client owns only another browser's cookie jar.
    administrator_client = TestClient(app, base_url="http://localhost:5174")
    try:
        admin = signed_in(administrator_client, "admin")
        admin_key = issue(admin).json()["key"]
        path.unlink()
        for browser, key in ((member, member_key), (admin, admin_key)):
            for response in (read(browser, key), cancel(browser, key)):
                assert response.status_code == 503
                assert response.json()["error"]["code"] == "FEATURE_UNAVAILABLE"
        response = execute(admin, admin_key)
        assert response.status_code == 503
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT state FROM write_operations ORDER BY key"
            ).fetchall() == [("unresolved",), ("unresolved",)]
            assert db.execute(
                "SELECT account_version FROM members WHERE id=?",
                (AUTH_MEMBERS["pending"][0],),
            ).fetchone() == (1,)
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (0,)
    finally:
        administrator_client.close()
