import sqlite3

import pytest


def test_auth_identity_migration_enforces_identity_and_flow_constraints(
    tmp_path, migrate_test_database
):
    path = tmp_path / "auth.sqlite3"
    migrate_test_database(path)
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        tables = {
            row[0]
            for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert {
            "auth_flows",
            "sessions",
            "recovery_credentials",
            "auth_transitions",
            "rate_limit_events",
            "audit_logs",
        } <= tables
        columns = {row[1] for row in db.execute("PRAGMA table_info(members)")}
        assert {
            "login_id_key",
            "created_at",
            "first_approved_at",
            "account_version",
        } <= columns
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO members(id,login_id,nickname,is_admin,approval_status) VALUES ('id','Teacher','별명',0,'pending')"
            )

        insert_flow = "INSERT INTO auth_flows(id,revision,issued_seq,recovery_ready,ever_ready,last_identity_change_revision,created_at,last_activity_at,expires_at) VALUES (?,?,'0',0,0,'0','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:30:00Z')"
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(insert_flow, ("bad-flow", "01"))
        db.execute(insert_flow, ("flow", "0"))
        insert_session = "INSERT INTO sessions(token_hash,flow_id,issued_seq,kind,csrf_token,created_at,last_activity_at,absolute_expires_at,expires_at) VALUES (?,'flow','1',?,'fixture-csrf','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:15:00Z','2026-10-01T00:15:00Z')"
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(insert_session, ("bad-kind", "full"))
        db.execute(insert_session, ("fixture-hash", "anonymous"))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(insert_session, ("duplicate-sequence", "anonymous"))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO recovery_credentials(token_hash,flow_id,issued_seq,recovery_csrf_token,created_at,expires_at) VALUES ('fixture-r','missing','1','fixture-csrf','2026-10-01T00:00:00Z','2026-10-01T00:30:00Z')"
            )
        insert_transition = "INSERT INTO auth_transitions(transition_id,flow_id,kind,before_revision,admitted_revision,permit_expires_at,state,admitted_at) VALUES (?,'flow','anonymous_session',?,?,'2026-10-01T00:01:00Z','admitted','2026-10-01T00:00:00Z')"
        db.execute(insert_transition, ("flow.0", "0", "1"))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(insert_transition, ("flow.1", "1", "2"))


import json
from pathlib import Path

from alembic.config import Config
from pwdlib import PasswordHash

from alembic import command


def legacy_database(tmp_path, monkeypatch, rows):
    path = tmp_path / "legacy.sqlite3"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    monkeypatch.setenv("PUBLIC_ORIGIN", "http://localhost:5174")
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0002_public_apps")
    with sqlite3.connect(path) as db:
        db.executemany(
            "INSERT INTO members(id,login_id,nickname,password_hash,is_admin,approval_status) VALUES (?,?,?, ?,0,?)",
            rows,
        )
    return path, config


def test_verified_backfill_preserves_hash_ids_archive_ownership_and_original_text(
    tmp_path, monkeypatch
):
    member_id = "00000000-0000-4000-8000-000000000115"
    password_hash = PasswordHash.recommended().hash("synthetic migration password")
    path, config = legacy_database(
        tmp_path,
        monkeypatch,
        [(member_id, "Teacher", "별명", password_hash, "approved")],
    )
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,version,url_version,created_at,updated_at) VALUES ('app',?,'원문','https://example.test','line1\nline2','설명','수학',1,'cloudDancer',1,1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')",
            (member_id,),
        )
        original = db.execute("SELECT * FROM apps").fetchall()
    evidence = tmp_path / "verified-history.json"
    evidence.write_text(
        json.dumps(
            {
                member_id: {
                    "created_at": "2026-08-01T00:00:00Z",
                    "updated_at": "2026-08-02T00:00:00Z",
                    "first_approved_at": "2026-08-02T00:00:00Z",
                }
            }
        )
    )
    monkeypatch.setenv("AUTH_MEMBER_BACKFILL", str(evidence))
    command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT * FROM apps").fetchall() == original
        assert db.execute(
            "SELECT id,login_id,password_hash,login_id_key FROM members"
        ).fetchone() == (member_id, "Teacher", password_hash, "teacher")
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        db.execute("PRAGMA foreign_keys=ON")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE apps SET owner_id='missing'")


@pytest.mark.parametrize(
    "login, history, hash_value",
    [
        ("teacher", None, None),
        (
            "not allowed!",
            {
                "created_at": "2026-08-01T00:00:00Z",
                "updated_at": "2026-08-02T00:00:00Z",
                "first_approved_at": "2026-08-02T00:00:00Z",
            },
            None,
        ),
        (
            "teacher",
            {
                "created_at": "2026-08-01T00:00:00Z",
                "updated_at": "2026-08-02T00:00:00Z",
            },
            None,
        ),
        (
            "teacher",
            {
                "created_at": "2026-08-01T00:00:00Z",
                "updated_at": "2026-08-02T00:00:00Z",
                "first_approved_at": "2026-08-02T00:00:00Z",
            },
            "unknown-hash",
        ),
    ],
)
def test_unverified_legacy_values_stop_transactionally_without_fabrication(
    tmp_path, monkeypatch, login, history, hash_value
):
    member_id = "00000000-0000-4000-8000-000000000115"
    path, config = legacy_database(
        tmp_path, monkeypatch, [(member_id, login, "별명", hash_value, "approved")]
    )
    if history:
        evidence = tmp_path / "history.json"
        evidence.write_text(json.dumps({member_id: history}))
        monkeypatch.setenv("AUTH_MEMBER_BACKFILL", str(evidence))
    with pytest.raises(RuntimeError):
        command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert (
            db.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0002_public_apps"
        )
        assert "login_id_key" not in {
            row[1] for row in db.execute("PRAGMA table_info(members)")
        }
        assert (
            db.execute("SELECT password_hash FROM members").fetchone()[0] == hash_value
        )


def test_normalized_collision_stops_without_merging_members(tmp_path, monkeypatch):
    ids = [
        "00000000-0000-4000-8000-000000000115",
        "00000000-0000-4000-8000-000000000116",
    ]
    path, config = legacy_database(
        tmp_path,
        monkeypatch,
        [
            (ids[0], "Teacher", "별명", None, "pending"),
            (ids[1], "teacher", "같은 별명", None, "pending"),
        ],
    )
    evidence = tmp_path / "history.json"
    evidence.write_text(
        json.dumps(
            {
                id_: {
                    "created_at": "2026-08-01T00:00:00Z",
                    "updated_at": "2026-08-01T00:00:00Z",
                    "first_approved_at": None,
                }
                for id_ in ids
            }
        )
    )
    monkeypatch.setenv("AUTH_MEMBER_BACKFILL", str(evidence))
    with pytest.raises(RuntimeError, match="login ID correction"):
        command.upgrade(config, "head")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM members").fetchone()[0] == 2
        assert (
            db.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            == "0002_public_apps"
        )
