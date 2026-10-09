"""Observational CLI over quiescent synthetic storage, never application startup."""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def ops_storage(tmp_path, tmp_path_factory, migrate_test_database):
    template = tmp_path_factory.getbasetemp() / "ops-template.sqlite3"
    if not template.exists():
        migrate_test_database(template)
    database = tmp_path / "ops.sqlite3"
    shutil.copyfile(template, database)
    database.chmod(0o600)
    backups = tmp_path / "backups"
    backups.mkdir(mode=0o700)
    return database, backups


def cli(database, backups, *args):
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "app.cli",
            "ops-check",
            "--backup-dir",
            str(backups),
            *args,
        ],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "HEALTH_CHECKS_ENABLED": "false",
        },
        capture_output=True,
        timeout=20,
        check=False,
    )


def digest(database):
    with sqlite3.connect(database) as db:
        logical = list(db.iterdump())
    files = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in database.parent.glob("*.sqlite3*")
        if not p.name.endswith("-shm")
    }
    return logical, files


def test_ops_check_reports_observations_without_changing_business_database(ops_storage):
    database, backups = ops_storage
    with sqlite3.connect(database) as db:
        db.execute(
            "INSERT INTO auth_flows(id,revision,issued_seq,recovery_ready,ever_ready,last_identity_change_revision,created_at,last_activity_at,expires_at) VALUES ('synthetic-expired','1','1',0,0,'1','2000-01-01T00:00:00Z','2000-01-01T00:00:00Z','2000-01-01T00:01:00Z')"
        )
    from tests.support import AUTH_MEMBERS, populate_auth_members

    populate_auth_members(database)
    with sqlite3.connect(database) as db:
        db.execute(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,state,created_at,expires_at,reset_key_id,reset_request_hmac) VALUES ('synthetic-reset',?,'user_password_reset',?,1,'unresolved','2000-01-01T00:00:00Z','2000-01-02T00:00:00Z',?,?)",
            (AUTH_MEMBERS["admin"][0], AUTH_MEMBERS["approved"][0], "0" * 64, "1" * 64),
        )
    before = digest(database)
    result = cli(database, backups)
    assert result.returncode == 3, "ops-check must report unresolved observations"
    output = json.loads(result.stdout)
    assert output["checks"]["alarm"] == "UNCONFIRMED"
    assert output["checks"]["ledger"] == "UNCONFIRMED"
    assert digest(database) == before
    from app import app_deletion_ledger, user_deletion_ledger
    from app.backup import LEDGER_SCHEMA

    ledger = database.with_suffix(".deletions.sqlite3")
    with sqlite3.connect(ledger) as db:
        for table, columns in LEDGER_SCHEMA.items():
            db.execute(f"CREATE TABLE {table}({columns})")
        db.execute(app_deletion_ledger.SCHEMA)
        db.execute(user_deletion_ledger.SCHEMA)
        for ddl in user_deletion_ledger.INDEXES:
            db.execute(ddl)
    ledger.chmod(0o600)
    before = digest(database)
    result = cli(database, backups)
    assert result.returncode == 3
    assert json.loads(result.stdout)["checks"]["ledger"] == "LOCAL_ONLY"
    assert digest(database) == before


def test_ops_check_external_evidence_never_defaults_healthy(ops_storage):
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    from app.operations import ops_check
    from app.settings import Settings

    database, backups = ops_storage
    settings = Settings(
        app_env="test", database_path=database, public_origin="http://localhost:5174"
    )
    observations = database.parent / "observations.json"
    stamp = datetime.now(UTC)
    base = {"version": 1, "checked_at": stamp.isoformat(), "evidence_id": str(uuid4())}

    def check(value):
        observations.write_text(json.dumps(value))
        observations.chmod(0o600)
        return ops_check(settings, backup_dir=backups, observations_file=observations)[
            0
        ]["checks"]

    for value in (
        {},
        {**base, "unknown": 1},
        {**base, "version": True},
        {**base, "cost_month": True},
        {**base, "prepaid_spent": -1},
        {**base, "checked_at": (stamp - timedelta(minutes=16)).isoformat()},
        {**base, "checked_at": (stamp + timedelta(minutes=1)).isoformat()},
    ):
        answer = check(value)
        assert all(
            answer[k] == "UNCONFIRMED"
            for k in ("db_busy", "alarm", "cost", "prepaid", "contract")
        )
    assert check(base)["alarm"] == "UNCONFIRMED"
    assert check({**base, "alarm_delivery": "FAILED"})["alarm"] == "FAILURE"
    assert check({**base, "alarm_delivery": "CONFIRMED"})["alarm"] == "OBSERVED"
    for cost, code in (
        (39999, "OBSERVED"),
        (40000, "WARN"),
        (44999, "WARN"),
        (45000, "RESTRICT"),
        (50000, "CAP_REACHED"),
    ):
        assert check({**base, "cost_month": cost})["cost"] == code
    for spent, code in ((99999, "OBSERVED"), (100000, "CAP_REACHED")):
        assert check({**base, "prepaid_spent": spent})["prepaid"] == code
    for days, code in (
        (31, "OBSERVED"),
        (30, "WARN"),
        (8, "WARN"),
        (7, "RESTRICT"),
        (0, "RESTRICT"),
    ):
        assert (
            check(
                {
                    **base,
                    "contract_expires_at": (stamp + timedelta(days=days)).isoformat(),
                }
            )["contract"]
            == code
        )
    for raw in (b"not JSON", b"[" * 10000 + b"]" * 10000):
        observations.write_bytes(raw)
        answer = ops_check(
            settings, backup_dir=backups, observations_file=observations
        )[0]["checks"]
        assert all(
            answer[k] == "UNCONFIRMED"
            for k in ("db_busy", "alarm", "cost", "prepaid", "contract")
        )


def test_ops_check_connection_rejects_writes_and_missing_database(ops_storage):
    from app.operations import read_only

    database, _ = ops_storage
    # Keep the writer open so a real uncheckpointed WAL row is visible.
    with sqlite3.connect(database) as writer:
        writer.execute("CREATE TABLE wal_control(value TEXT)")
        writer.execute("INSERT INTO wal_control VALUES ('committed-WAL')")
        writer.commit()
        with read_only(database, test=True) as reader:
            assert reader.execute("SELECT value FROM wal_control").fetchall() == [
                ("committed-WAL",)
            ]
            for sql in (
                "INSERT INTO wal_control VALUES ('bad')",
                "CREATE TABLE bad(x)",
                "ATTACH ':memory:' AS other",
                "PRAGMA query_only=OFF",
                "PRAGMA journal_mode=DELETE",
            ):
                with pytest.raises(sqlite3.DatabaseError):
                    reader.execute(sql)
    missing = database.with_name("missing.sqlite3")
    with pytest.raises(OSError), read_only(missing, test=True):
        pass
    assert not missing.exists()
    unsafe = database.with_name("unsafe.sqlite3")
    shutil.copyfile(database, unsafe)
    unsafe.chmod(0o600)
    sentinel = database.parent / "sentinel"
    sentinel.write_bytes(b"private sentinel")
    sentinel.chmod(0o600)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(unsafe) + suffix)
        sidecar.symlink_to(sentinel)
        with pytest.raises((OSError, ValueError)), read_only(unsafe, test=True):
            pass
        assert sentinel.read_bytes() == b"private sentinel"
        sidecar.unlink()


def settings_for(database):
    from app.settings import Settings

    return Settings(
        app_env="test", database_path=database, public_origin="http://localhost:5174"
    )


def test_ops_check_locked_database_is_db_busy_without_mutation(ops_storage):
    from datetime import UTC, datetime
    from uuid import uuid4

    from app.operations import ops_check

    database, backups = ops_storage
    settings = settings_for(database)
    with sqlite3.connect(database) as writer:
        writer.execute("BEGIN IMMEDIATE")
        assert ops_check(settings, backup_dir=backups)[0]["checks"]["database"] == "OK"
        writer.rollback()
        writer.execute("PRAGMA journal_mode=DELETE")
        writer.execute("BEGIN EXCLUSIVE")
        output, status = ops_check(settings, backup_dir=backups)
        assert status == 3 and output["checks"]["database"] == "DB_BUSY"
    path = database.parent / "obs.json"
    for count, code in ((4, "OBSERVED"), (5, "RESTRICT"), (6, "RESTRICT")):
        path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "checked_at": datetime.now(UTC).isoformat(),
                    "evidence_id": str(uuid4()),
                    "db_busy_5min": count,
                }
            )
        )
        path.chmod(0o600)
        assert (
            ops_check(settings, backup_dir=backups, observations_file=path)[0][
                "checks"
            ]["db_busy"]
            == code
        )
    assert (
        ops_check(settings, backup_dir=backups)[0]["checks"]["db_busy"] == "UNCONFIRMED"
    )


def test_ops_check_worker_and_queue_boundaries(ops_storage, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from app.operations import ops_check
    from tests.support import populate_public_and_private_apps

    database, backups = ops_storage
    populate_public_and_private_apps(database, public_count=3)
    settings = settings_for(database)
    instant = datetime(2026, 10, 9, tzinfo=UTC)
    monkeypatch.setattr("app.operations.boot_clock", lambda: ("test-boot", 100.0))
    with sqlite3.connect(database) as db:
        db.execute(
            "INSERT INTO health_worker(singleton,worker_id,boot_id,heartbeat_mono,heartbeat_at,ready) VALUES (1,'worker','test-boot',100,?,1)",
            (instant.isoformat(),),
        )
        db.execute(
            "INSERT INTO health_jobs(id,app_id,url_version,status,individual,created_at) VALUES ('synthetic-job','00000000-0000-4000-8000-000000000001',1,'queued',1,?)",
            ((instant - timedelta(minutes=5)).isoformat(),),
        )
    before = digest(database)
    output, _ = ops_check(settings, backup_dir=backups, instant=instant)
    assert output["checks"]["worker"] == "OK"
    assert output["checks"]["queue"] == "RESTRICT"
    assert output["counts"]["executable_queue"] == 1
    assert digest(database) == before
    with sqlite3.connect(database) as db:
        for mono, boot, ready, code in (
            (85.001, "test-boot", 1, "OK"),
            (85, "test-boot", 1, "RESTRICT"),
            (84.999, "test-boot", 1, "RESTRICT"),
            (100, "other", 1, "RESTRICT"),
            (100, "test-boot", 0, "RESTRICT"),
        ):
            db.execute(
                "UPDATE health_worker SET heartbeat_mono=?,boot_id=?,ready=?",
                (mono, boot, ready),
            )
            db.commit()
            assert (
                ops_check(settings, backup_dir=backups, instant=instant)[0]["checks"][
                    "worker"
                ]
                == code
            )
        db.execute(
            "INSERT INTO health_cooldowns(app_id,started_at,next_check_at) VALUES ('00000000-0000-4000-8000-000000000001',?,?)",
            (instant.isoformat(), (instant + timedelta(seconds=60)).isoformat()),
        )
        db.commit()
        assert (
            ops_check(settings, backup_dir=backups, instant=instant)[0]["counts"][
                "executable_queue"
            ]
            == 0
        )
        db.execute("DELETE FROM health_cooldowns")
        for status in ("cancelled", "completed"):
            db.execute(
                "UPDATE health_jobs SET status=?,finished_at='2026-10-09T00:00:00Z'",
                (status,),
            )
            db.commit()
            assert (
                ops_check(settings, backup_dir=backups, instant=instant)[0]["counts"][
                    "executable_queue"
                ]
                == 0
            )
        db.execute(
            "UPDATE health_jobs SET status='queued',finished_at=NULL,created_at='2000-01-01T00:00:00Z'"
        )
        db.execute("DELETE FROM health_worker")
        db.commit()
    output, _ = ops_check(settings, backup_dir=backups, instant=instant)
    assert output["checks"]["worker"] == "UNCONFIRMED"
    assert output["counts"]["executable_queue"] == 0


def test_ops_check_disk_thresholds_and_required_headroom(ops_storage, monkeypatch):
    from types import SimpleNamespace

    from app.operations import ops_check

    database, backups = ops_storage
    for free, code in (
        (21, "OK"),
        (20, "WARN"),
        (11, "WARN"),
        (10, "RESTRICT"),
        (9, "RESTRICT"),
    ):
        monkeypatch.setattr(
            os,
            "statvfs",
            lambda _, free=free: SimpleNamespace(
                f_blocks=100, f_bavail=free, f_frsize=1
            ),
        )
        output, _ = ops_check(
            settings_for(database), backup_dir=backups, required_free_bytes=free
        )
        assert output["checks"]["disk"] == code
        assert output["checks"]["headroom"] == "OK"
        assert (
            ops_check(
                settings_for(database), backup_dir=backups, required_free_bytes=free + 1
            )[0]["checks"]["headroom"]
            == "RESTRICT"
        )
    assert (
        ops_check(settings_for(database), backup_dir=backups)[0]["checks"]["headroom"]
        == "UNCONFIRMED"
    )


def test_ops_check_backup_rpo_expiry_and_remote_unknown(ops_storage):
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    from app.backup import TABLES
    from app.operations import ops_check

    database, backups = ops_storage
    instant = datetime(2026, 10, 9, tzinfo=UTC)
    created = instant - timedelta(hours=24)
    run = str(uuid4())
    pair = backups / run
    pair.mkdir(mode=0o700)
    ciphertext = pair / "backup.tar.age"
    ciphertext.write_bytes(b"synthetic-ciphertext-not-a-restorable-backup")
    ciphertext.chmod(0o600)
    digest_ = {
        "sha256": hashlib.sha256(ciphertext.read_bytes()).hexdigest(),
        "bytes": ciphertext.stat().st_size,
    }
    manifest = {
        "format_version": 1,
        "payload_format": "sqlite-sql-dump-v1",
        "run_id": run,
        "created_at": created.isoformat(),
        "recovery_point_at": created.isoformat(),
        "snapshot_completed_at": created.isoformat(),
        "original_expires_at": (created + timedelta(days=30)).isoformat(),
        "release_id": "synthetic",
        "revision": "0012_health_checks",
        "age_version": "1.0.0",
        "recipient_file_sha256": "0" * 64,
        "included": ["main_database"],
        "database": digest_,
        "ciphertext": digest_,
        "local_complete": True,
        "remote_confirmed": False,
        "ledger_checkpoint": {
            "schema_version": 1,
            "observed_at": created.isoformat(),
            "status": "LOCAL_REFERENCE_ONLY",
            "tables": {t: {"rows": 0, "sha256": "0" * 64} for t in TABLES},
        },
    }
    path = pair / "manifest.json"
    path.write_text(json.dumps(manifest))
    path.chmod(0o600)
    original = path.read_bytes()

    def check(now=instant):
        return ops_check(settings_for(database), backup_dir=backups, instant=now)[0][
            "checks"
        ]

    assert check()["backup"] == "LOCAL_ONLY"
    assert check()["remote"] == "UNCONFIRMED"
    assert check()["rpo"] == "OK"
    assert check(instant + timedelta(microseconds=1))["rpo"] == "RESTRICT"
    copied = database.parent / "copied-backups"
    copied.mkdir(mode=0o700)
    shutil.copytree(pair, copied / run)
    assert (
        ops_check(
            settings_for(database),
            backup_dir=copied,
            instant=instant + timedelta(microseconds=1),
        )[0]["checks"]["rpo"]
        == "RESTRICT"
    )
    os.utime(path, None)
    assert check(created + timedelta(days=29))["retention"] == "CLEANUP_DUE"
    assert check(created + timedelta(days=30))["retention"] == "EXPIRED"
    assert path.read_bytes() == original
    failed = backups / (".stage-" + str(uuid4()))
    failed.mkdir(mode=0o700)
    assert check()["backup"] == "FAILURE"
    failed.rmdir()
    manifest.pop("original_expires_at")
    path.write_text(json.dumps(manifest))
    assert check()["backup"] == "FAILURE"
    path.write_bytes(original)
    ciphertext.write_bytes(b"tampered")
    assert check()["backup"] == "FAILURE"


def test_ops_check_cannot_release_remaining_causes(ops_storage, monkeypatch):
    from types import SimpleNamespace

    from app.operations import ops_check

    database, backups = ops_storage
    markers = [
        database.parent / n
        for n in (
            ".migration-blocked",
            ".restore-blocked",
            "health.json.revoked-synthetic",
        )
    ]
    for path in markers:
        path.write_bytes(b"synthetic independent restriction")
        path.chmod(0o600)
    before = {p: p.read_bytes() for p in markers}
    for free in (9, 21):
        monkeypatch.setattr(
            os,
            "statvfs",
            lambda _, free=free: SimpleNamespace(
                f_blocks=100, f_bavail=free, f_frsize=1
            ),
        )
        output, status = ops_check(
            settings_for(database), backup_dir=backups, required_free_bytes=10
        )
        assert status == 3
        assert output["checks"]["cost"] == "UNCONFIRMED"
        assert {p: p.read_bytes() for p in markers} == before
    # Even clearing both measured causes and crossing a month cannot resume services.
    from datetime import UTC, datetime
    from uuid import uuid4

    path = database.parent / "observations.json"
    for instant in (
        datetime(2026, 10, 31, tzinfo=UTC),
        datetime(2026, 11, 1, tzinfo=UTC),
    ):
        path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "checked_at": instant.isoformat(),
                    "evidence_id": str(uuid4()),
                    "cost_month": 0,
                }
            )
        )
        path.chmod(0o600)
        output, status = ops_check(
            settings_for(database),
            backup_dir=backups,
            observations_file=path,
            required_free_bytes=10,
            instant=instant,
        )
        assert output["checks"]["cost"] == "OBSERVED" and status == 3
        assert {p: p.read_bytes() for p in markers} == before


def test_ops_check_safe_output_and_partial_failure(ops_storage, monkeypatch):
    from app.operations import ops_check

    database, backups = ops_storage
    sentinel = "SECRET_HMAC_EMAIL_SQL_BODY_SENTINEL"
    missing = database.parent / (sentinel + ".sqlite3")
    path = database.parent / (sentinel + ".json")
    path.write_text(json.dumps({"evidence_id": sentinel}))
    path.chmod(0o600)
    output, status = ops_check(
        settings_for(missing), backup_dir=backups, observations_file=path
    )
    assert status == 1
    assert output["checks"]["disk"] in ("OK", "WARN", "RESTRICT")
    assert sentinel not in json.dumps(output)
    assert not missing.exists()
    monkeypatch.setattr(
        os, "statvfs", lambda _: (_ for _ in ()).throw(PermissionError(sentinel))
    )
    output, status = ops_check(settings_for(database), backup_dir=backups)
    assert status == 1
    assert output["checks"]["database"] == "OK"
    assert output["checks"]["disk"] == "FAILURE"
    assert sentinel not in json.dumps(output)

    from app.operations import main

    monkeypatch.setattr(
        "app.operations.ops_check",
        lambda *a, **k: (
            {"evidence_id": sentinel, "checks": {"database": sentinel}, "counts": {}},
            3,
        ),
    )
    with pytest.raises(ValueError):
        main(settings_for(database), backup_dir=backups)
