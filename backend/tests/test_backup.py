"""CLI/artifact contract; controlled encryptor proves I/O only, never encryption."""

import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.database import current_head
from tests.support import populate_public_and_private_apps

BACKEND = Path(__file__).resolve().parents[1]
# Public native X25519 recipient; no private identity exists in this fixture.
RECIPIENT = "age1ql3z7hjy54pw3hyx79wxyhl89cl8gwpml7wgcas3l6pk65w4sxaqgdq8gd"


@pytest.fixture
def backup_case(make_test_app, tmp_path, monkeypatch):
    database = tmp_path / "database.sqlite3"
    app = make_test_app(database)
    with TestClient(app):
        pass  # Existing startup provisions the independent ledger in test setup only.
    populate_public_and_private_apps(database)
    database.chmod(0o600)
    output = tmp_path / "backups"
    output.mkdir(mode=0o700)
    recipient = tmp_path / "recipients.txt"
    recipient.write_text(RECIPIENT + "\n")
    recipient.chmod(0o600)
    binary = tmp_path / "age"
    binary.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "if '--version' in sys.argv:\n"
        "    print('v1.2.1')\n"
        "else:\n"
        "    sys.stdout.buffer.write(sys.stdin.buffer.read())\n"
    )
    binary.chmod(0o700)
    monkeypatch.setenv("PATH", f"{tmp_path}:{os.environ['PATH']}")
    return database, output, recipient


def command(case, run_id=None, *extra):
    _database, output, recipient = case
    return [
        sys.executable,
        "-m",
        "app.cli",
        "backup-db",
        "--output-dir",
        str(output),
        "--recipient-file",
        str(recipient),
        "--release-id",
        "test-build.195",
        "--run-id",
        run_id or str(uuid4()),
        *extra,
    ]


def environment(case):
    return {
        **os.environ,
        "APP_ENV": "test",
        "DATABASE_PATH": str(case[0]),
        "PUBLIC_ORIGIN": "http://localhost:5174",
        "HEALTH_CHECKS_ENABLED": "false",
    }


def run_backup(case, run_id=None, *extra):
    return subprocess.run(
        command(case, run_id, *extra),
        env=environment(case),
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )


@pytest.mark.parametrize("age_version", ["v1.2.1", "1.1.1"])
def test_backup_cli_local_only_has_valid_manifest(backup_case, age_version):
    binary = backup_case[0].parent / "age"
    binary.write_text(binary.read_text().replace("v1.2.1", age_version))
    run_id = str(uuid4())
    result = run_backup(backup_case, run_id)
    assert result.returncode == 3, result.stderr
    assert result.stdout.strip() == "LOCAL_ONLY_REMOTE_NOT_CONFIRMED"
    final = backup_case[1] / run_id
    assert sorted(p.name for p in final.iterdir()) == [
        "backup.tar.age",
        "manifest.json",
    ]
    manifest = json.loads((final / "manifest.json").read_bytes())
    ciphertext = (final / "backup.tar.age").read_bytes()
    assert manifest["run_id"] == run_id
    assert manifest["revision"] == current_head()
    assert manifest["age_version"] == age_version
    assert manifest["local_complete"] is True
    assert manifest["remote_confirmed"] is False
    assert manifest["included"] == ["main_database"]
    assert manifest["ciphertext"] == {
        "sha256": hashlib.sha256(ciphertext).hexdigest(),
        "bytes": len(ciphertext),
    }
    assert manifest["ledger_checkpoint"]["status"] == "LOCAL_REFERENCE_ONLY"
    assert len(manifest["ledger_checkpoint"]["tables"]) == 6


def fingerprints(directory):
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()
    }


def unpack(case, run_id, payload=None):
    final = case[1] / run_id
    manifest = json.loads((final / "manifest.json").read_bytes())
    raw = (final / "backup.tar.age").read_bytes() if payload is None else payload
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = archive.getmembers()
        assert [m.name for m in members] == ["database.sql", "metadata.json"]
        assert all(m.isfile() and m.mode == 0o600 for m in members)
        dump = archive.extractfile("database.sql").read()
        metadata = json.loads(archive.extractfile("metadata.json").read())
    assert manifest["database"] == {
        "sha256": hashlib.sha256(dump).hexdigest(),
        "bytes": len(dump),
    }
    return manifest, metadata, dump


def rows(db):
    return {
        name: sorted(
            db.execute('SELECT * FROM "' + name.replace('"', '""') + '"').fetchall(),
            key=repr,
        )
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def test_logical_dump_round_trip_and_schema_premise(backup_case):
    # Protocol-only pass-through; real age encryption is separately required in CI.
    run_id = str(uuid4())
    assert run_backup(backup_case, run_id).returncode == 3
    manifest, metadata, dump = unpack(backup_case, run_id)
    assert manifest["payload_format"] == "sqlite-sql-dump-v1"
    from app.backup import validate_manifest

    validate_manifest(manifest, metadata=metadata)
    with (
        closing(sqlite3.connect(backup_case[0])) as source,
        closing(sqlite3.connect(":memory:")) as restored,
    ):
        assert source.execute("PRAGMA user_version").fetchone() == (0,)
        assert source.execute("PRAGMA application_id").fetchone() == (0,)
        assert (
            source.execute(
                "SELECT 1 FROM sqlite_master WHERE upper(sql) LIKE '%CREATE VIRTUAL TABLE%'"
            ).fetchall()
            == []
        )
        restored.executescript(dump.decode("utf-8"))
        assert restored.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert restored.execute("PRAGMA foreign_key_check").fetchall() == []
        assert restored.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchall() == [(current_head(),)]
        equal = rows(source) == rows(restored)
        assert equal, "logical dump changed table rows"
    for path in [backup_case[1], backup_case[1] / run_id]:
        assert path.stat().st_mode & 0o777 == 0o700
    for path in (backup_case[1] / run_id).iterdir():
        assert path.stat().st_mode & 0o777 == 0o600
    assert (backup_case[1] / ".backup.lock").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "fault",
    [
        "corrupt",
        "fk",
        "revision_missing",
        "revision_old",
        "revision_future",
        "grades",
        "health",
        "user_version",
        "application_id",
        "virtual",
    ],
)
def test_backup_rejects_invalid_snapshot(backup_case, fault):
    previous = str(uuid4())
    assert run_backup(backup_case, previous).returncode == 3
    before = fingerprints(backup_case[1] / previous)
    if fault == "corrupt":
        backup_case[0].write_bytes(b"invalid database")
    else:
        with sqlite3.connect(backup_case[0]) as db:
            statements = {
                "fk": "UPDATE apps SET owner_id='absent'",
                "revision_missing": "DROP TABLE alembic_version",
                "revision_old": "UPDATE alembic_version SET version_num='0001_baseline'",
                "revision_future": "UPDATE alembic_version SET version_num='9999_future'",
                "grades": "DELETE FROM app_grades",
                "health": "DELETE FROM health_results",
                "user_version": "PRAGMA user_version=1",
                "application_id": "PRAGMA application_id=1234",
                "virtual": "CREATE VIRTUAL TABLE extra_fts USING fts5(content)",
            }
            db.execute(statements[fault])
    run_id = str(uuid4())
    result = run_backup(backup_case, run_id)
    assert result.returncode == 1
    assert result.stderr.strip() == "BACKUP_FAILED"
    assert not (backup_case[1] / run_id).exists()
    assert before == fingerprints(backup_case[1] / previous)


def test_backup_manifest_binds_original_expiry_and_scope(backup_case, monkeypatch):
    from app import backup

    fixed = "2026-10-08T00:00:00.000000Z"
    monkeypatch.setattr(backup, "_stamp", lambda: fixed)
    settings = backup.Settings.from_environment(environment(backup_case))
    run_id = str(uuid4())
    value = backup.backup_database(
        settings,
        output_dir=backup_case[1],
        recipient_file=backup_case[2],
        release_id="fixed-clock",
        run_id=run_id,
    )
    assert value["original_expires_at"] == "2026-11-07T00:00:00.000000Z"
    assert value["recovery_point_at"] == value["created_at"] == fixed
    value, inner, dump = unpack(backup_case, run_id)
    with (
        closing(sqlite3.connect(backup_case[0])) as source,
        closing(sqlite3.connect(":memory:")) as restored,
    ):
        restored.executescript(dump.decode())
        equal = rows(source) == rows(restored)
        assert equal, "row lifetimes changed"
    for alteration in [
        dict(value, format_version=2),
        dict(value, included=["main_database", "ledger"]),
        dict(value, remote_confirmed=True),
        dict(value, payload_format="sqlite-file"),
        dict(value, original_expires_at="2026-11-08T00:00:00Z"),
        dict(value, release_id="altered-build"),
    ]:
        with pytest.raises(ValueError, match="BACKUP_MANIFEST_INVALID"):
            backup.validate_manifest(alteration, metadata=inner)
    with pytest.raises(ValueError):
        backup.validate_manifest(value, now=datetime(2026, 11, 7, tzinfo=UTC))
    backup.validate_manifest(
        value, metadata=inner, now=datetime(2026, 11, 6, tzinfo=UTC)
    )
    before = (backup_case[1] / run_id / "manifest.json").read_bytes()
    assert run_backup(backup_case, run_id).returncode == 1
    assert (backup_case[1] / run_id / "manifest.json").read_bytes() == before


@pytest.mark.parametrize(
    "fault",
    [
        "missing",
        "table",
        "schema",
        "schema_check",
        "lost_ack",
        "conflict",
        "partial_account",
        "undelivered",
        "legacy",
        "legacy_conflict",
    ],
)
def test_backup_requires_complete_current_ledger(backup_case, fault):
    from app.user_deletion_ledger import FIELDS, new_group

    previous = str(uuid4())
    assert run_backup(backup_case, previous).returncode == 3
    before = fingerprints(backup_case[1] / previous)
    path = backup_case[0].with_suffix(".deletions.sqlite3")
    event, target = str(uuid4()), str(uuid4())
    stamp = "2026-10-08T00:00:00.000000Z"
    if fault == "missing":
        path.unlink()
    else:
        with sqlite3.connect(path) as ledger, sqlite3.connect(backup_case[0]) as db:
            if fault == "table":
                ledger.execute("DROP TABLE completed_deletions")
            elif fault == "schema":
                ledger.execute("DROP TABLE member_deletions")
                ledger.execute(
                    "CREATE TABLE member_deletions(member_id TEXT,deleted_at TEXT)"
                )
            elif fault == "schema_check":
                ledger.execute("DROP TABLE completed_deletions")
                ledger.execute(
                    "CREATE TABLE completed_deletions(kind TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(kind,target_id))"
                )
            elif fault in {"lost_ack", "undelivered", "conflict"}:
                db.execute(
                    "INSERT INTO app_delete_outbox(event_id,app_id,source,db_applied_at,delivered_at) VALUES (?,?,'interactive_app_delete',?,?)",
                    (event, target, stamp, None if fault == "undelivered" else stamp),
                )
                if fault == "conflict":
                    ledger.execute(
                        "INSERT INTO completed_app_delete_events VALUES (?,?,'interactive_app_delete',?)",
                        (event, target, "2026-10-07T00:00:00Z"),
                    )
            elif fault == "partial_account":
                group = new_group(str(uuid4()), [target], stamp)
                ledger.execute(
                    "INSERT INTO completed_user_delete_events VALUES ("
                    + ",".join("?" for _ in FIELDS)
                    + ")",
                    tuple(group[0][f] for f in FIELDS),
                )
            else:
                db.execute("INSERT INTO member_deletions VALUES (?,?)", (target, stamp))
                if fault == "legacy_conflict":
                    ledger.execute(
                        "INSERT INTO member_deletions VALUES (?,?)",
                        (target, "2026-10-07T00:00:00Z"),
                    )
    before_ledger = (
        hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    )
    before_db = hashlib.sha256(backup_case[0].read_bytes()).hexdigest()
    run_id = str(uuid4())
    result = run_backup(backup_case, run_id)
    assert result.returncode == 1
    assert result.stderr.strip() == "BACKUP_FAILED"
    assert not (backup_case[1] / run_id).exists()
    assert before_db == hashlib.sha256(backup_case[0].read_bytes()).hexdigest()
    assert (
        hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    ) == before_ledger
    assert before == fingerprints(backup_case[1] / previous)


def test_backup_accepts_newer_ledger_without_including_or_mutating_it(backup_case):
    path = backup_case[0].with_suffix(".deletions.sqlite3")
    with sqlite3.connect(path) as ledger:
        ledger.execute(
            "INSERT INTO completed_app_delete_events VALUES (?,?,'interactive_app_delete','2026-10-08T00:00:00Z')",
            (str(uuid4()), str(uuid4())),
        )
    before = path.read_bytes()
    run_id = str(uuid4())
    assert run_backup(backup_case, run_id).returncode == 3
    manifest, _, _ = unpack(backup_case, run_id)
    assert (
        manifest["ledger_checkpoint"]["tables"]["completed_app_delete_events"]["rows"]
        == 1
    )
    assert path.read_bytes() == before


@pytest.mark.parametrize(
    "fault",
    [
        "output_mode",
        "recipient_mode",
        "recipient_fifo",
        "db_mode",
        "output_symlink",
        "recipient_symlink",
        "db_symlink",
        "ledger_symlink",
        "recipient_hardlink",
        "db_hardlink",
        "lock_hardlink",
        "lock_symlink",
        "ancestor_mode",
        "run_traversal",
        "release_secret",
        "recipient_secret",
        "recipient_checksum",
        "recipient_empty",
        "recipient_ssh",
        "recipient_plugin",
        "unknown_flag",
        "missing_arg",
        "help",
    ],
)
def test_backup_refuses_unsafe_files_and_secret_output(backup_case, fault):
    database, output, recipient = backup_case
    previous = str(uuid4())
    assert run_backup(backup_case, previous).returncode == 3
    before = fingerprints(output / previous)
    extra = []
    run_id = str(uuid4())
    sentinel = "SECRET_TEST_SENTINEL!"
    if fault.endswith("_mode"):
        path = {
            "output_mode": output,
            "recipient_mode": recipient,
            "db_mode": database,
            "ancestor_mode": database.parent,
        }[fault]
        path.chmod(0o777 if path.is_dir() else 0o644)
    elif fault.endswith("_symlink"):
        path = {
            "output_symlink": output,
            "recipient_symlink": recipient,
            "db_symlink": database,
            "ledger_symlink": database.with_suffix(".deletions.sqlite3"),
            "lock_symlink": output / ".backup.lock",
        }[fault]
        original = path.with_name(path.name + ".original")
        path.rename(original)
        path.symlink_to(original)
    elif fault.endswith("_hardlink"):
        path = {
            "recipient_hardlink": recipient,
            "db_hardlink": database,
            "lock_hardlink": output / ".backup.lock",
        }[fault]
        os.link(path, path.with_name(path.name + ".link"))
    elif fault == "run_traversal":
        run_id = "../" + sentinel
    elif fault == "release_secret":
        extra = ["--release-id", sentinel]
    elif fault == "recipient_fifo":
        recipient.unlink()
        os.mkfifo(recipient, 0o600)
    elif fault.startswith("recipient_"):
        recipient.write_text(
            {
                "recipient_secret": sentinel,
                "recipient_checksum": RECIPIENT[:-1] + "q",
                "recipient_empty": "# empty\n",
                "recipient_ssh": "ssh-ed25519 AAAA",
                "recipient_plugin": "age1plugin-fake",
            }[fault]
        )
    elif fault == "unknown_flag":
        extra = ["--" + sentinel]
    elif fault == "missing_arg":
        extra = ["--release-id"]
    else:
        extra = ["--help"]
    result = run_backup(backup_case, run_id, *extra)
    assert result.returncode in {1, 2}
    assert sentinel not in result.stdout + result.stderr
    assert not (output / run_id).exists()
    assert before == fingerprints(output / previous)


def test_backup_rejects_output_owned_by_another_user(backup_case, monkeypatch):
    from app import backup

    settings = backup.Settings.from_environment(environment(backup_case))
    uid = os.getuid()
    monkeypatch.setattr(backup.os, "getuid", lambda: uid + 1)
    with pytest.raises(backup.BackupUsageError):
        backup.backup_database(
            settings,
            output_dir=backup_case[1],
            recipient_file=backup_case[2],
            release_id="owned",
        )


@pytest.mark.parametrize(
    "fault",
    [
        "ciphertext",
        "manifest",
        "fsync",
        "rename",
        "rename_after",
        "parent_fsync",
        "child_exit",
        "child_timeout",
    ],
)
def test_backup_failure_preserves_previous_pair(
    backup_case, monkeypatch, fault, capsys
):
    from app import backup

    previous = str(uuid4())
    assert run_backup(backup_case, previous).returncode == 3
    before = fingerprints(backup_case[1] / previous)
    original_open, original_fsync, original_rename = os.open, os.fsync, os.rename
    calls = 0

    def open_file(path, flags, *args, **kwargs):
        if (
            path
            == {"ciphertext": "backup.tar.age", "manifest": "manifest.json"}.get(fault)
            and flags & os.O_CREAT
        ):
            raise OSError(28, "SECRET_TEST_SENTINEL!")
        return original_open(path, flags, *args, **kwargs)

    def fsync(fd):
        nonlocal calls
        calls += 1
        if fault == "fsync" or fault == "parent_fsync" and calls == 4:
            raise OSError(28, "SECRET_TEST_SENTINEL!")
        return original_fsync(fd)

    def rename(*args, **kwargs):
        if fault == "rename_after":
            original_rename(*args, **kwargs)
        raise OSError(28, "SECRET_TEST_SENTINEL!")

    monkeypatch.setattr(os, "open", open_file)
    monkeypatch.setattr(os, "fsync", fsync)
    if fault in {"rename", "rename_after"}:
        monkeypatch.setattr(os, "rename", rename)
    if fault.startswith("child_"):
        binary = backup_case[0].parent / "age"
        binary.write_text(
            f"#!{sys.executable}\nimport sys,time\nif '--version' in sys.argv: print('v1.2.1')\nelse:\n    sys.stderr.write('SECRET_TEST_SENTINEL!')\n    "
            + ("sys.exit(1)\n" if fault == "child_exit" else "time.sleep(30)\n")
        )
        monkeypatch.setattr(backup, "TIMEOUT", 0.15)
    run_id = str(uuid4())
    argv = command(backup_case, run_id)[4:]
    for key, value in environment(backup_case).items():
        monkeypatch.setenv(key, value)
    assert backup.main(argv) == 1
    captured = capsys.readouterr()
    assert captured.err.strip() == "BACKUP_FAILED"
    assert "SECRET_TEST_SENTINEL!" not in captured.out + captured.err
    assert before == fingerprints(backup_case[1] / previous)
    late_failure = fault in {"parent_fsync", "rename_after"}
    assert (backup_case[1] / run_id).exists() is late_failure
    if late_failure:
        assert sorted(p.name for p in (backup_case[1] / run_id).iterdir()) == [
            "backup.tar.age",
            "manifest.json",
        ]
    assert not list(backup_case[1].glob(".stage-*"))


@pytest.mark.parametrize("ci", ["false", "true"])
def test_age_marker_is_not_silently_skipped_in_ci(monkeypatch, ci):
    import shutil
    from types import SimpleNamespace

    from tests.conftest import require_age

    monkeypatch.setattr(shutil, "which", lambda name: None)
    monkeypatch.setenv("CI", ci)
    request = SimpleNamespace(
        node=SimpleNamespace(get_closest_marker=lambda name: True)
    )
    expected = pytest.fail.Exception if ci == "true" else pytest.skip.Exception
    with pytest.raises(
        expected,
        match="NOT RUN: real age encryption requires installed age, age-keygen",
    ):
        require_age.__wrapped__(request)


def test_backup_never_copies_live_database_or_writes_plaintext(
    backup_case, monkeypatch
):
    from app import backup

    original_connect, original_open = sqlite3.connect, os.open
    original_popen = subprocess.Popen
    snapshots = []
    opened = []
    encryptions = []

    class Connection(sqlite3.Connection):
        def backup(self, target, **kwargs):
            assert target.execute("PRAGMA temp_store").fetchone() == (2,)
            assert target.execute("PRAGMA database_list").fetchone()[2] == ""
            snapshots.append(True)
            return super().backup(target, **kwargs)

    def connect(*args, **kwargs):
        return original_connect(*args, factory=Connection, **kwargs)

    def open_file(path, flags, *args, **kwargs):
        if flags & os.O_CREAT:
            assert path in {".backup.lock", "backup.tar.age", "manifest.json"}
            opened.append(path)
        return original_open(path, flags, *args, **kwargs)

    def popen(args, **kwargs):
        if "--encrypt" in args:
            assert args[1:3] == ["--encrypt", "--recipients-file"]
            assert len(args) == 4 and args[3].startswith("/proc/self/fd/")
            assert "identity" not in " ".join(args) and RECIPIENT not in " ".join(args)
            assert kwargs["stderr"] == subprocess.DEVNULL
            encryptions.append(True)
        return original_popen(args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", connect)
    monkeypatch.setattr(os, "open", open_file)
    monkeypatch.setattr(subprocess, "Popen", popen)
    before_fds = len(list(Path("/proc/self/fd").iterdir()))
    manifest = backup.backup_database(
        backup.Settings.from_environment(environment(backup_case)),
        output_dir=backup_case[1],
        recipient_file=backup_case[2],
        release_id="memory-only",
    )
    assert snapshots == [True]
    assert encryptions == [True]
    assert opened == [".backup.lock", "backup.tar.age", "manifest.json"]
    assert len(list(Path("/proc/self/fd").iterdir())) == before_fds
    assert not list(backup_case[1].glob(".stage-*"))
    _, _, dump = unpack(backup_case, manifest["run_id"])
    with closing(sqlite3.connect(":memory:")) as restored:
        restored.executescript(dump.decode())
        assert restored.execute("SELECT count(*) FROM apps").fetchone() == (3,)
