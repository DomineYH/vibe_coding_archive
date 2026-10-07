import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.auth_maintenance import reconcile, sweep
from tests.app_create_client import error, read
from tests.app_delete_client import delete, delete_key
from tests.app_update_client import registered
from tests.auth_client import signed_in


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_confirmation_failure_is_db_applied_and_maintenance_delivers(
    member_app, writer
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        key = delete_key(actor, item["id"])
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            response = delete(actor, item["id"], key)
            error(response, 503, "DELETION_CONFIRMATION_PENDING")
            result = read(actor, key).json()
            assert result["state"] == "confirming_deletion"
            assert (
                result["db_applied_at"] is not None and result["finalized_at"] is None
            )
            with sqlite3.connect(path, timeout=0.1) as db:
                db.execute("BEGIN IMMEDIATE")
                assert db.execute("SELECT count(*) FROM apps").fetchone() == (0,)
        sweep(app.state.session_factory)
        assert read(actor, key).json()["state"] == "succeeded"
        with sqlite3.connect(ledger_path) as ledger:
            assert ledger.execute(
                "SELECT count(*) FROM completed_app_delete_events"
            ).fetchone() == (1,)
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='app_delete'"
            ).fetchone() == (1,)


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_restore_replays_interactive_delete_of_approved_owner(
    member_app, tmp_path, writer
):
    app, path = member_app()
    backup = tmp_path / "before.sqlite3"
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        key = delete_key(actor, item["id"])
        with sqlite3.connect(path) as source, sqlite3.connect(backup) as target:
            source.backup(target)
        assert delete(actor, item["id"], key).status_code == 204
        with sqlite3.connect(backup) as source, sqlite3.connect(path) as target:
            source.backup(target)
        reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM apps").fetchone() == (0,)
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )


def test_restore_missing_independent_event_fails_before_any_ledger_repair(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        assert (
            delete(owner, item["id"], delete_key(owner, item["id"])).status_code == 204
        )
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("DELETE FROM completed_app_delete_events")
        with pytest.raises(RuntimeError):
            reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            assert ledger.execute(
                "SELECT count(*) FROM completed_app_delete_events"
            ).fetchone() == (0,)


def test_normal_undelivered_event_recovers_but_delivered_loss_is_corruption(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            error(delete(owner, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
        reconcile(app.state.session_factory)
        assert read(owner, key).json()["state"] == "succeeded"
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute("DELETE FROM completed_app_delete_events")
        with pytest.raises(RuntimeError, match="incomplete"):
            reconcile(app.state.session_factory)


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_independent_committed_event_survives_ack_crash_and_key_removal(
    member_app, writer
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        key = delete_key(actor, item["id"])
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_ack BEFORE UPDATE OF delivered_at ON app_delete_outbox BEGIN SELECT RAISE(ABORT,'ack lost'); END"
            )
        error(delete(actor, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            original = ledger.execute(
                "SELECT * FROM completed_app_delete_events"
            ).fetchall()
            assert len(original) == 1
        with sqlite3.connect(path) as db:
            db.execute("DROP TRIGGER fail_ack")
            db.execute("DELETE FROM write_operations WHERE key=?", (key,))
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT delivered_at FROM app_delete_outbox").fetchone()[0]
                is not None
            )
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            assert (
                ledger.execute("SELECT * FROM completed_app_delete_events").fetchall()
                == original
            )


def test_restore_undelivered_outbox_cannot_synthesize_evidence(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            error(delete(owner, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
        with pytest.raises(RuntimeError, match="incomplete"):
            reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(ledger_path) as ledger:
            assert ledger.execute(
                "SELECT count(*) FROM completed_app_delete_events"
            ).fetchone() == (0,)
        assert read(owner, key).json()["state"] == "confirming_deletion"


def test_restore_missing_schema_and_payload_mismatch_leave_ledger_untouched(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        assert delete(owner, item["id"], key).status_code == 204
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute(
                "UPDATE completed_app_delete_events SET db_applied_at='2000-01-01T00:00:00Z'"
            )
        with pytest.raises(RuntimeError, match="disagrees"):
            reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(ledger_path) as ledger:
            assert ledger.execute(
                "SELECT db_applied_at FROM completed_app_delete_events"
            ).fetchone() == ("2000-01-01T00:00:00Z",)
            ledger.execute("DROP TABLE completed_app_delete_events")
        with pytest.raises(RuntimeError, match="schema"):
            reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(ledger_path) as ledger:
            assert (
                ledger.execute(
                    "SELECT name FROM sqlite_master WHERE name='completed_app_delete_events'"
                ).fetchall()
                == []
            )


def test_existing_maintenance_cli_delivers_interactive_outbox(member_app):
    from tests.test_pending_retention import maintenance

    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            error(delete(owner, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
        result = maintenance(path)
        assert result.returncode == 0, result.stderr
        assert read(owner, key).json()["state"] == "succeeded"


def test_restore_finishes_matching_independent_evidence_after_ack_loss(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_ack BEFORE UPDATE OF delivered_at ON app_delete_outbox BEGIN SELECT RAISE(ABORT,'ack lost'); END"
            )
        error(
            delete(owner, item["id"], delete_key(owner, item["id"])),
            503,
            "DELETION_CONFIRMATION_PENDING",
        )
        with sqlite3.connect(path) as db:
            db.execute("DROP TRIGGER fail_ack")
        reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT delivered_at FROM app_delete_outbox").fetchone()[0]
                is not None
            )
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )


def test_pending_delivery_survives_actor_and_key_deletion(member_app):
    from tests.support import AUTH_MEMBERS

    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            error(delete(owner, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
        with sqlite3.connect(path) as db:
            db.execute("PRAGMA foreign_keys=ON")
            actor = AUTH_MEMBERS["approved"][0]
            db.execute(
                "UPDATE auth_flows SET current_session_generation=NULL WHERE id IN (SELECT flow_id FROM sessions WHERE member_id=?)",
                (actor,),
            )
            db.execute("DELETE FROM sessions WHERE member_id=?", (actor,))
            db.execute("DELETE FROM write_operations WHERE actor_id=?", (actor,))
            db.execute("DELETE FROM members WHERE id=?", (actor,))
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT delivered_at FROM app_delete_outbox").fetchone()[0]
                is not None
            )
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_malformed_independent_schema_fails_closed_even_without_events(member_app):
    app, path = member_app()
    with TestClient(app):
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute("DROP TABLE completed_app_delete_events")
            ledger.execute(
                "CREATE TABLE completed_app_delete_events(event_id TEXT,app_id TEXT,source TEXT,db_applied_at TEXT)"
            )
        with pytest.raises(RuntimeError, match="schema"):
            reconcile(app.state.session_factory)


def test_confirmed_delete_response_does_not_reopen_operational_cookie_reads(member_app):
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError

    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])

        def storage_unavailable_after_confirmation(
            connection, cursor, statement, parameters, context, many
        ):
            with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
                confirmed = ledger.execute(
                    "SELECT count(*) FROM completed_app_delete_events"
                ).fetchone()[0]
            if confirmed:
                raise OperationalError(
                    statement,
                    parameters,
                    sqlite3.OperationalError(
                        "injected post-confirmation storage failure"
                    ),
                )

        event.listen(
            app.state.engine,
            "before_cursor_execute",
            storage_unavailable_after_confirmation,
        )
        try:
            response = delete(owner, item["id"], key)
        finally:
            event.remove(
                app.state.engine,
                "before_cursor_execute",
                storage_unavailable_after_confirmation,
            )
        assert response.status_code == 204, response.text
        assert read(owner, key).json()["state"] == "succeeded"


@pytest.mark.parametrize("writer", ["owner", "admin"])
def test_confirming_same_key_replay_confirms_without_reexecuting_deletion(
    member_app, writer
):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as actor_client:
        owner = signed_in(client)
        item = registered(owner)
        actor = signed_in(actor_client, "admin") if writer == "admin" else owner
        key = delete_key(actor, item["id"])
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            error(delete(actor, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
            original = read(actor, key).json()
            error(delete(actor, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
            assert read(actor, key).json()["db_applied_at"] == original["db_applied_at"]
        error(delete(actor, item["id"], key, 2), 409, "OPERATION_KEY_MISMATCH")
        assert delete(actor, item["id"], key).status_code == 204
        result = read(actor, key).json()
        assert result["state"] == "succeeded"
        assert result["db_applied_at"] == original["db_applied_at"]
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM app_delete_outbox").fetchone() == (
                1,
            )
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='app_delete'"
            ).fetchone() == (1,)
        error(delete(actor, item["id"], key), 409, "OPERATION_ALREADY_RESOLVED")


def test_conflicting_independent_payload_never_acknowledges_deletion(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = delete_key(owner, item["id"])
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute(
                "INSERT INTO completed_app_delete_events VALUES ('00000000-0000-4000-8000-000000000000',?,'interactive_app_delete','2000-01-01T00:00:00Z')",
                (item["id"],),
            )
            original = ledger.execute(
                "SELECT * FROM completed_app_delete_events"
            ).fetchall()
        error(delete(owner, item["id"], key), 503, "DELETION_CONFIRMATION_PENDING")
        assert read(owner, key).json()["state"] == "confirming_deletion"
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT delivered_at FROM app_delete_outbox"
            ).fetchone() == (None,)
        with pytest.raises(RuntimeError, match="disagrees"):
            sweep(app.state.session_factory)
        assert read(owner, key).json()["state"] == "confirming_deletion"
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            assert (
                ledger.execute("SELECT * FROM completed_app_delete_events").fetchall()
                == original
            )
