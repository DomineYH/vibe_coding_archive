"""Observational local checks; no application startup or maintenance transitions."""

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from app import app_deletion_ledger, user_deletion_ledger
from app.auth_runtime import runtime_enabled as auth_enabled
from app.backup import _directory, _file, _read_only, _uuid, validate_manifest_structure
from app.database import current_head
from app.health_runtime import boot_clock
from app.password_reset_secret import load_secret, unique_object
from app.restore_guard import maintenance_blocked


@contextmanager
def read_only(path, *, test=False):
    parent = _directory(Path(path).parent, test=test)
    try:
        descriptor = _file(parent, Path(path).name)
        os.close(descriptor)
        for suffix in ("-wal", "-shm"):
            try:
                descriptor = _file(parent, Path(path).name + suffix)
            except FileNotFoundError:
                continue
            os.close(descriptor)
        db = _read_only(parent, Path(path).name)
        try:
            db.execute("PRAGMA busy_timeout=5000")
            db.execute("PRAGMA query_only=ON")
            db.set_authorizer(
                lambda action, a, b, *_: (
                    sqlite3.SQLITE_OK
                    if action
                    in {
                        sqlite3.SQLITE_SELECT,
                        sqlite3.SQLITE_READ,
                        sqlite3.SQLITE_FUNCTION,
                        sqlite3.SQLITE_TRANSACTION,
                    }
                    or action == sqlite3.SQLITE_PRAGMA
                    and a
                    in {"table_info", "index_info", "index_list", "foreign_key_list"}
                    else sqlite3.SQLITE_DENY
                )
            )
            db.execute("BEGIN")
            yield db
        finally:
            db.close()
    finally:
        os.close(parent)


def observations(path, *, test, instant):
    try:
        path = Path(path)
        parent = _directory(path.parent, test=test)
        try:
            descriptor = _file(parent, path.name)
            with os.fdopen(descriptor, "rb") as source:
                raw = source.read(65537)
        finally:
            os.close(parent)
        if len(raw) > 65536:
            raise ValueError()
        value = json.loads(raw, object_pairs_hook=unique_object)
        required = {"version", "checked_at", "evidence_id"}
        optional = {
            "db_busy_5min",
            "alarm_delivery",
            "cost_month",
            "prepaid_spent",
            "contract_expires_at",
        }
        if (
            not isinstance(value, dict)
            or not required <= value.keys()
            or value.keys() - required - optional
            or type(value["version"]) is not int
            or value["version"] != 1
            or str(UUID(value["evidence_id"])) != value["evidence_id"]
        ):
            raise ValueError()
        checked = utc(value["checked_at"])
        if not timedelta(0) <= instant - checked <= timedelta(minutes=15):
            raise ValueError()
        for key in ("db_busy_5min", "cost_month", "prepaid_spent"):
            if key in value and (type(value[key]) is not int or value[key] < 0):
                raise ValueError()
        if "alarm_delivery" in value and value["alarm_delivery"] not in (
            "CONFIRMED",
            "FAILED",
        ):
            raise ValueError()
        if "contract_expires_at" in value:
            utc(value["contract_expires_at"])
        return value
    except (
        OSError,
        ValueError,
        TypeError,
        AttributeError,
        UnicodeError,
        RecursionError,
    ):
        return {}


def utc(value):
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() != timedelta(0):
        raise ValueError()
    return parsed


def backup_checks(path, *, test, instant):
    checks = dict.fromkeys(
        ("backup", "rpo", "retention", "remote", "backup_attempt"), "UNCONFIRMED"
    )
    valid = []
    invalid = 0
    root = _directory(Path(path), test=test)
    try:
        for name in os.listdir(root):
            if name == ".backup.lock":
                continue
            if not _uuid(name):
                invalid += 1
                continue
            try:
                parent = _directory(Path(path) / name, test=test)
                try:
                    fd = _file(parent, "manifest.json")
                    with os.fdopen(fd, "rb") as source:
                        raw = source.read(65537)
                    if len(raw) > 65536:
                        raise ValueError()
                    manifest = json.loads(raw, object_pairs_hook=unique_object)
                    validate_manifest_structure(manifest, now=instant)
                    if manifest["run_id"] != name:
                        raise ValueError()
                    fd = _file(parent, "backup.tar.age")
                    with os.fdopen(fd, "rb") as source:
                        info = os.fstat(source.fileno())
                        digest = hashlib.file_digest(source, "sha256").hexdigest()
                    if {"bytes": info.st_size, "sha256": digest} != manifest[
                        "ciphertext"
                    ]:
                        raise ValueError()
                    valid.append(manifest)
                finally:
                    os.close(parent)
            except (OSError, ValueError, TypeError, KeyError):
                invalid += 1
    finally:
        os.close(root)
    if valid:
        latest = max(utc(m["recovery_point_at"]) for m in valid)
        checks["backup"] = "LOCAL_ONLY"
        checks["rpo"] = "RESTRICT" if instant - latest > timedelta(hours=24) else "OK"
        deadlines = [utc(m["original_expires_at"]) for m in valid]
        checks["retention"] = (
            "EXPIRED"
            if any(instant >= d for d in deadlines)
            else "CLEANUP_DUE"
            if any(instant >= d - timedelta(days=1) for d in deadlines)
            else "OK"
        )
    if invalid:
        checks["backup"] = "FAILURE"
    return checks, {"backups_valid": len(valid), "backups_invalid": invalid}


def ledger_check(database, *, test):
    path = database.with_suffix(".deletions.sqlite3")
    if not path.exists() and not path.is_symlink():
        return "UNCONFIRMED"
    with read_only(database, test=test) as source, read_only(path, test=test) as ledger:
        source.row_factory = sqlite3.Row
        app_deletion_ledger._verify(
            source.execute("SELECT * FROM app_delete_outbox").fetchall(),
            app_deletion_ledger._events(ledger),
            restored=True,
        )
        events = user_deletion_ledger._events(ledger)
        user_deletion_ledger.groups(events.values())
        rows = source.execute("SELECT * FROM user_delete_outbox").fetchall()
        user_deletion_ledger.groups(rows)
        for row in rows:
            if events.get(row["event_id"]) != {
                field: row[field] for field in user_deletion_ledger.FIELDS
            }:
                return "RESTRICT"
        for table, column in (
            ("member_deletions", "member_id"),
            ("app_deletions", "app_id"),
        ):
            known = dict(ledger.execute(f"SELECT {column},deleted_at FROM {table}"))
            if any(
                known.get(r[0]) != r[1]
                for r in source.execute(f"SELECT {column},deleted_at FROM {table}")
            ):
                return "RESTRICT"
    # A local match cannot establish independent evidence continuity or copy inventory.
    return "LOCAL_ONLY"


def ops_check(
    settings,
    *,
    backup_dir,
    observations_file=None,
    required_free_bytes=None,
    instant=None,
):
    instant = datetime.now(UTC) if instant is None else instant
    checks = dict.fromkeys(
        ("db_busy", "alarm", "cost", "prepaid", "contract", "ledger"), "UNCONFIRMED"
    )
    checks["database"] = "FAILURE"
    supplied = observations(
        observations_file, test=settings.app_env == "test", instant=instant
    )
    if "db_busy_5min" in supplied:
        checks["db_busy"] = "RESTRICT" if supplied["db_busy_5min"] >= 5 else "OBSERVED"
    if "alarm_delivery" in supplied:
        checks["alarm"] = (
            "OBSERVED" if supplied["alarm_delivery"] == "CONFIRMED" else "FAILURE"
        )
    if "cost_month" in supplied:
        cost = supplied["cost_month"]
        checks["cost"] = (
            "CAP_REACHED"
            if cost >= 50000
            else "RESTRICT"
            if cost >= 45000
            else "WARN"
            if cost >= 40000
            else "OBSERVED"
        )
    if "prepaid_spent" in supplied:
        checks["prepaid"] = (
            "CAP_REACHED" if supplied["prepaid_spent"] >= 100000 else "OBSERVED"
        )
    if "contract_expires_at" in supplied:
        remaining = utc(supplied["contract_expires_at"]) - instant
        checks["contract"] = (
            "RESTRICT"
            if remaining <= timedelta(days=7)
            else "WARN"
            if remaining <= timedelta(days=30)
            else "OBSERVED"
        )
    counts = {}
    checks.update(dict.fromkeys(("worker", "queue", "headroom"), "UNCONFIRMED"))
    checks["runtime"] = "UNCONFIRMED"
    checks["auth_configuration"] = (
        "ELIGIBLE" if auth_enabled(settings) else "UNCONFIRMED"
    )
    checks["maintenance"] = (
        "RESTRICT" if maintenance_blocked(settings.database_path) else "ABSENT"
    )
    checks["reset_supply"] = "UNCONFIRMED"
    if settings.password_reset_hmac_path is not None:
        path = settings.password_reset_hmac_path
        try:
            parent = _directory(path.parent, test=settings.app_env == "test")
            try:
                fd = _file(parent, path.name)
                os.close(fd)
                if load_secret(path) is not None:
                    checks["reset_supply"] = "PRESENT"
            finally:
                os.close(parent)
        except (OSError, ValueError):
            pass
    checks["health_configuration"] = (
        "DISABLED" if not settings.health_checks_enabled else "UNCONFIRMED"
    )
    failed = False
    try:
        with read_only(settings.database_path, test=settings.app_env == "test") as db:
            checks["database"] = (
                "OK"
                if db.execute("SELECT version_num FROM alembic_version").fetchall()
                == [(current_head(),)]
                else "RESTRICT"
            )
            boot, mono = boot_clock()
            db.row_factory = sqlite3.Row
            worker = db.execute(
                "SELECT * FROM health_worker WHERE singleton=1"
            ).fetchone()
            if worker:
                expired = db.execute(
                    "SELECT 1 FROM health_jobs WHERE status='running' AND (boot_id<>? OR worker_id<>? OR lease_deadline<=?) LIMIT 1",
                    (boot, worker["worker_id"], mono),
                ).fetchone()
                checks["worker"] = (
                    "OK"
                    if worker["ready"]
                    and worker["boot_id"] == boot
                    and 0 <= mono - worker["heartbeat_mono"] < 15
                    and not expired
                    else "RESTRICT"
                )
            stamp = instant.isoformat(timespec="microseconds").replace("+00:00", "Z")
            cutoff = (
                (instant - timedelta(days=1))
                .isoformat(timespec="microseconds")
                .replace("+00:00", "Z")
            )
            jobs = db.execute(
                """SELECT j.created_at,c.next_check_at FROM health_jobs j JOIN apps a ON a.id=j.app_id
                LEFT JOIN health_cooldowns c ON c.app_id=j.app_id
                WHERE j.status='queued' AND j.url_version=a.url_version AND j.attempts<2
                AND j.created_at>? AND (c.next_check_at IS NULL OR c.next_check_at<=?)""",
                (cutoff, stamp),
            ).fetchall()
            counts["executable_queue"] = len(jobs)
            stalled = sum(
                instant
                - max(
                    utc(j["created_at"]),
                    utc(j["next_check_at"])
                    if j["next_check_at"]
                    else utc(j["created_at"]),
                )
                >= timedelta(minutes=5)
                for j in jobs
            )
            counts["stalled_queue"] = stalled
            checks["queue"] = "RESTRICT" if stalled else "OK"
    except sqlite3.Error as error:
        busy = getattr(error, "sqlite_errorcode", 0) & 255 in (
            sqlite3.SQLITE_BUSY,
            sqlite3.SQLITE_LOCKED,
        )
        checks["database"] = "DB_BUSY" if busy else "FAILURE"
        failed = not busy
    except (OSError, ValueError, RuntimeError, TypeError):
        checks["database"] = "FAILURE"
        failed = True
    try:
        spaces = [
            os.statvfs(path)
            for path in (settings.database_path.parent, Path(backup_dir))
        ]
        used = max(
            (space.f_blocks - space.f_bavail) * 100 / space.f_blocks for space in spaces
        )
        free = min(space.f_bavail * space.f_frsize for space in spaces)
        checks["disk"] = "RESTRICT" if used >= 90 else "WARN" if used >= 80 else "OK"
        if required_free_bytes is not None:
            checks["headroom"] = "RESTRICT" if free < required_free_bytes else "OK"
    except (OSError, ValueError, ZeroDivisionError):
        checks["disk"] = "FAILURE"
        failed = True
    try:
        backup_status, backup_counts = backup_checks(
            backup_dir, test=settings.app_env == "test", instant=instant
        )
        checks.update(backup_status)
        counts.update(backup_counts)
    except (OSError, ValueError, TypeError):
        checks.update(
            dict.fromkeys(
                ("backup", "rpo", "retention", "remote", "backup_attempt"),
                "UNCONFIRMED",
            )
        )
        checks["backup"] = "FAILURE"
        failed = True
    try:
        checks["ledger"] = ledger_check(
            settings.database_path, test=settings.app_env == "test"
        )
    except (OSError, ValueError, RuntimeError, sqlite3.Error):
        checks["ledger"] = "FAILURE"
        failed = True
    return {
        "evidence_id": str(uuid4()),
        "checks": checks,
        "counts": counts,
    }, 1 if failed else 3


def main(settings, **kwargs):
    result, status = ops_check(settings, **kwargs)
    fields = {
        "database",
        "db_busy",
        "alarm",
        "cost",
        "prepaid",
        "contract",
        "ledger",
        "worker",
        "queue",
        "headroom",
        "runtime",
        "auth_configuration",
        "maintenance",
        "reset_supply",
        "health_configuration",
        "disk",
        "backup",
        "rpo",
        "retention",
        "remote",
        "backup_attempt",
    }
    codes = {
        "OK",
        "WARN",
        "RESTRICT",
        "UNCONFIRMED",
        "FAILURE",
        "OBSERVED",
        "CAP_REACHED",
        "DB_BUSY",
        "DISABLED",
        "ELIGIBLE",
        "ABSENT",
        "PRESENT",
        "LOCAL_ONLY",
        "CLEANUP_DUE",
        "EXPIRED",
    }
    if (
        set(result) != {"evidence_id", "checks", "counts"}
        or str(UUID(result["evidence_id"])) != result["evidence_id"]
        or UUID(result["evidence_id"]).version != 4
        or result["checks"].keys() - fields
        or any(code not in codes for code in result["checks"].values())
        or result["counts"].keys()
        - {"executable_queue", "stalled_queue", "backups_valid", "backups_invalid"}
        or any(
            type(count) is not int or count < 0 for count in result["counts"].values()
        )
    ):
        raise ValueError("OPS_OUTPUT_INVALID")
    print(json.dumps(result, separators=(",", ":")))
    return status
