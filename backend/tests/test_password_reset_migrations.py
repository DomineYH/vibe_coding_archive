"""Reset schema rejects incomplete fingerprints and preserves predecessor history."""

import sqlite3
from uuid import uuid4

import pytest

from tests.support import AUTH_MEMBERS


def test_reset_shape_requires_complete_lowercase_hmac_and_terminal_results(member_app):
    _, path = member_app()
    with sqlite3.connect(path) as db:
        key = str(uuid4())
        db.execute(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,reset_key_id,reset_request_hmac,created_at,expires_at,state) VALUES (?,?,'user_password_reset',?,1,?,?,'2026-10-01T00:00:00Z','2099-01-01T00:00:00Z','unresolved')",
            (
                key,
                AUTH_MEMBERS["admin"][0],
                AUTH_MEMBERS["approved"][0],
                "a" * 64,
                "b" * 64,
            ),
        )
        for assignment in (
            "reset_key_id=NULL",
            "reset_request_hmac=NULL",
            "reset_request_hmac='A'",
            "expected_account_version=NULL",
            "expected_account_version=0",
            "state='confirming_deletion'",
            "state='succeeded'",
            "state='rejected'",
            "result_temporary_password_expires_at='2099-01-01T00:00:00Z'",
            "request_hash='" + "a" * 64 + "'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(
                    f"UPDATE write_operations SET {assignment} WHERE key=?", (key,)
                )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_upgrade_preserves_all_previous_kinds_states_indexes_and_outbox(
    tmp_path, monkeypatch
):
    from pathlib import Path

    from alembic.config import Config

    from alembic import command
    from tests.support import populate_auth_members

    path = tmp_path / "upgrade.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "0009_app_delete")
    populate_auth_members(path)
    with sqlite3.connect(path) as db:
        for kind in ("user_approval", "app_create", "app_update", "app_delete"):
            states = ["unresolved", "succeeded", "rejected"] + (
                ["confirming_deletion"] if kind == "app_delete" else []
            )
            for state in states:
                key = str(uuid4())
                stamp = "2026-10-01T00:00:00Z"
                db.execute(
                    "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,approved,expected_version,request_hash,created_at,expires_at,state,result_account_version,result_approved,result_version,applied_at,failure_code,db_applied_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        key,
                        AUTH_MEMBERS["admin"][0],
                        kind,
                        TARGET
                        if kind != "app_create" or state == "succeeded"
                        else None,
                        1 if kind == "user_approval" else None,
                        1 if kind == "user_approval" else None,
                        1 if kind in ("app_update", "app_delete") else None,
                        "a" * 64 if kind != "user_approval" else None,
                        stamp,
                        "2099-01-01T00:00:00Z",
                        state,
                        2 if kind == "user_approval" and state == "succeeded" else None,
                        1 if kind == "user_approval" and state == "succeeded" else None,
                        (2 if kind == "app_update" else 1)
                        if kind in ("app_create", "app_update") and state == "succeeded"
                        else None,
                        stamp if state in ("succeeded", "rejected") else None,
                        "CONTROLLED_REJECTION" if state == "rejected" else None,
                        stamp
                        if kind == "app_delete"
                        and state in ("succeeded", "confirming_deletion")
                        else None,
                    ),
                )
                if kind == "app_delete" and state == "confirming_deletion":
                    db.execute(
                        "INSERT INTO app_delete_outbox(event_id,operation_key,app_id,source,db_applied_at) VALUES (?,?,?,'interactive_app_delete',?)",
                        (str(uuid4()), key, TARGET, stamp),
                    )
        columns = [row[1] for row in db.execute("PRAGMA table_info(write_operations)")]
        original = db.execute("SELECT * FROM write_operations ORDER BY key").fetchall()
        outbox = db.execute("SELECT * FROM app_delete_outbox").fetchall()
        indices = db.execute("PRAGMA index_list(write_operations)").fetchall()
        fks = db.execute("PRAGMA foreign_key_list(write_operations)").fetchall()
        outbox_indices = db.execute("PRAGMA index_list(app_delete_outbox)").fetchall()
    command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert (
            db.execute(
                f"SELECT {','.join(columns)} FROM write_operations ORDER BY key"
            ).fetchall()
            == original
        )
        assert db.execute("SELECT * FROM app_delete_outbox").fetchall() == outbox
        assert db.execute("PRAGMA index_list(write_operations)").fetchall() == indices
        assert db.execute("PRAGMA foreign_key_list(write_operations)").fetchall() == fks
        assert (
            db.execute("PRAGMA index_list(app_delete_outbox)").fetchall()
            == outbox_indices
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert (
            db.execute(
                "SELECT reset_key_id,reset_request_hmac,result_temporary_password_expires_at FROM write_operations"
            ).fetchall()
            == [(None, None, None)] * 13
        )


from tests.password_reset_client import TARGET
