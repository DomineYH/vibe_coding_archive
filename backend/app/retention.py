"""Independent clocks and local maintenance; no legal classification or copy inventory."""

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import text

from app import health_store
from app.auth_maintenance import sweep
from app.database import (
    current_head,
    current_revision,
    make_engine,
    make_session_factory,
)
from app.health_runtime import boot_clock, runtime_enabled
from app.settings import ConfigurationError


def request_log_eligible(occurred_at, now):
    return occurred_at + timedelta(days=7) <= now


def audit_eligible(occurred_at, now, *, classification):
    if classification == "ordinary":
        return occurred_at + timedelta(days=90) <= now
    if classification == "legal_access":
        # Calendar anniversary: February 29 clamps to February 28 next year.
        try:
            anniversary = occurred_at.replace(year=occurred_at.year + 1)
        except ValueError:
            anniversary = occurred_at.replace(year=occurred_at.year + 1, day=28)
        return anniversary <= now
    return False


def ledger_eligible(copy_expiries, now):
    return bool(copy_expiries) and max(copy_expiries) + timedelta(days=7) <= now


# ponytail: audit/ledger deletion is blocked until T11 classification and T10 trusted copy inventory exist.
def purge_expired(settings, *, backup_dir):
    from app.backup import BackupUsageError, _directory
    from app.backup_retention import BackupPurgeError, purge_backups

    counts = {}
    codes = ["AUDIT_CLASSIFICATION_BLOCKED", "LEDGER_INVENTORY_BLOCKED"]
    result = 3
    engine = None
    try:
        settings.validate_production_runtime()
        root = _directory(Path(backup_dir), test=settings.app_env == "test")
        os.close(root)
        if not settings.database_path.is_file():
            raise BackupUsageError()
        engine = make_engine(settings.database_path)
        if current_revision(engine) != current_head():
            raise RuntimeError("PURGE_REVISION_INVALID")
        factory = make_session_factory(engine)
        with factory() as db:
            before = db.execute(text("SELECT count(*) FROM members")).scalar_one()
        sweep(factory)
        counts["auth_sweeps_completed"] = 1
        with factory() as db:
            counts["members_removed"] = max(
                0,
                before - db.execute(text("SELECT count(*) FROM members")).scalar_one(),
            )
            db.execute(text("BEGIN IMMEDIATE"))
            before = db.execute(text("SELECT count(*) FROM health_jobs")).scalar_one()
            boot, mono = boot_clock()
            stamp = datetime.now(UTC)
            if not runtime_enabled(settings):
                health_store.cancel_all(db, stamp)
            health_store.maintain(db, boot_id=boot, mono=mono, stamp=stamp)
            after = db.execute(text("SELECT count(*) FROM health_jobs")).scalar_one()
            db.commit()
            counts["health_jobs_removed"] = max(0, before - after)
            counts["health_sweeps_completed"] = 1
        counts["backups_removed"] = purge_backups(settings, backup_dir=backup_dir)
    except (BackupUsageError, ConfigurationError):
        codes.insert(0, "PURGE_USAGE_INVALID")
        result = 2
    except BackupPurgeError as failure:
        counts["backups_removed"] = failure.removed
        codes.insert(0, "PURGE_FAILED")
        result = 1
    except Exception:  # noqa: BLE001 - Partial progress is explicit; never exception text.
        codes.insert(0, "PURGE_FAILED")
        result = 1
    finally:
        if engine is not None:
            engine.dispose()
    print(json.dumps({"counts": counts, "codes": codes}))
    return result
