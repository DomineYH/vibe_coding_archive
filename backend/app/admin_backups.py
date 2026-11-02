"""Administrator backup run and manifest-only listing inside the API process."""

import asyncio
import fcntl
import json
import os
from contextlib import suppress
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from app import backup
from app.admin_approval import administrator
from app.auth import Db
from app.auth_boundary import AuthError, now, response
from app.health_api import empty_body, no_query

router = APIRouter()
ENTRY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _configured(settings):
    """Both paths set and passing backup_database's root/recipient/source-DB policy."""
    if settings.backup_root is None or settings.backup_recipient_file is None:
        return False
    try:
        backup.check_paths(
            settings,
            output_dir=settings.backup_root,
            recipient_file=settings.backup_recipient_file,
        )
    except (OSError, backup.BackupUsageError):
        return False
    return True


def _release_id(settings):
    # APP_RELEASE_ID is mandatory in production backup.env; development falls back to the env name.
    return settings.app_release_id or settings.app_env


def _root(settings):
    return backup._directory(settings.backup_root, test=settings.app_env == "test")


def _probe_lock(settings):
    """BackupUsageError -> not configured, BlockingIOError -> another holder."""
    root = _root(settings)
    try:
        lock = backup._file(root, ".backup.lock", os.O_CREAT | os.O_RDWR)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # released by close()
        finally:
            os.close(lock)
    finally:
        os.close(root)


def _manifest(root, name):
    fd = os.open(name, ENTRY, dir_fd=root)
    try:
        with os.fdopen(backup._file(fd, "manifest.json"), "rb") as handle:
            raw = handle.read(65537)
    finally:
        os.close(fd)
    if len(raw) > 65536:
        raise ValueError()
    manifest = json.loads(raw)
    # Structure only: expired-but-unpurged pairs still list, as in ops-check.
    backup.validate_manifest_structure(manifest)
    if manifest["run_id"] != name:
        raise ValueError()
    return manifest


def _listing(settings):
    """Reads each manifest.json only; never opens backup.tar.age."""
    items, invalid = [], 0
    root = _root(settings)
    try:
        for name in sorted(os.listdir(root)):
            if name == ".backup.lock" or name.startswith((".stage-", ".purge-")):
                continue
            try:
                if not backup._uuid(name):
                    raise ValueError()
                manifest = _manifest(root, name)
            except (OSError, ValueError, TypeError):
                invalid += 1
                continue
            items.append(
                {
                    "run_id": name,
                    "created_at": manifest["created_at"],
                    "original_expires_at": manifest["original_expires_at"],
                    "ciphertext_bytes": manifest["ciphertext"]["bytes"],
                    "release_id": manifest["release_id"],
                    "revision": manifest["revision"],
                    "status": backup.STATUS,
                }
            )
    finally:
        os.close(root)
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return items, invalid


async def _run(app, run, actor_id):
    settings = app.state.settings
    try:
        await asyncio.to_thread(
            backup.backup_database,
            settings,
            output_dir=settings.backup_root,
            recipient_file=settings.backup_recipient_file,
            release_id=_release_id(settings),
            run_id=run["run_id"],
        )
        outcome = "local_only"
    except (BlockingIOError, backup.BackupUsageError):
        outcome = (
            "rejected"  # lock lost to the CLI/timer after the probe, or unsafe paths
        )
    except Exception:  # noqa: BLE001 - fixed outcome only; exception text never leaves the process
        outcome = "failed"

    def audit():
        with app.state.session_factory() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            db.execute(
                text(
                    "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('backup_create',:actor,:target,:now,:outcome)"
                ),
                {
                    "actor": actor_id,
                    "target": run["run_id"],
                    "now": now(),
                    "outcome": outcome,
                },
            )
            db.commit()

    # ponytail: an audit write failure is not retried; the run state is still visible via GET.
    with suppress(Exception):
        await asyncio.to_thread(audit)
    run["state"] = outcome  # last, so a finished GET implies the audit attempt is done


@router.get("/admin/backups", operation_id="listAdminBackups")
def list_backups(request: Request, db=Db):
    no_query(request)
    item, _member = administrator(db, request)
    settings = request.app.state.settings
    body = {
        "configured": False,
        "current": request.app.state.backup_run,
        "items": [],
        "invalid_count": 0,
    }
    if _configured(settings):
        try:
            body["items"], body["invalid_count"] = _listing(settings)
            body["configured"] = True
        except (OSError, backup.BackupUsageError):
            pass  # root changed after the check == not configured, never 500
    return response(db, request, body, metadata=item, private=True)


@router.post(
    "/admin/backups",
    operation_id="createAdminBackup",
    dependencies=[Depends(empty_body)],
)
def create_backup(request: Request, db=Db):
    no_query(request)
    item, actor = administrator(db, request, write=True)
    state = request.app.state
    not_configured = AuthError(
        "BACKUP_NOT_CONFIGURED", 409, message="백업이 구성되지 않았어요."
    )
    if not _configured(state.settings):
        raise not_configured
    with state.backup_guard:
        if state.backup_run and state.backup_run["state"] == "running":
            raise AuthError(
                "BACKUP_IN_PROGRESS", 409, message="이미 백업이 실행 중이에요."
            )
        try:
            _probe_lock(state.settings)
        except BlockingIOError:
            raise AuthError(
                "BACKUP_IN_PROGRESS", 409, message="이미 백업이 실행 중이에요."
            ) from None
        except (OSError, backup.BackupUsageError):
            raise not_configured from None
        run = {"run_id": str(uuid4()), "state": "running", "started_at": now()}
        state.backup_run = run
    asyncio.run_coroutine_threadsafe(_run(request.app, run, actor["id"]), state.loop)
    return response(db, request, dict(run), status=202, metadata=item, private=True)
