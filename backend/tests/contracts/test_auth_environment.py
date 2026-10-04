"""Environment activation preserves the real authentication boundary."""

import sqlite3
from http.cookies import SimpleCookie

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
    "auth_login",
    "auth_logout",
    "auth_password_change",
    "auth_register",
    "admin_users_read",
    "admin_approval",
    "admin_summary",
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
            AUTH_BUNDLE | {"apps_read"}
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


def test_production_auth_stays_disabled_without_blocklist(
    tmp_path, migrate_test_database
):
    path = tmp_path / "production.sqlite3"
    migrate_test_database(path)
    settings = Settings(
        app_env="production",
        database_path=path,
        public_origin="https://archive.example.test",
        password_blocklist_path=tmp_path / "missing.txt",
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/readyz").status_code == 200
        assert_auth_disabled(client)


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
