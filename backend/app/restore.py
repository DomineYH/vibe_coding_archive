"""Test-only isolated recovery. A verified artifact never grants service readiness."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import resource
import select
import signal
import sqlite3
import subprocess
import sys
import tarfile
import time
from contextlib import ExitStack, closing, suppress
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import app_deletion_ledger, backup, health_store, user_deletion_ledger
from app.auth_maintenance import reconcile, sweep
from app.database import current_head, make_engine, make_session_factory
from app.health_runtime import boot_clock
from app.restore_guard import MARKER
from app.settings import Settings

STATUS = "RESTORE_VERIFIED_LOCAL_ONLY_MAINTENANCE_REQUIRED"
AUTHORITY = "CURRENT_AUTHORITY_UNPROVEN"
# ponytail: supply trusted current-authority input when T10/T12 define its provenance.
MAX_PAYLOAD = 128 * 1024 * 1024
MAX_METADATA = 65536
BACKEND = Path(__file__).resolve().parents[1]


def _bounded(fd, limit):
    with os.fdopen(os.dup(fd), "rb") as source:
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise RuntimeError()
    return raw


def _identity(raw):
    alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    count = 0
    for line in raw.decode("ascii").splitlines():
        if not line or line.startswith("#"):
            continue
        if not re.fullmatch(r"AGE-SECRET-KEY-1[" + alphabet.upper() + r"]{58}", line):
            raise backup.BackupUsageError()
        hrp = "age-secret-key-"
        data = [alphabet.index(c) for c in line.lower()[len(hrp) + 1 :]]
        values = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]
        checksum = 1
        for value in values + data:
            top = checksum >> 25
            checksum = ((checksum & 0x1FFFFFF) << 5) ^ value
            for i, generator in enumerate(
                (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
            ):
                if top >> i & 1:
                    checksum ^= generator
        if checksum != 1 or data[51] & 15:
            raise backup.BackupUsageError()
        count += 1
    if not count:
        raise backup.BackupUsageError()


def _decrypt(identity_fd, ciphertext_fd):
    binary, _ = backup._age()
    process = subprocess.Popen(
        [binary, "--decrypt", "--identity", f"/proc/self/fd/{identity_fd}"],
        pass_fds=(identity_fd,),
        stdin=ciphertext_fd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        os.set_blocking(process.stdout.fileno(), False)
        output = bytearray()
        deadline = time.monotonic() + backup.TIMEOUT
        while True:
            remaining = deadline - time.monotonic()
            if (
                remaining <= 0
                or not select.select([process.stdout], [], [], remaining)[0]
            ):
                raise TimeoutError()
            block = os.read(process.stdout.fileno(), 65536)
            if not block:
                break
            output.extend(block)
            if len(output) > MAX_PAYLOAD:
                raise RuntimeError()
        if process.wait(timeout=max(0.001, deadline - time.monotonic())):
            raise RuntimeError()
        return bytes(output)
    finally:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()
        process.stdout.close()


def _artifact(artifact_fd, identity_fd):
    with ExitStack() as stack:

        def file(name):
            fd = backup._file(artifact_fd, name)
            stack.callback(os.close, fd)
            return fd

        manifest = json.loads(_bounded(file("manifest.json"), MAX_METADATA))
        backup.validate_manifest(manifest)
        cipher = file("backup.tar.age")
        raw = _bounded(cipher, MAX_PAYLOAD)
        if manifest["ciphertext"] != {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        }:
            raise RuntimeError()
        os.lseek(cipher, 0, os.SEEK_SET)
        payload = _decrypt(identity_fd, cipher)
        contents = {}
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
            for member in archive:
                limit = MAX_METADATA if member.name == "metadata.json" else MAX_PAYLOAD
                if (
                    member.name not in {"database.sql", "metadata.json"}
                    or member.name in contents
                    or not member.isreg()
                    or member.mode != 0o600
                    or not 0 < member.size <= limit
                    or member.pax_headers
                ):
                    raise RuntimeError()
                contents[member.name] = archive.extractfile(member).read(limit + 1)
        if set(contents) != {"database.sql", "metadata.json"}:
            raise RuntimeError()
        metadata = json.loads(contents["metadata.json"])
        backup.validate_manifest(manifest, metadata=metadata)
        dump = contents["database.sql"]
        if manifest["database"] != {
            "sha256": hashlib.sha256(dump).hexdigest(),
            "bytes": len(dump),
        }:
            raise RuntimeError()
        scripts = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
        if manifest["revision"] not in {r.revision for r in scripts.walk_revisions()}:
            raise RuntimeError()
        return manifest, dump.decode("utf-8")


def _authorize(action, first, second, _database, _trigger):
    if action in {
        sqlite3.SQLITE_ATTACH,
        sqlite3.SQLITE_DETACH,
        sqlite3.SQLITE_CREATE_VTABLE,
    }:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and (
        first.lower() != "foreign_keys" or str(second).lower() not in {"off", "0"}
    ):
        return sqlite3.SQLITE_DENY
    # Dump values are literals; schema CHECKs only need these built-in functions.
    if action == sqlite3.SQLITE_FUNCTION and (second or "").lower() not in {
        "length",
        "typeof",
        "coalesce",
        "substr",
        "glob",
        "raise",
    }:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def _digest_database(db):
    db.execute("BEGIN")
    try:
        return hashlib.sha256(("\n".join(db.iterdump()) + "\n").encode()).hexdigest()
    finally:
        db.rollback()


def _invariants(db):
    revision = backup._verify_snapshot(db)
    for table in ("auth_flows", "sessions", "recovery_credentials"):
        if db.execute(
            f"SELECT 1 FROM {table} WHERE revoked_at IS NULL LIMIT 1"
        ).fetchone():
            raise RuntimeError()
    for table, condition in (
        ("write_operations", "1"),
        ("auth_transitions", "terminal_at IS NULL"),
        ("health_jobs", "status IN ('queued','running')"),
        ("health_worker", "ready=1"),
    ):
        if db.execute(f"SELECT 1 FROM {table} WHERE {condition} LIMIT 1").fetchone():
            raise RuntimeError()
    return revision


def _environment(settings):
    # ponytail: test-only recovery; T12 must decide the real-host recovery environment.
    if (
        settings.app_env != "test"
        or settings.health_checks_enabled
        or os.environ.get("APP_ENV") != "test"
        or os.environ.get("HEALTH_CHECKS_ENABLED") != "false"
        or os.environ.get("DATABASE_PATH") != str(settings.database_path)
        or not os.environ.get("PUBLIC_ORIGIN")
    ):
        raise backup.BackupUsageError()


def _run(settings, *, backup_dir, identity_file, ledger_file, verify):
    _environment(settings)
    database = settings.database_path
    ledger_name = database.with_suffix(".deletions.sqlite3").name
    if database.name in {MARKER, "restore-receipt.json", ledger_name}:
        raise backup.BackupUsageError()
    with ExitStack() as stack:

        def directory(path):
            fd = backup._directory(Path(path), test=True)
            stack.callback(os.close, fd)
            return fd

        def file(parent, name, flags=os.O_RDONLY):
            fd = backup._file(parent, name, flags)
            stack.callback(os.close, fd)
            return fd

        target = directory(database.parent)
        artifact = directory(backup_dir)
        identity_file, ledger_file = Path(identity_file), Path(ledger_file)
        identity = file(directory(identity_file.parent), identity_file.name)
        ledger_parent = directory(ledger_file.parent)
        file(ledger_parent, ledger_file.name)
        _identity(_bounded(identity, MAX_METADATA))
        os.lseek(identity, 0, os.SEEK_SET)
        if not verify:
            if os.listdir(target):
                raise backup.BackupUsageError()
            try:
                marker = file(target, MARKER, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                raise backup.BackupUsageError() from None
            os.write(marker, b"RESTORE_MAINTENANCE_REQUIRED\n")
            os.fsync(marker)
            os.fsync(target)
        else:
            marker_contents = _bounded(file(target, MARKER), MAX_METADATA)
            file(target, database.name)
            file(target, ledger_name)
        manifest, dump = _artifact(artifact, identity)
        if verify:
            receipt_raw = _bounded(file(target, "restore-receipt.json"), MAX_METADATA)
            if (
                marker_contents
                != b"RESTORE_MAINTENANCE_REQUIRED\n"
                + hashlib.sha256(receipt_raw).hexdigest().encode()
                + b"\n"
            ):
                raise RuntimeError()
            receipt = json.loads(receipt_raw)
            if not isinstance(receipt, dict):
                raise RuntimeError()
        else:
            file(target, database.name, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            with closing(sqlite3.connect(database)) as db:
                deadline = time.monotonic() + backup.TIMEOUT
                db.execute("PRAGMA temp_store=MEMORY")
                db.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
                db.enable_load_extension(False)
                db.set_authorizer(_authorize)
                db.executescript(dump)
                db.set_authorizer(None)
                db.execute("PRAGMA foreign_keys=ON")
                backup._verify_snapshot(db, expected_revision=manifest["revision"])
            if manifest["revision"] != current_head():
                migration = subprocess.run(
                    [sys.executable, "-m", "alembic", "upgrade", "head"],
                    cwd=BACKEND,
                    env={
                        "PATH": os.environ.get("PATH", ""),
                        "APP_ENV": "test",
                        "DATABASE_PATH": str(database),
                        "PUBLIC_ORIGIN": settings.public_origin,
                        "HEALTH_CHECKS_ENABLED": "false",
                    },
                    capture_output=True,
                    timeout=backup.TIMEOUT,
                    check=False,
                )
                if migration.returncode:
                    raise RuntimeError()
            file(target, ledger_name, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            with (
                closing(backup._read_only(ledger_parent, ledger_file.name)) as source,
                closing(
                    sqlite3.connect(database.with_suffix(".deletions.sqlite3"))
                ) as replica,
            ):
                deadline = time.monotonic() + backup.TIMEOUT

                def progress(*_):
                    if time.monotonic() >= deadline:
                        raise TimeoutError()

                source.backup(replica, pages=128, progress=progress, sleep=0.01)
                source_digest = _digest_database(replica)
            with closing(backup._read_only(target, database.name)) as db:
                backup._verify_snapshot(db)
                checkpoint = backup._checkpoint(db, target, ledger_name)
            engine = make_engine(database)
            try:
                factory = make_session_factory(engine)
                app_deletion_ledger.prepare(factory, restored=True)
                user_deletion_ledger.prepare(factory, restored=True)
                reconcile(factory, restored=True)
                sweep(factory)
                with factory() as db:
                    db.execute(text("BEGIN IMMEDIATE"))
                    boot, mono = boot_clock()
                    stamp = backup._stamp()
                    health_store.cancel_all(db, stamp)
                    health_store.maintain(db, boot_id=boot, mono=mono, stamp=stamp)
                    db.commit()
            finally:
                engine.dispose()
            with closing(sqlite3.connect(database)) as sealed:
                if sealed.execute("PRAGMA journal_mode=DELETE").fetchone() != (
                    "delete",
                ):
                    raise RuntimeError()
            receipt = {
                "format_version": 1,
                "run_id": manifest["run_id"],
                "core_sha256": hashlib.sha256(
                    backup._json({k: manifest[k] for k in backup.CORE})
                ).hexdigest(),
                "target": database.name,
                "original_expires_at": manifest["original_expires_at"],
                "status": STATUS,
                "authority_status": AUTHORITY,
                "ledger_input": checkpoint["tables"],
                "source_ledger_sha256": source_digest,
                "verified_at": backup._stamp(),
            }
        with (
            closing(backup._read_only(target, database.name)) as db,
            closing(backup._read_only(target, ledger_name)) as ledger,
        ):
            revision = _invariants(db)
            optional_rows = db.execute(
                "SELECT count(*) FROM members WHERE email IS NOT NULL OR phone IS NOT NULL"
            ).fetchone()[0]
            digest = _digest_database(db)
            ledger_digest = _digest_database(ledger)
            backup._checkpoint(db, target, ledger_name)
        with closing(backup._read_only(ledger_parent, ledger_file.name)) as source:
            current_digest = _digest_database(source)
        backup.validate_manifest(manifest)
        if verify:
            expected = {
                "format_version": 1,
                "run_id": manifest["run_id"],
                "core_sha256": hashlib.sha256(
                    backup._json({k: manifest[k] for k in backup.CORE})
                ).hexdigest(),
                "target": database.name,
                "original_expires_at": manifest["original_expires_at"],
                "status": STATUS,
                "authority_status": AUTHORITY,
                "ledger_input": receipt.get("ledger_input"),
                "source_ledger_sha256": current_digest,
                "verified_at": receipt.get("verified_at"),
                "revision": revision,
                "legacy_optional_member_rows": optional_rows,
                "database_sha256": digest,
                "ledger_sha256": ledger_digest,
            }
            backup._utc(expected["verified_at"])
            if receipt != expected:
                raise RuntimeError()
        else:
            if current_digest != receipt["source_ledger_sha256"]:
                raise RuntimeError()
            receipt.update(
                revision=revision,
                legacy_optional_member_rows=optional_rows,
                database_sha256=digest,
                ledger_sha256=ledger_digest,
            )
            for name in (database.name, ledger_name):
                os.fsync(file(target, name))
            receipt_raw = backup._json(receipt) + b"\n"
            try:
                stage = file(
                    target, ".restore-receipt.tmp", os.O_CREAT | os.O_EXCL | os.O_WRONLY
                )
                with os.fdopen(os.dup(stage), "wb") as output:
                    output.write(receipt_raw)
                    output.flush()
                    os.fsync(output.fileno())
                os.write(
                    marker, hashlib.sha256(receipt_raw).hexdigest().encode() + b"\n"
                )
                os.fsync(marker)
                os.rename(
                    ".restore-receipt.tmp",
                    "restore-receipt.json",
                    src_dir_fd=target,
                    dst_dir_fd=target,
                )
                os.fsync(target)
            except BaseException:
                with suppress(OSError):
                    os.unlink("restore-receipt.json", dir_fd=target)
                    os.fsync(target)
                raise

        return receipt


def restore_database(settings, **kwargs):
    return _run(settings, verify=False, **kwargs)


def verify_restore(settings, **kwargs):
    return _run(settings, verify=True, **kwargs)


class _Parser(argparse.ArgumentParser):
    def exit(self, status=0, message=None):
        super().exit(2 if status == 0 else status, message)

    def error(self, message):
        self.exit(2, "RESTORE_USAGE_INVALID\n")


def main(command, argv):
    parser = _Parser(prog=f"python -m app.cli {command}", allow_abbrev=False)
    for flag in ("backup-dir", "identity-file", "ledger-file"):
        parser.add_argument(f"--{flag}", required=True)
    args = parser.parse_args(argv)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    previous, mask = {}, os.umask(0o077)
    interrupted_signal = None

    def interrupted(signum, _frame):
        nonlocal interrupted_signal
        interrupted_signal = signum
        for stop in (signal.SIGINT, signal.SIGTERM):
            signal.signal(stop, signal.SIG_IGN)
        raise backup.BackupInterrupted(signum)

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, interrupted)
        try:
            settings = Settings.from_environment()
        except ValueError:
            raise backup.BackupUsageError() from None
        _run(settings, verify=command == "verify-restore", **vars(args))
        print(STATUS)
        return 3
    except backup.BackupInterrupted as error:
        print("RESTORE_INTERRUPTED", file=sys.stderr)
        return 128 + error.signum
    except backup.BackupUsageError:
        print("RESTORE_USAGE_INVALID", file=sys.stderr)
        return 2
    except (
        ValueError,
        TypeError,
        KeyError,
        OSError,
        RuntimeError,
        sqlite3.Error,
        subprocess.SubprocessError,
        tarfile.TarError,
        MemoryError,
        CommandError,
        SQLAlchemyError,
    ):
        # SQLite callbacks translate a Python signal exception into sqlite3.Error.
        if interrupted_signal is not None:
            print("RESTORE_INTERRUPTED", file=sys.stderr)
            return 128 + interrupted_signal
        print("RESTORE_FAILED", file=sys.stderr)
        return 1
    finally:
        os.umask(mask)
        for signum, handler in previous.items():
            signal.signal(signum, handler)
