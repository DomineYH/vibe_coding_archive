import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command
from app.main import create_app
from app.settings import Settings
from tests.app_create_client import create, read
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import execute
from tests.contracts.test_admin_approval import read as approval_read
from tests.support import AUTH_MEMBERS, populate_auth_members


def test_update_migration_preserves_all_old_rows_and_app_data_and_enforces_shapes(
    tmp_path, monkeypatch, password_blocklist
):
    path = tmp_path / "0007.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    command.upgrade(config, "0007_app_create")
    populate_auth_members(path)
    from app.app_input import AppInput
    from tests.app_create_client import INPUT
    from tests.support import populate_public_and_private_apps

    populate_public_and_private_apps(path, 2)
    keys = {
        (kind, state): str(uuid4())
        for kind in ("user_approval", "app_create")
        for state in ("unresolved", "succeeded", "rejected")
    }
    with sqlite3.connect(path) as db:
        app_id = db.execute("SELECT id FROM apps LIMIT 1").fetchone()[0]
        for (kind, state), key in keys.items():
            if kind == "user_approval":
                db.execute(
                    "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,approved,created_at,expires_at,state,result_account_version,result_approved,applied_at,failure_code) VALUES (?,?,'user_approval',?,1,1,'2026-10-01T00:00:00Z','2099-10-02T00:00:00Z',?,?,?,?,?)",
                    (
                        key,
                        AUTH_MEMBERS["admin"][0],
                        AUTH_MEMBERS["pending"][0],
                        state,
                        2 if state == "succeeded" else None,
                        1 if state == "succeeded" else None,
                        "2026-10-01T00:01:00Z" if state != "unresolved" else None,
                        "OPERATION_CANCELLED" if state == "rejected" else None,
                    ),
                )
            else:
                db.execute(
                    "INSERT INTO write_operations(key,actor_id,kind,target_id,request_hash,created_at,expires_at,state,result_version,applied_at,failure_code) VALUES (?,?,'app_create',?,?,'2026-10-01T00:00:00Z','2099-10-02T00:00:00Z',?,?,?,?)",
                    (
                        key,
                        AUTH_MEMBERS["approved"][0],
                        app_id if state == "succeeded" else None,
                        AppInput(**INPUT).request_hash(),
                        state,
                        1 if state == "succeeded" else None,
                        "2026-10-01T00:01:00Z" if state != "unresolved" else None,
                        "OPERATION_CANCELLED" if state == "rejected" else None,
                    ),
                )
        columns = [row[1] for row in db.execute("PRAGMA table_info(write_operations)")]
        original = db.execute("SELECT * FROM write_operations ORDER BY key").fetchall()
        data = {
            table: db.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            for table in ("apps", "app_grades", "health_results")
        }
        data_columns = {
            table: ",".join(row[1] for row in db.execute(f"PRAGMA table_info({table})"))
            for table in data
        }
    settings = Settings(
        app_env="test",
        database_path=path,
        public_origin="http://localhost:5174",
        password_blocklist_path=password_blocklist,
    )
    with (
        pytest.raises(RuntimeError, match="configuration or database revision"),
        TestClient(create_app(settings, auth_testing=True)),
    ):
        pass
    command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0012_health_checks",
        )
        assert (
            db.execute(
                f"SELECT {','.join(columns)} FROM write_operations ORDER BY key"
            ).fetchall()
            == original
        )
        assert (
            db.execute("SELECT expected_version FROM write_operations").fetchall()
            == [(None,)] * 6
        )
        for table, rows in data.items():
            assert (
                db.execute(
                    f"SELECT {data_columns[table]} FROM {table} ORDER BY 1"
                ).fetchall()
                == rows
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert any(
            row[1] == "ix_write_operations_expiry"
            for row in db.execute("PRAGMA index_list(write_operations)")
        )
        assert any(
            row[2] == "members" and row[3] == "actor_id"
            for row in db.execute("PRAGMA foreign_key_list(write_operations)")
        )
        ddl = db.execute(
            "SELECT sql FROM sqlite_master WHERE name='write_operations'"
        ).fetchone()[0]
        for name in (
            "kind",
            "kind_fields",
            "state",
            "account_version",
            "approved",
            "result_version",
            "app_result",
            "expected_version",
            "update_result",
        ):
            assert f"ck_write_{name}" in ddl
        db.execute("PRAGMA foreign_keys=ON")
        key = str(uuid4())
        db.execute(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_version,request_hash,created_at,expires_at,state) VALUES (?,?,'app_update',?,1,?,'2026-10-01T00:00:00Z','2099-10-02T00:00:00Z','unresolved')",
            (key, AUTH_MEMBERS["approved"][0], app_id, "a" * 64),
        )
        for change in (
            "kind='invalid'",
            "state='invalid'",
            "target_id=NULL",
            "expected_version=NULL",
            "expected_version=0",
            "expected_version=9007199254740992",
            "expected_account_version=1",
            "approved=1",
            "result_account_version=1",
            "result_approved=1",
            "request_hash=NULL",
            "result_version=2",
            "state='succeeded'",
            "state='rejected'",
            "actor_id='missing'",
        ):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(f"UPDATE write_operations SET {change} WHERE key=?", (key,))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "UPDATE write_operations SET key=? WHERE key=?",
                (keys[("app_create", "unresolved")], key),
            )
        db.execute(
            "UPDATE write_operations SET state='succeeded',result_version=2,applied_at='2026-10-01T00:01:00Z' WHERE key=?",
            (key,),
        )
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "UPDATE write_operations SET result_version=3 WHERE key=?", (key,)
            )
        db.execute(
            "UPDATE write_operations SET state='rejected',result_version=NULL,failure_code='VERSION_CONFLICT' WHERE key=?",
            (key,),
        )
    with pytest.raises(RuntimeError, match="backup"):
        command.downgrade(config, "0007_app_create")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (
            "0012_health_checks",
        )
        assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (7,)
    with (
        TestClient(create_app(settings, auth_testing=True)) as client,
        TestClient(create_app(settings, auth_testing=True)) as admin_client,
    ):
        owner, admin = signed_in(client), signed_in(admin_client, "admin")
        assert (
            approval_read(admin, keys[("user_approval", "succeeded")]).json()[
                "applied_account_version"
            ]
            == 2
        )
        assert execute(admin, keys[("user_approval", "unresolved")]).status_code == 200
        assert (
            read(owner, keys[("app_create", "succeeded")]).json()["state"]
            == "succeeded"
        )
        create_key = keys[("app_create", "unresolved")]
        assert create(owner, create_key).status_code == 201
        assert create(owner, create_key).status_code == 201
