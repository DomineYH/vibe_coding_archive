import sqlite3
from pathlib import Path

import pytest
from alembic.config import Config

from alembic import command
from tests.support import populate_public_and_private_apps

HEAD = "0013_subject_changche"
INSERT = (
    "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,version,url_version,created_at,updated_at) "
    "VALUES (?,(SELECT id FROM members LIMIT 1),'앱','https://example.test','p','d',?,1,'cloudDancer',1,1,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')"
)


def database(tmp_path, monkeypatch):
    path = tmp_path / "0012.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "0012_health_checks")
    populate_public_and_private_apps(path, 2)
    return path, config


def version(path):
    with sqlite3.connect(path) as db:
        return db.execute("SELECT version_num FROM alembic_version").fetchone()[0]


def triggers(db):
    return {
        row[0]
        for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='apps'"
        )
    }


def rejects(db, app_id, subject):
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(INSERT, (app_id, subject))


def test_0013_widens_subject_check_and_preserves_apps_schema_and_triggers(
    tmp_path, monkeypatch
):
    path, config = database(tmp_path, monkeypatch)
    with sqlite3.connect(path) as db:
        rejects(db, "early", "창체")
        before = db.execute("SELECT * FROM apps ORDER BY id").fetchall()
    command.upgrade(config, "head")
    assert version(path) == HEAD
    from app.models import App

    model_check = next(
        str(c.sqltext) for c in App.__table__.constraints if c.name == "ck_apps_subject"
    )
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT * FROM apps ORDER BY id").fetchall() == before
        db.execute(INSERT, ("changche", "창체"))
        rejects(db, "outside", "outside")
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert {row[1] for row in db.execute("PRAGMA index_list(apps)")} >= {
            "ix_apps_public_created_id",
            "ix_apps_owner_id",
        }
        assert [
            (row[2], row[3], row[6])
            for row in db.execute("PRAGMA foreign_key_list(apps)")
        ] == [("members", "owner_id", "CASCADE")]
        assert triggers(db) == {"health_url_changed", "health_app_deleted"}
        table_sql = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='apps'"
        ).fetchone()[0]
        assert f"CONSTRAINT ck_apps_subject CHECK ({model_check})" in table_sql
        app_id = before[0][0]
        assert db.execute(
            "SELECT count(*) FROM health_results WHERE app_id=?", (app_id,)
        ).fetchone() == (1,)
        db.execute("DELETE FROM apps WHERE id=?", (app_id,))
        assert db.execute(
            "SELECT count(*) FROM health_results WHERE app_id=?", (app_id,)
        ).fetchone() == (0,)


def test_0013_downgrade_refuses_with_changche_rows_and_succeeds_without(
    tmp_path, monkeypatch
):
    path, config = database(tmp_path, monkeypatch)
    command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        db.execute(INSERT, ("changche", "창체"))
    with pytest.raises(RuntimeError, match="창체"):
        command.downgrade(config, "0012_health_checks")
    assert version(path) == HEAD
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT subject FROM apps WHERE id='changche'"
        ).fetchone() == ("창체",)
        db.execute("DELETE FROM apps WHERE id='changche'")
    command.downgrade(config, "0012_health_checks")
    assert version(path) == "0012_health_checks"
    with sqlite3.connect(path) as db:
        rejects(db, "changche", "창체")
        assert triggers(db) == {"health_url_changed", "health_app_deleted"}
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    command.upgrade(config, "head")
    assert version(path) == HEAD
