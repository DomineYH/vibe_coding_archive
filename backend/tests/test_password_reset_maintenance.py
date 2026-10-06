"""Restart/loss/rotation/expiry preserve terminal history without secret-dependent reads."""

import sqlite3

from fastapi.testclient import TestClient

from app.auth_maintenance import sweep
from app.main import create_app
from tests.password_reset_client import (
    admin,
    cancel,
    execute,
    issue,
    reset_app,
    result,
    supply,
)


def test_restart_and_rotation_preserve_success_and_invalidate_only_unresolved(
    make_test_app, tmp_path
):
    app, _path, secret = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        success = issue(browser).json()["key"]
        assert execute(browser, success).status_code == 204
        unresolved = issue(browser, version=2).json()["key"]
        expected = result(browser, success).json()
        settings = app.state.settings
    with TestClient(create_app(settings, auth_testing=True)) as client:
        browser = admin(client)
        assert result(browser, unresolved).json()["state"] == "unresolved"
    supply(secret)
    with TestClient(create_app(settings, auth_testing=True)) as client:
        browser = admin(client)
        assert (
            result(browser, unresolved).json()["rejection_code"]
            == "OPERATION_INVALIDATED"
        )
        body = result(browser, success).json()
        for field in (
            "state",
            "finalized_at",
            "expires_at",
            "temporary_password_expires_at",
        ):
            assert body[field] == expected[field]
        assert execute(browser, success).status_code == 503
        assert issue(browser, version=2).status_code == 201
    secret.unlink()
    with TestClient(create_app(settings, auth_testing=True)) as client:
        browser = admin(client)
        assert issue(browser, version=2).status_code == 503
        assert result(browser, success).json()["state"] == "succeeded"
        assert cancel(browser, unresolved).status_code == 200


def test_expired_online_fingerprint_is_swept_without_audit_loss(
    make_test_app, tmp_path
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        assert cancel(browser, key).status_code == 200
        with sqlite3.connect(path) as db:
            db.execute("UPDATE write_operations SET expires_at='2000-01-01T00:00:00Z'")
        assert result(browser, key).status_code == 410
        sweep(app.state.session_factory)
        assert result(browser, key).status_code == 404
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='cancel_user_password_reset'"
            ).fetchone() == (1,)


def test_failed_secret_invalidation_stays_closed_and_retries_atomically(
    make_test_app, tmp_path
):
    app, path, secret = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_reset_invalidation BEFORE INSERT ON audit_logs WHEN NEW.action='invalidate_user_password_reset' BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        secret.unlink()
        assert execute(browser, key).status_code == 503
        assert app.state.auth_ready
        assert result(browser, key).json()["state"] == "unresolved"
        with sqlite3.connect(path) as db:
            db.execute("DROP TRIGGER fail_reset_invalidation")
        app.state.password_reset_gate.maintain()
        assert result(browser, key).json()["rejection_code"] == "OPERATION_INVALIDATED"
        supply(secret)
        assert issue(browser).status_code == 503


def test_pending_retention_after_reset_preserves_result_and_restore_erases_authority(
    make_test_app, tmp_path
):
    from app.auth_maintenance import reconcile
    from tests.support import AUTH_MEMBERS

    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        target = AUTH_MEMBERS["pending"][0]
        key = issue(browser, target).json()["key"]
        assert execute(browser, key, target).status_code == 204
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET created_at='2000-01-01T00:00:00Z' WHERE id=?",
                (target,),
            )
        sweep(app.state.session_factory)
        assert result(browser, key).json()["state"] == "succeeded"
        reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_password_reset'"
            ).fetchone() == (1,)


def test_auth_readiness_failure_does_not_invalidate_keys_with_verified_same_secret(
    make_test_app, tmp_path, monkeypatch
):
    app, path, _ = reset_app(make_test_app, tmp_path)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        settings = app.state.settings

    def refuse(*args):
        raise RuntimeError("controlled auth verification failure")

    monkeypatch.setattr("app.main.reconcile", refuse)
    with TestClient(create_app(settings, auth_testing=True)) as client:
        assert (
            client.get("/api/v1/meta").json()["capabilities"]["admin_password_reset"][
                "enabled"
            ]
            is False
        )
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)


def test_real_process_restart_reloads_only_explicit_test_secret_and_preserves_history(
    make_test_app, tmp_path, password_blocklist
):
    from tests.auth_process import AuthProcess

    _app, path, secret = reset_app(make_test_app, tmp_path)
    server = AuthProcess(path, password_blocklist)
    # create_app has not entered lifespan yet; use its explicitly configured test settings.
    server.env["PASSWORD_RESET_HMAC_PATH"] = str(secret)
    try:
        server.start()
        with server.client() as client:
            browser = admin(client)
            success = issue(browser).json()["key"]
            assert execute(browser, success).status_code == 204
            pending = issue(browser, version=2).json()["key"]
            cookies = dict(client.cookies)
        server.kill()
        server.start()
        with server.client() as client:
            client.cookies.update(cookies)
            browser.client = client
            assert result(browser, success).json()["state"] == "succeeded"
            assert result(browser, pending).json()["state"] == "unresolved"
            assert execute(browser, pending, version=2).status_code == 204
            old_key = issue(browser, version=3).json()["key"]
        server.kill()
        supply(secret)
        server.start()
        with server.client() as client:
            client.cookies.update(cookies)
            browser.client = client
            assert (
                result(browser, old_key).json()["rejection_code"]
                == "OPERATION_INVALIDATED"
            )
            assert result(browser, success).json()["state"] == "succeeded"
            assert issue(browser, version=3).status_code == 201
    finally:
        server.close()
