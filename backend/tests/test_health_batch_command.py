"""Scheduled health-batch admission: requester-free batches behind worker gates."""

import json
import sqlite3
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError

from app import health_store
from app.database import make_session_factory
from app.health_runtime import boot_clock
from app.settings import Settings
from tests import test_ops_check
from tests.support import populate_public_and_private_apps
from tests.test_ops_commands import command

ops_storage = test_ops_check.ops_storage


@pytest.fixture
def batch_settings(ops_storage, monkeypatch):
    database, _ = ops_storage
    populate_public_and_private_apps(database, public_count=3)
    for key, value in {
        "APP_ENV": "test",
        "DATABASE_PATH": str(database),
        "PUBLIC_ORIGIN": "http://localhost:5174",
        "HEALTH_CHECKS_ENABLED": "false",
    }.items():
        monkeypatch.setenv(key, value)
    return database, Settings.from_environment()


def ready_worker(database):
    engine = create_engine(f"sqlite:///{database}")
    try:
        with make_session_factory(engine)() as db:
            boot_id, mono = boot_clock()
            health_store.heartbeat(
                db,
                worker_id="w1",
                boot_id=boot_id,
                mono=mono,
                stamp=datetime.now(UTC),
            )
            db.commit()
    finally:
        engine.dispose()


def rows(database, sql):
    with sqlite3.connect(database) as db:
        return db.execute(sql).fetchall()


def run(settings, capsys, **keywords):
    from app.operational_commands import health_batch

    status = health_batch(settings, **keywords)
    return status, json.loads(capsys.readouterr().out)


def test_health_batch_creates_batch_without_requester(batch_settings, capsys):
    database, settings = batch_settings
    ready_worker(database)
    status, body = run(settings, capsys, enabled=True)
    apps = rows(database, "SELECT count(*) FROM apps")[0][0]
    assert status == 0
    assert body["outcome"] == "created" and body["target_count"] == apps
    assert rows(database, "SELECT requested_by FROM health_batches") == [(None,)]
    assert rows(database, "SELECT count(*) FROM health_batch_items") == [(apps,)]
    engine = create_engine(f"sqlite:///{database}")
    try:
        with make_session_factory(engine)() as db:
            view = health_store.batch_view(db, body["batch_id"], datetime.now(UTC))
    finally:
        engine.dispose()
    assert view["id"] == body["batch_id"]


def test_health_batch_reuses_active_batch(batch_settings, capsys):
    database, settings = batch_settings
    ready_worker(database)
    _, first = run(settings, capsys, enabled=True)
    status, body = run(settings, capsys, enabled=True)
    assert status == 0
    assert body == {
        "outcome": "skipped",
        "reason": "active_reused",
        "batch_id": first["batch_id"],
    }
    assert rows(database, "SELECT count(*) FROM health_batches") == [(1,)]


def test_health_batch_skips_during_cooldown(batch_settings, capsys):
    database, settings = batch_settings
    ready_worker(database)
    run(settings, capsys, enabled=True)
    with sqlite3.connect(database) as db:
        db.execute("UPDATE health_batches SET finished_at=created_at")
    status, body = run(settings, capsys, enabled=True)
    assert status == 0
    assert body["outcome"] == "skipped" and body["reason"] == "batch_cooldown"
    assert body["retry_at"].endswith("Z")
    assert rows(database, "SELECT count(*) FROM health_batches") == [(1,)]


def test_health_batch_exits_zero_when_disabled(ops_storage):
    database, _ = ops_storage
    result = command(database, "health-batch")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"outcome": "skipped", "reason": "disabled"}
    assert rows(database, "SELECT count(*) FROM health_batches") == [(0,)]


def test_health_batch_fails_without_ready_worker(batch_settings, capsys):
    database, settings = batch_settings
    status, body = run(settings, capsys, enabled=True)
    assert status == 1
    assert body == {"outcome": "unavailable", "reason": "worker_unavailable"}
    assert rows(database, "SELECT count(*) FROM health_batches") == [(0,)]


@pytest.mark.parametrize(
    "marker,reason,event",
    [
        (".restore-blocked", "restore_blocked", "RESTORE_MAINTENANCE_REQUIRED"),
        (".migration-blocked", "migration_blocked", "MIGRATION_MAINTENANCE_REQUIRED"),
    ],
)
def test_health_batch_refuses_maintenance_markers(ops_storage, marker, reason, event):
    database, _ = ops_storage
    (database.parent / marker).write_text("")
    result = command(database, "health-batch")
    assert result.returncode == 1
    assert json.loads(result.stdout) == {"outcome": "unavailable", "reason": reason}
    events = [json.loads(line)["code"] for line in result.stderr.splitlines()]
    assert event in events
    assert rows(database, "SELECT count(*) FROM health_batches") == [(0,)]


def test_health_batch_injection_is_test_only(batch_settings):
    from app.operational_commands import health_batch

    _, settings = batch_settings
    with pytest.raises(ValueError):
        health_batch(
            settings.model_copy(update={"app_env": "production"}), enabled=True
        )


def test_health_batch_rolls_back_partial_insert(batch_settings, capsys):
    database, settings = batch_settings
    ready_worker(database)
    # Fires only once an item exists, so the batch, first job and first item
    # are already inserted when the second item aborts.
    with sqlite3.connect(database) as db:
        db.execute(
            """CREATE TRIGGER fail_second_item BEFORE INSERT ON health_batch_items
            WHEN (SELECT count(*) FROM health_batch_items) >= 1
            BEGIN SELECT RAISE(ABORT, 'second item blocked'); END"""
        )
    assert rows(database, "SELECT count(*) FROM apps")[0][0] >= 2
    with pytest.raises(IntegrityError, match="second item blocked"):
        run(settings, capsys, enabled=True)
    for table in ("health_batches", "health_batch_items", "health_jobs"):
        assert rows(database, f"SELECT count(*) FROM {table}") == [(0,)]
