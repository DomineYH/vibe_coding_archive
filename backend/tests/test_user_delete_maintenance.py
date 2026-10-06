"""Readiness, maintenance and independent deletion obligations."""

import sqlite3

from fastapi.testclient import TestClient

from tests.auth_client import signed_in
from tests.user_delete_client import execute, issue, result


def test_delete_capability_does_not_require_reset_secret(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
        assert capabilities["admin_user_delete"] == {"enabled": True, "reasons": []}
        assert not capabilities["admin_password_reset"]["enabled"]
        assert not capabilities["admin_apps_read"]["enabled"]
        assert not capabilities["admin_apps_manage"]["enabled"]
        admin = signed_in(client, "admin")
        assert execute(admin, issue(admin).json()["key"]).status_code == 204


def test_maintenance_cli_delivers_original_group(member_app):
    from tests.test_pending_retention import maintenance

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            assert execute(browser, key).status_code == 503
        delivery = maintenance(path)
        assert delivery.returncode == 0, delivery.stderr
        assert result(browser, key).json()["state"] == "succeeded"
