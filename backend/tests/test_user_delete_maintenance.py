"""Readiness, maintenance and independent deletion obligations."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from tests.auth_client import signed_in
from tests.user_delete_client import execute, issue, result


def test_delete_capability_does_not_require_reset_secret(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
        assert capabilities["admin_user_delete"] == {"enabled": True, "reasons": []}
        assert not capabilities["admin_password_reset"]["enabled"]
        assert capabilities["admin_apps_read"] == {"enabled": True, "reasons": []}
        assert capabilities["admin_apps_manage"] == {"enabled": True, "reasons": []}
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


@pytest.mark.parametrize("backup_member", ["old", "new"])
def test_restore_replays_old_uuid_without_deleting_reused_login_member(
    member_app, tmp_path, backup_member
):
    from app.auth_maintenance import reconcile
    from tests.app_update_client import registered
    from tests.auth_client import Browser
    from tests.contracts import test_admin_approval as approval
    from tests.contracts.test_auth_register import PASSWORD, register
    from tests.support import AUTH_MEMBERS

    app, path = member_app()
    old_id, login_id, _ = AUTH_MEMBERS["approved"]
    backup = tmp_path / "backup.sqlite3"
    with (
        TestClient(app) as client,
        TestClient(app) as old_client,
        TestClient(app) as new_client,
    ):
        admin = signed_in(client, "admin")
        old = signed_in(old_client)
        old_app = registered(old)
        with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
            src.backup(dst)
        key = issue(admin, count=1).json()["key"]
        assert execute(admin, key, count=1).status_code == 204
        new = Browser(new_client).prepare().anonymous()
        created = register(new, login_id=login_id.upper())
        assert created.status_code == 201, created.text
        new_id = created.json()["id"]
        assert new_id != old_id
        approval_key = approval.issue(admin, new_id).json()["key"]
        assert approval.execute(admin, approval_key, new_id).status_code == 200
        assert new.login(login_id, PASSWORD).status_code == 200
        new_app = registered(new)
        if backup_member == "new":
            with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
                src.backup(dst)

        # Only operational data rolls back; independent UUID deletion evidence stays current.
        with sqlite3.connect(backup) as src, sqlite3.connect(path) as dst:
            src.backup(dst)
        for _ in range(2):
            reconcile(app.state.session_factory, restored=True)
            with sqlite3.connect(path) as db:
                assert (
                    db.execute(
                        "SELECT id FROM members WHERE id=?", (old_id,)
                    ).fetchall()
                    == []
                )
                assert (
                    db.execute(
                        "SELECT id FROM apps WHERE id=? OR owner_id=?",
                        (old_app["id"], old_id),
                    ).fetchall()
                    == []
                )
                assert db.execute(
                    "SELECT id FROM members WHERE login_id_key=?", (login_id,)
                ).fetchall() == ([(new_id,)] if backup_member == "new" else [])
                assert db.execute(
                    "SELECT id,owner_id FROM apps WHERE id=?", (new_app["id"],)
                ).fetchall() == (
                    [(new_app["id"], new_id)] if backup_member == "new" else []
                )
                for table in ("sessions", "recovery_credentials", "auth_flows"):
                    assert db.execute(
                        f"SELECT count(*) FROM {table} WHERE revoked_at IS NULL"
                    ).fetchone() == (0,)
                assert db.execute(
                    "SELECT count(*) FROM write_operations"
                ).fetchone() == (0,)
                assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            assert old.me().status_code == 401
            assert new.me().status_code == 401
