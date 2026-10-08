import sqlite3

from app.database import current_head


def test_delete_migration_is_current_and_durable_outbox_has_no_cascading_fk(member_app):
    _app, path = member_app()
    assert current_head() == "0012_health_checks"
    with sqlite3.connect(path) as db:
        assert "db_applied_at" in [
            r[1] for r in db.execute("PRAGMA table_info(write_operations)")
        ]
        assert db.execute("PRAGMA foreign_key_list(app_delete_outbox)").fetchall() == []
        assert db.execute("SELECT count(*) FROM app_delete_outbox").fetchone() == (0,)


def test_upgrade_preserves_all_predecessor_columns_and_delete_checks(
    member_app, tmp_path, monkeypatch
):
    from pathlib import Path
    from uuid import uuid4

    import pytest
    from alembic.config import Config

    from alembic import command
    from tests.support import (
        AUTH_MEMBERS,
        populate_auth_members,
        populate_public_and_private_apps,
    )

    path = tmp_path / "upgrade.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "0008_app_update")
    populate_auth_members(path)
    populate_public_and_private_apps(path, 2)
    with sqlite3.connect(path) as db:
        app_id = db.execute("SELECT id FROM apps LIMIT 1").fetchone()[0]
        for kind in ("user_approval", "app_create", "app_update"):
            for state in ("unresolved", "succeeded", "rejected"):
                db.execute(
                    "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,approved,expected_version,request_hash,created_at,expires_at,state,result_account_version,result_approved,result_version,applied_at,failure_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        str(uuid4()),
                        AUTH_MEMBERS["approved"][0],
                        kind,
                        app_id
                        if kind != "app_create" or state == "succeeded"
                        else None,
                        1 if kind == "user_approval" else None,
                        1 if kind == "user_approval" else None,
                        1 if kind == "app_update" else None,
                        "a" * 64 if kind != "user_approval" else None,
                        "2026-10-01T00:00:00Z",
                        "2099-01-01T00:00:00Z",
                        state,
                        2 if kind == "user_approval" and state == "succeeded" else None,
                        1 if kind == "user_approval" and state == "succeeded" else None,
                        (2 if kind == "app_update" else 1)
                        if kind != "user_approval" and state == "succeeded"
                        else None,
                        "2026-10-01T00:01:00Z" if state != "unresolved" else None,
                        "VERSION_CONFLICT" if state == "rejected" else None,
                    ),
                )
        columns = [r[1] for r in db.execute("PRAGMA table_info(write_operations)")]
        original = db.execute("SELECT * FROM write_operations ORDER BY key").fetchall()
        related = {
            t: db.execute(f"SELECT * FROM {t} ORDER BY 1").fetchall()
            for t in (
                "apps",
                "app_grades",
                "health_results",
                "audit_logs",
                "member_deletions",
                "app_deletions",
            )
        }
        related_columns = {
            table: ",".join(row[1] for row in db.execute(f"PRAGMA table_info({table})"))
            for table in related
        }
    command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert (
            db.execute(
                f"SELECT {','.join(columns)} FROM write_operations ORDER BY key"
            ).fetchall()
            == original
        )
        assert (
            db.execute("SELECT db_applied_at FROM write_operations").fetchall()
            == [(None,)] * 9
        )
        assert {
            t: db.execute(f"SELECT {related_columns[t]} FROM {t} ORDER BY 1").fetchall()
            for t in related
        } == related
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        sql = db.execute(
            "SELECT sql FROM sqlite_master WHERE name='write_operations'"
        ).fetchone()[0]
        for check in (
            "ck_write_kind",
            "ck_write_state",
            "ck_write_expected_version",
            "ck_write_kind_fields",
            "ck_write_app_result",
            "ck_write_update_result",
            "ck_write_delete_stamp",
            "ck_write_delete_result",
        ):
            assert check in sql
        for kind in ("user_approval", "app_create", "app_update"):
            for assignment in (
                "state='confirming_deletion'",
                "db_applied_at='2026-10-01T00:00:00Z'",
            ):
                with pytest.raises(sqlite3.IntegrityError):
                    db.execute(
                        f"UPDATE write_operations SET {assignment} WHERE kind=?",
                        (kind,),
                    )
        key = str(uuid4())
        db.execute(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_version,request_hash,created_at,expires_at,state) VALUES (?,?,'app_delete',?,1,?,'2026-10-01T00:00:00Z','2099-01-01T00:00:00Z','unresolved')",
            (key, AUTH_MEMBERS["approved"][0], app_id, "b" * 64),
        )
        for assignment in (
            "expected_version=NULL",
            "target_id=NULL",
            "request_hash=NULL",
            "result_version=1",
            "state='succeeded'",
            "state='confirming_deletion'",
            "state='rejected'",
            "applied_at='2026-10-01T00:00:00Z'",
            "db_applied_at='2026-10-01T00:00:00Z'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(
                    f"UPDATE write_operations SET {assignment} WHERE key=?", (key,)
                )
        db.commit()
    with pytest.raises(
        RuntimeError,
        match="Health execution history requires a verified backup restore",
    ):
        command.downgrade(config, "0008_app_update")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0012_health_checks",
        )
