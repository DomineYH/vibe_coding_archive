"""Retention policy and the operator CLI keep independent expiry clocks."""

import subprocess
import sys

from fastapi.testclient import TestClient

from tests import test_backup
from tests.test_backup import BACKEND, environment

backup_case = test_backup.backup_case


def test_purge_cli_reports_unclassified_records_as_blocked(make_test_app, tmp_path):
    database = tmp_path / "database.sqlite3"
    with TestClient(make_test_app(database)):
        pass
    output = tmp_path / "backups"
    output.mkdir(mode=0o700)
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "purge-expired", "--backup-dir", str(output)],
        cwd=BACKEND,
        env=environment((database, output, None)),
        capture_output=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 3, "purge must report unresolved audit/ledger retention"
    assert b"AUDIT_CLASSIFICATION_BLOCKED" in result.stdout
    assert b"LEDGER_INVENTORY_BLOCKED" in result.stdout


def test_retention_classes_have_separate_fixed_boundaries():
    from datetime import UTC, datetime, timedelta

    from app.retention import audit_eligible, ledger_eligible, request_log_eligible

    created = datetime(2024, 2, 29, tzinfo=UTC)
    tick = timedelta(microseconds=1)
    for eligible, deadline in (
        (
            lambda now: request_log_eligible(created, now),
            datetime(2024, 3, 7, tzinfo=UTC),
        ),
        (
            lambda now: audit_eligible(created, now, classification="ordinary"),
            datetime(2024, 5, 29, tzinfo=UTC),
        ),
        (
            lambda now: audit_eligible(created, now, classification="legal_access"),
            datetime(2025, 2, 28, tzinfo=UTC),
        ),
        (
            lambda now: ledger_eligible((created, created + timedelta(days=30)), now),
            datetime(2024, 4, 6, tzinfo=UTC),
        ),
    ):
        assert eligible(deadline - tick) is False
        assert eligible(deadline) is True
        assert eligible(deadline + tick) is True
    assert (
        audit_eligible(created, datetime(2030, 1, 1, tzinfo=UTC), classification=None)
        is False
    )
    assert ledger_eligible(None, datetime(2030, 1, 1, tzinfo=UTC)) is False


def test_backup_cleanup_uses_original_expiry_without_refresh(backup_case, monkeypatch):
    import json
    import os
    import sqlite3
    from contextlib import closing
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    from app import backup
    from app.backup_retention import purge_backups
    from tests.test_backup import rows, run_backup, unpack

    created = datetime(2026, 10, 8, tzinfo=UTC)
    fixed = "2026-10-08T00:00:00.000000Z"
    monkeypatch.setattr(backup, "_stamp", lambda: fixed)
    settings = backup.Settings.from_environment(environment(backup_case))
    run_id = str(uuid4())
    backup.backup_database(
        settings,
        output_dir=backup_case[1],
        recipient_file=backup_case[2],
        release_id="retention-clock",
        run_id=run_id,
    )
    final = backup_case[1] / run_id
    original = (final / "manifest.json").read_bytes()
    manifest, metadata, dump = unpack(backup_case, run_id)
    # A logical restore preserves original row lifetimes, separately from encrypted restore CI.
    with (
        closing(sqlite3.connect(backup_case[0])) as source,
        closing(sqlite3.connect(":memory:")) as restored,
    ):
        restored.executescript(dump.decode())
        unchanged = rows(source) == rows(restored)
        assert unchanged, "logical round trip changed original row timestamps"
    assert run_backup(backup_case, run_id).returncode == 1
    assert (final / "manifest.json").read_bytes() == original
    for item in final.iterdir():
        os.utime(item, (0, 0))
    deadline = created + timedelta(days=29)
    assert (
        purge_backups(
            settings,
            backup_dir=backup_case[1],
            now=deadline - timedelta(microseconds=1),
        )
        == 0
    )
    assert json.loads(original)["original_expires_at"] == "2026-11-07T00:00:00.000000Z"
    assert (final / "manifest.json").read_bytes() == original
    backup.validate_manifest_structure(
        manifest, metadata=metadata, now=created + timedelta(days=31)
    )
    import pytest

    with pytest.raises(ValueError):
        backup.validate_manifest(manifest, now=created + timedelta(days=30))
    assert purge_backups(settings, backup_dir=backup_case[1], now=deadline) == 1
    assert not final.exists()
    assert (
        purge_backups(
            settings, backup_dir=backup_case[1], now=deadline + timedelta(days=2)
        )
        == 0
    )


import fcntl
import json
import os
import sqlite3
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app import backup
from tests.test_backup import run_backup


def artifact(case, run_id=None):
    run_id = run_id or str(uuid4())
    assert run_backup(case, run_id).returncode == 3
    final = case[1] / run_id
    manifest = json.loads((final / "manifest.json").read_bytes())
    now = datetime.fromisoformat(manifest["original_expires_at"]) - timedelta(days=1)
    settings = backup.Settings.from_environment(environment(case))
    return final, manifest, now, settings


@pytest.mark.parametrize("days_after_creation", [29, 30, 31])
def test_copied_backup_keeps_original_expiry(
    backup_case, days_after_creation, tmp_path
):
    import shutil

    from app.backup_retention import purge_backups

    final, manifest, _, settings = artifact(backup_case)
    copied = tmp_path / "copied-backups"
    copied.mkdir(mode=0o700)
    shutil.copytree(final, copied / final.name)
    now = datetime.fromisoformat(manifest["created_at"]) + timedelta(
        days=days_after_creation
    )
    assert purge_backups(settings, backup_dir=copied, now=now) == 1
    assert final.exists()
    assert json.loads((final / "manifest.json").read_bytes()) == manifest


@pytest.mark.parametrize(
    "fault",
    [
        "missing_manifest",
        "extra_file",
        "bad_json",
        "bad_ciphertext",
        "file_symlink",
        "file_hardlink",
        "directory_symlink",
        "mode",
        "future_clock",
    ],
)
def test_backup_cleanup_fails_closed_on_unowned_or_invalid_pairs(backup_case, fault):
    from app.backup_retention import BackupPurgeError, purge_backups

    final, manifest, now, settings = artifact(backup_case)
    if fault == "missing_manifest":
        (final / "manifest.json").unlink()
    elif fault == "extra_file":
        (final / "unexpected").write_text("owned test data")
    elif fault == "bad_json":
        (final / "manifest.json").write_bytes(b"{")
    elif fault == "bad_ciphertext":
        (final / "backup.tar.age").write_bytes(b"corrupt")
    elif fault in ("file_symlink", "file_hardlink"):
        source = final / "manifest.json"
        target = final.parent.parent / "original-manifest"
        source.rename(target)
        if fault == "file_symlink":
            source.symlink_to(target)
        else:
            os.link(target, source)
    elif fault == "directory_symlink":
        saved = final.parent.parent / "saved-pair"
        final.rename(saved)
        final.symlink_to(saved, target_is_directory=True)
    elif fault == "mode":
        (final / "manifest.json").chmod(0o644)
    elif fault == "future_clock":
        now = datetime.fromisoformat(manifest["created_at"]) - timedelta(seconds=1)
    before = sorted(item.name for item in final.iterdir())
    with pytest.raises(BackupPurgeError):
        purge_backups(settings, backup_dir=backup_case[1], now=now)
    assert sorted(item.name for item in final.iterdir()) == before
    assert final.exists()


def test_cleanup_shares_the_persistent_backup_lock(backup_case):
    from app.backup_retention import purge_backups

    final, _, now, settings = artifact(backup_case)
    lock = backup_case[1] / ".backup.lock"
    inode = lock.stat().st_ino
    with lock.open("rb") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(BlockingIOError):
            purge_backups(settings, backup_dir=backup_case[1], now=now)
    assert final.exists()
    assert lock.stat().st_ino == inode
    assert purge_backups(settings, backup_dir=backup_case[1], now=now) == 1
    assert lock.stat().st_ino == inode


@pytest.mark.parametrize("operation", ["unlink", "fsync"])
def test_interrupted_pair_cleanup_retries_without_refreshing_clocks(
    backup_case, monkeypatch, operation
):
    from app.backup_retention import BackupPurgeError, purge_backups

    final, manifest, now, settings = artifact(backup_case)
    original = (final / "manifest.json").read_bytes()
    actual = getattr(os, operation)
    calls = 0

    def fail_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == (2 if operation == "unlink" else 1):
            raise OSError("synthetic private filesystem failure")
        return actual(*args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(os, operation, fail_once)
        with pytest.raises(BackupPurgeError):
            purge_backups(settings, backup_dir=backup_case[1], now=now)
    staged = backup_case[1] / (".purge-" + final.name)
    assert (staged / "manifest.json").read_bytes() == original
    assert (
        json.loads(original)["original_expires_at"] == manifest["original_expires_at"]
    )
    assert purge_backups(settings, backup_dir=backup_case[1], now=now) == 1
    assert purge_backups(settings, backup_dir=backup_case[1], now=now) == 0


def test_partial_backup_failure_reports_completed_pairs(backup_case):
    from app.backup_retention import BackupPurgeError, purge_backups

    first, _, now, settings = artifact(
        backup_case, "00000000-0000-4000-8000-000000000001"
    )
    second, _, _, _ = artifact(backup_case, "00000000-0000-4000-8000-000000000002")
    now += timedelta(days=1)
    (second / "manifest.json").write_bytes(b"{")
    with pytest.raises(BackupPurgeError) as failure:
        purge_backups(settings, backup_dir=backup_case[1], now=now)
    assert failure.value.removed == 1
    assert not first.exists()
    assert second.exists()


def test_purge_composes_auth_pending_and_health_without_deleting_audit_or_ledger(
    member_app, tmp_path
):
    from sqlalchemy import text

    from app import health_store
    from app.database import make_engine, make_session_factory
    from tests.auth_client import Browser
    from tests.support import AUTH_MEMBERS

    app, database = member_app()
    backups = tmp_path / "backups"
    backups.mkdir(mode=0o700)
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        flow = browser.flow
    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE members SET created_at='2000-01-01T00:00:00.000000Z' WHERE id=?",
            (AUTH_MEMBERS["pending"][0],),
        )
        db.execute("UPDATE auth_flows SET expires_at='2000-01-01T00:00:00.000000Z'")
        db.execute("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000000Z'")
        db.execute(
            "UPDATE rate_limit_events SET expires_at='2000-01-01T00:00:00.000000Z'"
        )
        db.execute(
            "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES('unknown',NULL,NULL,'2000-01-01T00:00:00.000000Z','succeeded')"
        )
        audit_before = db.execute("SELECT * FROM audit_logs").fetchall()
    from tests.support import populate_public_and_private_apps

    populate_public_and_private_apps(database)
    engine = make_engine(database)
    try:
        with make_session_factory(engine)() as db:
            app_id = db.execute(
                text("SELECT id FROM apps LIMIT 1")
            ).scalar_one_or_none()
            health_store.request_check(
                db, app_id, "synthetic", None, datetime(2000, 1, 1, tzinfo=UTC)
            )
            db.execute(
                text(
                    "UPDATE health_jobs SET status='completed',finished_at='2000-01-01T00:00:00.000000Z'"
                )
            )
            db.commit()
    finally:
        engine.dispose()
    args = [
        sys.executable,
        "-m",
        "app.cli",
        "purge-expired",
        "--backup-dir",
        str(backups),
    ]
    result = subprocess.run(
        args,
        cwd=BACKEND,
        env=environment((database, backups, None)),
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 3
    report = json.loads(result.stdout)
    assert report["counts"]["members_removed"] == 1
    assert report["counts"]["health_jobs_removed"] == 1
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT * FROM audit_logs").fetchall() == audit_before
        assert db.execute("SELECT count(*) FROM sessions").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM rate_limit_events").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM auth_retired_flow_ids").fetchone() == (
            1,
        )
        assert db.execute(
            "SELECT id FROM members WHERE id=?", (AUTH_MEMBERS["approved"][0],)
        ).fetchone()
        assert db.execute("SELECT count(*) FROM health_jobs").fetchone() == (0,)
    ledger_path = database.with_suffix(".deletions.sqlite3")
    with sqlite3.connect(ledger_path) as ledger:
        before = list(ledger.iterdump())
    again = subprocess.run(
        args,
        cwd=BACKEND,
        env=environment((database, backups, None)),
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert again.returncode == 3
    with sqlite3.connect(ledger_path) as ledger:
        preserved = before == list(ledger.iterdump())
        assert preserved, (
            "unverified copy inventory must preserve all independent deletion evidence"
        )
    # Public readiness still reconciles the surviving replay fences.
    with TestClient(app) as client:
        assert client.get("/readyz").status_code == 200
        denied = client.get(
            "/api/v1/auth/flow-state", headers={"X-EduVibe-Flow-Id": flow}
        )
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "RECOVERY_REQUIRED"


def test_request_log_host_templates_use_seven_day_retention():
    from configparser import ConfigParser
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    journal = ConfigParser()
    journal.read(root / "deploy/journald/journald-eduvibe.conf")
    assert journal["Journal"]["MaxRetentionSec"] == "7day"
    assert journal["Journal"]["MaxFileSec"] == "1day"
    assert journal["Journal"]["Storage"] == "persistent"
    rotate = (root / "deploy/logrotate/eduvibe-nginx").read_text()
    body = rotate.split("{", 1)[1].rsplit("}", 1)[0]
    directives = [line.split() for line in body.splitlines()]
    assert ["daily"] in directives
    assert ["maxage", "7"] in directives
    assert ["rotate", "7"] in directives
    assert ["ifempty"] in directives
    assert ["copytruncate"] not in directives
    assert ["create", "0600"] in directives
    assert "--signal=USR1" in rotate


def test_invalid_backup_root_does_not_mutate_local_records(member_app):
    app, database = member_app()
    with TestClient(app):
        pass
    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE members SET created_at='2000-01-01T00:00:00.000000Z' WHERE approval_status='pending'"
        )
        before = list(db.iterdump())
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "app.cli",
            "purge-expired",
            "--backup-dir",
            "relative-root",
        ],
        cwd=BACKEND,
        env=environment((database, None, None)),
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 2
    with sqlite3.connect(database) as db:
        unchanged = before == list(db.iterdump())
        assert unchanged, "unsafe backup root must be rejected before maintenance"


def test_purge_reports_partial_backup_progress(backup_case, monkeypatch, capsys):
    from app.retention import purge_expired

    first, _, now, settings = artifact(
        backup_case, "00000000-0000-4000-8000-000000000001"
    )
    second, _, _, _ = artifact(backup_case, "00000000-0000-4000-8000-000000000002")
    (second / "manifest.json").write_bytes(b"{")
    fixed = now + timedelta(days=1)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr("app.backup_retention.datetime", Clock)
    assert purge_expired(settings, backup_dir=backup_case[1]) == 1
    output = json.loads(capsys.readouterr().out)
    assert output["counts"]["backups_removed"] == 1
    assert output["codes"][0] == "PURGE_FAILED"
    assert not first.exists()
    assert second.exists()


def test_production_configuration_failure_is_usage_without_mutation(
    member_app, tmp_path, capsys
):
    from app.retention import purge_expired

    _, database = member_app()
    settings = backup.Settings.from_environment(environment((database, None, None)))
    invalid = settings.model_copy(update={"app_env": "production"})
    before = database.read_bytes()
    assert purge_expired(invalid, backup_dir=tmp_path / "missing") == 2
    output = json.loads(capsys.readouterr().out)
    assert output["codes"][0] == "PURGE_USAGE_INVALID"
    assert output["counts"] == {}
    unchanged = before == database.read_bytes()
    assert unchanged, "invalid production configuration must fail before maintenance"
