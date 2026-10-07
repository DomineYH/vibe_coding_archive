import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.main import create_app
from app.settings import Settings
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import execute, headers, read
from tests.support import AUTH_MEMBERS, populate_auth_members


def test_migration_preserves_approval_rows_constraints_and_http_operations(
    tmp_path, monkeypatch, password_blocklist
):
    path = tmp_path / "old-head.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "0006_retired_credentials")
    populate_auth_members(path)
    keys = [str(uuid4()), str(uuid4())]
    with sqlite3.connect(path) as db:
        db.executemany(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,approved,created_at,expires_at,state,result_account_version,result_approved,applied_at,failure_code) VALUES (?,?,'user_approval',?,1,1,'2026-10-01T00:00:00.000000Z','2099-10-02T00:00:00.000000Z',?,?,?,?,NULL)",
            [
                (
                    keys[0],
                    AUTH_MEMBERS["admin"][0],
                    AUTH_MEMBERS["pending"][0],
                    "unresolved",
                    None,
                    None,
                    None,
                ),
                (
                    keys[1],
                    AUTH_MEMBERS["admin"][0],
                    AUTH_MEMBERS["pending"][0],
                    "succeeded",
                    2,
                    1,
                    "2026-10-01T00:01:00.000000Z",
                ),
            ],
        )
        original = db.execute("SELECT * FROM write_operations ORDER BY key").fetchall()
        columns = [row[1] for row in db.execute("PRAGMA table_info(write_operations)")]
    settings = Settings(
        app_env="test",
        database_path=path,
        public_origin="http://localhost:5174",
        password_blocklist_path=password_blocklist,
    )
    # A 0006 database becomes old once #149 supplies its migration.
    with (
        pytest.raises(RuntimeError, match="configuration or database revision"),
        TestClient(create_app(settings, auth_testing=True)),
    ):
        pass
    command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0011_user_delete",
        )
        assert (
            db.execute(
                f"SELECT {','.join(columns)} FROM write_operations ORDER BY key"
            ).fetchall()
            == original
        )
        assert db.execute(
            "SELECT request_hash,result_version FROM write_operations"
        ).fetchall() == [(None, None), (None, None)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert any(
            row[1] == "ix_write_operations_expiry"
            for row in db.execute("PRAGMA index_list(write_operations)")
        )
        assert any(
            row[1] == "key" and row[5] == 1
            for row in db.execute("PRAGMA table_info(write_operations)")
        )
        assert any(
            row[2] == "members" and row[3] == "actor_id"
            for row in db.execute("PRAGMA foreign_key_list(write_operations)")
        )
        db.execute("PRAGMA foreign_keys=ON")
        for update in (
            "kind='app_update'",
            "state='invalid'",
            "expected_account_version=NULL",
            "kind='app_create'",
            "actor_id='missing'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(
                    f"UPDATE write_operations SET {update} WHERE key=?", (keys[0],)
                )
        db.execute(
            "INSERT INTO write_operations(key,actor_id,kind,created_at,expires_at,state,request_hash) VALUES (?,?,'app_create','2026-10-01T00:00:00Z','2099-10-02T00:00:00Z','unresolved',?)",
            (str(uuid4()), AUTH_MEMBERS["approved"][0], "a" * 64),
        )
    with pytest.raises(RuntimeError, match="backup"):
        command.downgrade(config, "0006_retired_credentials")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (3,)
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0011_user_delete",
        )
    with TestClient(create_app(settings, auth_testing=True)) as client:
        admin = signed_in(client, "admin")
        assert read(admin, keys[1]).json()["applied_account_version"] == 2
        assert execute(admin, keys[0]).status_code == 200
        assert (
            client.get("/api/v1/admin/users", headers=headers(admin)).status_code == 200
        )
