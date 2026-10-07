"""Account deletion has its own durable delivery group and constrained result."""

import sqlite3

from app.database import current_head


def test_account_group_schema_is_current_and_has_no_target_cascade(member_app):
    _, path = member_app()
    assert current_head() == "0012_health_checks"
    with sqlite3.connect(path) as db:
        assert "expected_app_count" in [
            r[1] for r in db.execute("PRAGMA table_info(write_operations)")
        ]
        assert (
            db.execute("PRAGMA foreign_key_list(user_delete_outbox)").fetchall() == []
        )
        assert len(db.execute("PRAGMA table_info(user_delete_outbox)").fetchall()) == 11


from uuid import uuid4

import pytest

from tests.support import AUTH_MEMBERS
from tests.user_delete_client import TARGET


def test_upgrade_preserves_every_predecessor_value_and_structure(tmp_path, monkeypatch):
    from pathlib import Path

    from alembic.config import Config

    from alembic import command
    from tests.support import populate_auth_members

    path = tmp_path / "upgrade.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "0010_password_reset")
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
        for state in ("unresolved", "succeeded", "rejected"):
            db.execute(
                "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,reset_key_id,reset_request_hmac,created_at,expires_at,state,result_account_version,result_temporary_password_expires_at,applied_at,failure_code) VALUES (?,?,'user_password_reset',?,1,?,?,'2026-10-01T00:00:00Z','2099-01-01T00:00:00Z',?,?,?,?,?)",
                (
                    str(uuid4()),
                    AUTH_MEMBERS["admin"][0],
                    TARGET,
                    "c" * 64,
                    "d" * 64,
                    state,
                    2 if state == "succeeded" else None,
                    "2026-10-02T00:00:00Z" if state == "succeeded" else None,
                    "2026-10-01T00:00:00Z" if state != "unresolved" else None,
                    "USER_NOT_FOUND" if state == "rejected" else None,
                ),
            )
        related = {
            t: db.execute(f"SELECT * FROM {t} ORDER BY 1").fetchall()
            for t in ("members", "audit_logs", "member_deletions", "app_deletions")
        }
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
            db.execute("SELECT expected_app_count FROM write_operations").fetchall()
            == [(None,)] * 16
        )
        assert {
            t: db.execute(f"SELECT * FROM {t} ORDER BY 1").fetchall() for t in related
        } == related
    with pytest.raises(
        RuntimeError,
        match="Health execution history requires a verified backup restore",
    ):
        command.downgrade(config, "0010_password_reset")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0012_health_checks",
        )


def test_user_delete_count_and_result_checks_are_null_safe(member_app):
    _, path = member_app()
    with sqlite3.connect(path) as db:
        key = str(uuid4())
        db.execute(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_app_count,request_hash,created_at,expires_at,state) VALUES (?,?,'user_delete',?,0,?,'2026-10-01T00:00:00Z','2099-01-01T00:00:00Z','unresolved')",
            (key, AUTH_MEMBERS["admin"][0], TARGET, "a" * 64),
        )
        for assignment in (
            "expected_app_count=NULL",
            "expected_app_count=-1",
            "expected_app_count=0.5",
            "expected_app_count=9007199254740992",
            "target_id=NULL",
            "request_hash=NULL",
            "request_hash='Z'",
            "expected_account_version=1",
            "expected_version=1",
            "result_version=1",
            "reset_key_id='" + "a" * 64 + "'",
            "state='confirming_deletion'",
            "state='succeeded'",
            "state='rejected'",
            "db_applied_at='2026-10-01T00:00:00Z'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(
                    f"UPDATE write_operations SET {assignment} WHERE key=?", (key,)
                )
        db.execute(
            "UPDATE write_operations SET state='confirming_deletion',db_applied_at='2026-10-01T00:00:00Z' WHERE key=?",
            (key,),
        )
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "UPDATE write_operations SET applied_at='2026-10-01T00:00:00Z' WHERE key=?",
                (key,),
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
