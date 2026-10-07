"""Commit-time authority and competing writers at the shared HTTP seam."""

import sqlite3

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from tests.app_create_client import INPUT, error, read
from tests.app_delete_client import delete, delete_key, issue_delete
from tests.app_update_client import detail, issue_update, registered, update, update_key
from tests.auth_client import signed_in
from tests.support import AUTH_MEMBERS


@pytest.mark.parametrize("kind", ["update", "delete"])
@pytest.mark.parametrize("stage", ["issue", "execute"])
@pytest.mark.parametrize("public", [True, False])
def test_admin_role_loss_before_commit_rolls_back_key_and_business_effects(
    member_app, kind, stage, public
):
    app, path = member_app()
    with TestClient(app) as owner_client, TestClient(app) as admin_client:
        owner, admin = signed_in(owner_client), signed_in(admin_client, "admin")
        item = registered(owner, {**INPUT, "is_public": public})
        issue, apply = (
            (issue_update, update) if kind == "update" else (issue_delete, delete)
        )
        key = issue(admin, item["id"]).json()["key"] if stage == "execute" else None
        tables = (
            "apps",
            "app_grades",
            "health_results",
            "write_operations",
            "audit_logs",
            "app_delete_outbox",
        )
        with sqlite3.connect(path) as db:
            before = {
                table: db.execute(f"SELECT * FROM {table}").fetchall()
                for table in tables
            }

        def demote(connection, cursor, statement, parameters, context, many):
            trigger = (
                "INSERT INTO write_operations"
                if stage == "issue"
                else "UPDATE write_operations SET state="
            )
            if statement.startswith(trigger):
                connection.exec_driver_sql(
                    "UPDATE members SET is_admin=0 WHERE id=?",
                    (AUTH_MEMBERS["admin"][0],),
                )

        event.listen(app.state.engine, "after_cursor_execute", demote)
        try:
            result = (
                issue(admin, item["id"])
                if stage == "issue"
                else apply(admin, item["id"], key)
            )
        finally:
            event.remove(app.state.engine, "after_cursor_execute", demote)
        error(result, 403 if public else 404, "FORBIDDEN" if public else "NOT_FOUND")
        assert detail(owner, item["id"]).json()["item"] == item
        with sqlite3.connect(path) as db:
            assert {
                table: db.execute(f"SELECT * FROM {table}").fetchall()
                for table in tables
            } == before


@pytest.mark.parametrize("rival_kind", ["approved", "hangul"])
@pytest.mark.parametrize("first", ["admin", "rival"])
@pytest.mark.parametrize(
    "actions", ["edit_edit", "edit_delete", "delete_edit", "delete_delete"]
)
def test_owner_admin_and_admin_admin_follow_first_committed_version(
    member_app, rival_kind, first, actions
):
    app, path = member_app()
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET is_admin=1 WHERE id=?", (AUTH_MEMBERS["hangul"][0],)
        )
    with (
        TestClient(app) as owner_client,
        TestClient(app) as admin_client,
        TestClient(app) as other_client,
    ):
        owner = signed_in(owner_client)
        actors = {
            "admin": signed_in(admin_client, "admin"),
            "rival": owner
            if rival_kind == "approved"
            else signed_in(other_client, "hangul"),
        }
        item = registered(owner)
        kinds = actions.split("_")
        ordered = [first, "rival" if first == "admin" else "admin"]
        commands = []
        for actor_name, kind in zip(ordered, kinds, strict=True):
            actor = actors[actor_name]
            key = (update_key if kind == "edit" else delete_key)(actor, item["id"])
            commands.append((actor, key, update if kind == "edit" else delete))
        actor, key, apply = commands[0]
        assert apply(actor, item["id"], key).status_code == (
            200 if kinds[0] == "edit" else 204
        )
        actor, key, apply = commands[1]
        code = "VERSION_CONFLICT" if kinds[0] == "edit" else "NOT_FOUND"
        error(apply(actor, item["id"], key), 409 if kinds[0] == "edit" else 404, code)
        assert read(actor, key).json()["rejection_code"] == code
        current = detail(owner, item["id"])
        if kinds[0] == "edit":
            assert current.json()["item"]["version"] == 2
        else:
            assert current.status_code == 404
