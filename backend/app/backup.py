"""Private local backups. Independent storage confirmation belongs to T10."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import resource
import select
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
from contextlib import ExitStack, closing
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4

from alembic.util.exc import CommandError

from app import app_deletion_ledger, user_deletion_ledger
from app.catalog import CATALOG
from app.database import current_head
from app.settings import ROOT, Settings

TIMEOUT = 60
STATUS = "LOCAL_ONLY_REMOTE_NOT_CONFIRMED"
PAYLOAD_FORMAT = "sqlite-sql-dump-v1"
LEDGER_SCHEMA = {
    "member_deletions": "member_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL",
    "app_deletions": "app_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL",
    "completed_deletions": "kind TEXT NOT NULL CHECK(kind IN ('member','app')), target_id TEXT NOT NULL, PRIMARY KEY(kind,target_id)",
    "deletion_cancellations": "kind TEXT NOT NULL CHECK(kind IN ('member','app')), target_id TEXT NOT NULL, cancelled_at TEXT NOT NULL, reason TEXT NOT NULL",
}
TABLES = (*LEDGER_SCHEMA, app_deletion_ledger.TABLE, user_deletion_ledger.TABLE)
CORE = {
    "format_version",
    "payload_format",
    "run_id",
    "created_at",
    "recovery_point_at",
    "snapshot_completed_at",
    "original_expires_at",
    "release_id",
    "revision",
    "age_version",
    "recipient_file_sha256",
    "included",
    "database",
    "ledger_checkpoint",
}
OUTER = {"ciphertext", "local_complete", "remote_confirmed"}


class BackupUsageError(ValueError):
    pass


class BackupInterrupted(BaseException):
    def __init__(self, signum):
        self.signum = signum


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _stamp():
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _utc(value):
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() != timedelta(0):
        raise ValueError()
    return parsed


def _uuid(value):
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        return False


def _digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)


def _sized_digest(value):
    return (
        isinstance(value, dict)
        and set(value) == {"sha256", "bytes"}
        and _digest(value["sha256"])
        and type(value["bytes"]) is int
        and value["bytes"] > 0
    )


def validate_manifest(manifest, *, metadata=None, now=None):
    """Structure/expiry only; supply age-authenticated metadata to bind the core."""
    try:
        if not isinstance(manifest, dict) or set(manifest) != CORE | OUTER:
            raise ValueError()
        if (
            type(manifest["format_version"]) is not int
            or manifest["format_version"] != 1
            or manifest["payload_format"] != PAYLOAD_FORMAT
            or not _uuid(manifest["run_id"])
            or not re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", manifest["release_id"]
            )
            or not re.fullmatch(r"[A-Za-z0-9_]{1,80}", manifest["revision"])
            or not re.fullmatch(r"v?1\.[0-9]+\.[0-9]+", manifest["age_version"])
            or not _digest(manifest["recipient_file_sha256"])
            or manifest["included"] != ["main_database"]
            or not _sized_digest(manifest["database"])
            or not _sized_digest(manifest["ciphertext"])
            or manifest["local_complete"] is not True
            or manifest["remote_confirmed"] is not False
        ):
            raise ValueError()
        created, recovery, completed, expires = (
            _utc(manifest[key])
            for key in (
                "created_at",
                "recovery_point_at",
                "snapshot_completed_at",
                "original_expires_at",
            )
        )
        instant = datetime.now(UTC) if now is None else now
        if not (
            created == recovery <= completed <= instant < expires
            and expires == created + timedelta(days=30)
        ):
            raise ValueError()
        checkpoint = manifest["ledger_checkpoint"]
        if (
            set(checkpoint) != {"schema_version", "observed_at", "status", "tables"}
            or type(checkpoint["schema_version"]) is not int
            or checkpoint["schema_version"] != 1
            or checkpoint["status"] != "LOCAL_REFERENCE_ONLY"
            or not completed <= _utc(checkpoint["observed_at"]) <= instant
            or set(checkpoint["tables"]) != set(TABLES)
        ):
            raise ValueError()
        for table in checkpoint["tables"].values():
            if (
                set(table) != {"rows", "sha256"}
                or type(table["rows"]) is not int
                or table["rows"] < 0
                or not _digest(table["sha256"])
            ):
                raise ValueError()
        if metadata is not None and _json(metadata) != _json(
            {k: manifest[k] for k in CORE}
        ):
            raise ValueError()
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        raise ValueError("BACKUP_MANIFEST_INVALID") from None


def _directory(path, *, test):
    if not path.is_absolute() or ".." in path.parts or path.is_relative_to(ROOT):
        raise BackupUsageError()
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:]:
            child = os.open(
                part,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=fd,
            )
            os.close(fd)
            fd = child
            info = os.fstat(fd)
            sticky_test_root = test and info.st_mode & stat.S_ISVTX and info.st_uid == 0
            if info.st_uid not in {0, os.getuid()} or (
                info.st_mode & 0o022 and not sticky_test_root
            ):
                raise BackupUsageError()
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise BackupUsageError()
        return fd
    except BaseException:
        os.close(fd)
        raise


def _file(parent, name, flags=os.O_RDONLY):
    fd = os.open(
        name, flags | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK, 0o600, dir_fd=parent
    )
    try:
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            raise BackupUsageError()
        return fd
    except BaseException:
        os.close(fd)
        raise


def _recipients(raw):
    # Bech32 checksum plus canonical padding; identities/plugins/SSH never accepted.
    alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    count = 0
    try:
        lines = raw.decode("ascii").splitlines()
    except UnicodeError:
        raise BackupUsageError() from None
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if not re.fullmatch(r"age1[" + alphabet + r"]{58}", line):
            raise BackupUsageError()
        data = [alphabet.index(c) for c in line[4:]]
        checksum = 1
        for value in [3, 3, 3, 0, 1, 7, 5, *data]:
            top = checksum >> 25
            checksum = ((checksum & 0x1FFFFFF) << 5) ^ value
            for i, generator in enumerate(
                (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
            ):
                if top >> i & 1:
                    checksum ^= generator
        if checksum != 1 or data[51] & 15:
            raise BackupUsageError()
        count += 1
    if not count:
        raise BackupUsageError()


def _age():
    binary = shutil.which("age")
    if not binary:
        raise RuntimeError()
    info = Path(binary).stat()
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid not in {0, os.getuid()}
        or info.st_mode & 0o022
    ):
        raise RuntimeError()
    result = subprocess.run(
        [binary, "--version"], capture_output=True, timeout=5, check=False
    )
    version = result.stdout.decode("ascii").strip()
    if result.returncode or not re.fullmatch(r"v?1\.[0-9]+\.[0-9]+", version):
        raise RuntimeError()
    return binary, version


def _read_only(parent, name):
    return sqlite3.connect(
        f"file:/proc/self/fd/{parent}/{quote(name, safe='')}?mode=ro",
        uri=True,
        timeout=1,
    )


def _verify_snapshot(db):
    if (
        db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]
        or db.execute("PRAGMA foreign_key_check").fetchall()
    ):
        raise RuntimeError()
    revision = db.execute("SELECT version_num FROM alembic_version").fetchall()
    if revision != [(current_head(),)]:
        raise RuntimeError()
    for table in (
        "members",
        "apps",
        "app_grades",
        "health_results",
        "auth_flows",
        "sessions",
        "recovery_credentials",
        "write_operations",
        "health_jobs",
        "app_delete_outbox",
        "user_delete_outbox",
        "member_deletions",
        "app_deletions",
    ):
        db.execute(f"SELECT * FROM {table} LIMIT 0")
    if (
        db.execute("PRAGMA user_version").fetchone()[0]
        or db.execute("PRAGMA application_id").fetchone()[0]
        or db.execute(
            "SELECT 1 FROM sqlite_master WHERE upper(sql) LIKE '%CREATE VIRTUAL TABLE%' LIMIT 1"
        ).fetchone()
    ):
        raise RuntimeError()
    if db.execute(
        "SELECT 1 FROM apps a WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.id=a.owner_id) OR NOT EXISTS (SELECT 1 FROM app_grades g WHERE g.app_id=a.id) OR NOT EXISTS (SELECT 1 FROM health_results h WHERE h.app_id=a.id) LIMIT 1"
    ).fetchone():
        raise RuntimeError()
    grades = db.execute("SELECT app_id,grade FROM app_grades").fetchall()
    if any(row[1] not in CATALOG["grades"] for row in grades) or len(grades) != len(
        set(grades)
    ):
        raise RuntimeError()
    if (
        db.execute(
            "SELECT 1 FROM members WHERE approval_status NOT IN ('pending','approved','revoked') OR is_admin NOT IN (0,1) LIMIT 1"
        ).fetchone()
        or db.execute(
            "SELECT 1 FROM apps WHERE is_public NOT IN (0,1) LIMIT 1"
        ).fetchone()
    ):
        raise RuntimeError()
    return revision[0][0]


def _checkpoint(snapshot, parent, name):
    with (
        closing(_read_only(parent, name)) as ledger,
        closing(sqlite3.connect(":memory:")) as reference,
    ):
        ledger.execute("BEGIN")
        if ledger.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise RuntimeError()
        for table, columns in LEDGER_SCHEMA.items():
            reference.execute(f"CREATE TABLE {table}({columns})")
            if (
                ledger.execute(f"PRAGMA table_info({table})").fetchall()
                != reference.execute(f"PRAGMA table_info({table})").fetchall()
            ):
                raise RuntimeError()
            definitions = [
                db.execute(
                    "SELECT sql FROM sqlite_master WHERE name=?", (table,)
                ).fetchone()[0]
                for db in (ledger, reference)
            ]
            checks = [
                re.findall(r"CHECK\((.*?)\)(?=,|\))", re.sub(r"\s+", "", ddl).upper())
                for ddl in definitions
            ]
            if checks[0] != checks[1]:
                raise RuntimeError()
        events = app_deletion_ledger._events(ledger)
        snapshot.row_factory = sqlite3.Row
        app_deletion_ledger._verify(
            snapshot.execute("SELECT * FROM app_delete_outbox").fetchall(),
            events,
            restored=True,
        )
        accounts = user_deletion_ledger._events(ledger)
        user_deletion_ledger.groups(accounts.values())
        rows = snapshot.execute("SELECT * FROM user_delete_outbox").fetchall()
        user_deletion_ledger.groups(rows)
        targets = {(r["kind"], r["target_id"]): r for r in accounts.values()}
        for row in rows:
            expected = {f: row[f] for f in user_deletion_ledger.FIELDS}
            if (
                accounts.get(row["event_id"]) != expected
                or targets.get((row["kind"], row["target_id"])) != expected
            ):
                raise RuntimeError()
        for table, column in (
            ("member_deletions", "member_id"),
            ("app_deletions", "app_id"),
        ):
            known = dict(ledger.execute(f"SELECT {column},deleted_at FROM {table}"))
            if any(
                known.get(row[0]) != row[1]
                for row in snapshot.execute(f"SELECT {column},deleted_at FROM {table}")
            ):
                raise RuntimeError()
        tables = {}
        for table in TABLES:
            rows = sorted(
                _json(list(row)) for row in ledger.execute(f"SELECT * FROM {table}")
            )
            tables[table] = {
                "rows": len(rows),
                "sha256": hashlib.sha256(b"\n".join(rows)).hexdigest(),
            }
        snapshot.row_factory = None
        return {
            "schema_version": 1,
            "observed_at": _stamp(),
            "status": "LOCAL_REFERENCE_ONLY",
            "tables": tables,
        }


def _snapshot(parent, name, ledger_name):
    with (
        closing(_read_only(parent, name)) as source,
        closing(sqlite3.connect(":memory:")) as snapshot,
    ):
        snapshot.execute("PRAGMA temp_store=MEMORY")
        created = _stamp()
        source.execute("BEGIN")
        source.execute("SELECT count(*) FROM sqlite_master").fetchone()
        deadline = time.monotonic() + TIMEOUT

        def progress(*_):
            if time.monotonic() >= deadline:
                raise TimeoutError()

        source.backup(snapshot, pages=128, progress=progress, sleep=0.01)
        completed = _stamp()
        revision = _verify_snapshot(snapshot)
        checkpoint = _checkpoint(snapshot, parent, ledger_name)
        # ponytail: RAM scales with DB size; protected tmpfs needs a separate decision.
        dump = ("\n".join(snapshot.iterdump()) + "\n").encode("utf-8")
        return dump, created, completed, revision, checkpoint


class _Pipe:
    def __init__(self, pipe, deadline):
        self.fd, self.deadline = pipe.fileno(), deadline
        os.set_blocking(self.fd, False)

    def write(self, data):
        remaining = memoryview(data)
        while remaining:
            seconds = self.deadline - time.monotonic()
            if seconds <= 0 or not select.select([], [self.fd], [], seconds)[1]:
                raise TimeoutError()
            try:
                remaining = remaining[os.write(self.fd, remaining) :]
            except BlockingIOError:
                continue
        return len(data)


def _encrypt(binary, recipient_fd, ciphertext_fd, dump, metadata):
    deadline = time.monotonic() + TIMEOUT
    process = subprocess.Popen(
        [binary, "--encrypt", "--recipients-file", f"/proc/self/fd/{recipient_fd}"],
        pass_fds=(recipient_fd,),
        stdin=subprocess.PIPE,
        stdout=ciphertext_fd,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        # Fixed members avoid tarfile's stream close flushing after an interrupt.
        pipe = _Pipe(process.stdin, deadline)
        for name, payload in (
            ("database.sql", dump),
            ("metadata.json", _json(metadata)),
        ):
            member = tarfile.TarInfo(name)
            member.size, member.mode = len(payload), 0o600
            pipe.write(member.tobuf())
            pipe.write(payload)
            pipe.write(bytes(-len(payload) % tarfile.BLOCKSIZE))
        pipe.write(bytes(2 * tarfile.BLOCKSIZE))
        process.stdin.close()
        if process.wait(timeout=max(0.001, deadline - time.monotonic())) != 0:
            raise RuntimeError()
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()
        process.stdin.close()


def _publish(root, run_id, binary, recipient_fd, dump, core):
    stage = f".stage-{run_id}-{uuid4()}"
    os.mkdir(stage, mode=0o700, dir_fd=root)
    stage_fd = os.open(stage, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root)
    published = False
    try:
        fd = _file(stage_fd, "backup.tar.age", os.O_CREAT | os.O_EXCL | os.O_RDWR)
        with os.fdopen(fd, "r+b") as ciphertext:
            _encrypt(binary, recipient_fd, ciphertext.fileno(), dump, core)
            ciphertext.seek(0)
            digest = hashlib.file_digest(ciphertext, "sha256").hexdigest()
            manifest = {
                **core,
                "ciphertext": {"sha256": digest, "bytes": ciphertext.tell()},
                "local_complete": True,
                "remote_confirmed": False,
            }
            validate_manifest(manifest, metadata=core)
            os.fsync(ciphertext.fileno())
        fd = _file(stage_fd, "manifest.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "wb") as output:
            output.write(_json(manifest) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        os.fsync(stage_fd)
        os.rename(stage, run_id, src_dir_fd=root, dst_dir_fd=root)
        published = True
        os.fsync(root)
        return manifest
    finally:
        try:
            if not published and stage in os.listdir(root):
                for name in ("backup.tar.age", "manifest.json"):
                    try:
                        os.unlink(name, dir_fd=stage_fd)
                    except FileNotFoundError:
                        pass
                os.rmdir(stage, dir_fd=root)
        finally:
            os.close(stage_fd)


def backup_database(settings, *, output_dir, recipient_file, release_id, run_id=None):
    """Publish one private pair; source and independent deletion evidence are read-only."""
    run_id = str(uuid4()) if run_id is None else run_id
    if not _uuid(run_id) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", release_id
    ):
        raise BackupUsageError()
    with ExitStack() as stack:

        def directory(path):
            fd = _directory(path, test=settings.app_env == "test")
            stack.callback(os.close, fd)
            return fd

        def file(parent, name, flags=os.O_RDONLY):
            fd = _file(parent, name, flags)
            stack.callback(os.close, fd)
            return fd

        root = directory(Path(output_dir))
        recipient_file = Path(recipient_file)
        recipient_fd = file(directory(recipient_file.parent), recipient_file.name)
        raw = os.read(recipient_fd, 65537)
        if len(raw) > 65536:
            raise BackupUsageError()
        _recipients(raw)
        os.lseek(recipient_fd, 0, os.SEEK_SET)
        binary, age_version = _age()
        parent = directory(settings.database_path.parent)
        file(parent, settings.database_path.name)
        ledger_name = settings.database_path.with_suffix(".deletions.sqlite3").name
        file(parent, ledger_name)
        lock = file(root, ".backup.lock", os.O_CREAT | os.O_RDWR)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if run_id in os.listdir(root):
            raise RuntimeError()
        dump, created, completed, revision, checkpoint = _snapshot(
            parent, settings.database_path.name, ledger_name
        )
        core = {
            "format_version": 1,
            "payload_format": PAYLOAD_FORMAT,
            "run_id": run_id,
            "created_at": created,
            "recovery_point_at": created,
            "snapshot_completed_at": completed,
            "original_expires_at": (_utc(created) + timedelta(days=30))
            .isoformat(timespec="microseconds")
            .replace("+00:00", "Z"),
            "release_id": release_id,
            "revision": revision,
            "age_version": age_version,
            "recipient_file_sha256": hashlib.sha256(raw).hexdigest(),
            "included": ["main_database"],
            "database": {
                "sha256": hashlib.sha256(dump).hexdigest(),
                "bytes": len(dump),
            },
            "ledger_checkpoint": checkpoint,
        }
        return _publish(root, run_id, binary, recipient_fd, dump, core)


class _Parser(argparse.ArgumentParser):
    def exit(self, status=0, message=None):
        super().exit(2 if status == 0 else status, message)

    def error(self, message):
        self.exit(2, "BACKUP_USAGE_INVALID\n")


def main(argv):
    parser = _Parser(prog="python -m app.cli backup-db", allow_abbrev=False)
    for flag in ("output-dir", "recipient-file", "release-id"):
        parser.add_argument(f"--{flag}", required=True)
    parser.add_argument("--run-id")
    args = parser.parse_args(argv)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    previous = {}

    def interrupted(signum, _frame):
        for stop in (signal.SIGINT, signal.SIGTERM):
            signal.signal(stop, signal.SIG_IGN)
        raise BackupInterrupted(signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, interrupted)
        try:
            settings = Settings.from_environment()
            raw_database = os.environ.get("DATABASE_PATH")
            if (
                raw_database is not None
                and Path(raw_database) != settings.database_path
            ):
                raise BackupUsageError()
        except ValueError:
            raise BackupUsageError() from None
        backup_database(settings, **vars(args))
        print(STATUS)
        return 3
    except BackupInterrupted as error:
        print("BACKUP_INTERRUPTED", file=sys.stderr)
        return 128 + error.signum
    except BackupUsageError:
        print("BACKUP_USAGE_INVALID", file=sys.stderr)
        return 2
    except (
        UnicodeError,
        ValueError,
        TypeError,
        OSError,
        RuntimeError,
        sqlite3.Error,
        subprocess.SubprocessError,
        tarfile.TarError,
        MemoryError,
        CommandError,
    ):
        print("BACKUP_FAILED", file=sys.stderr)
        return 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
