"""Local owned backup pairs only; expiry is original expiry minus one day."""

import fcntl
import hashlib
import json
import os
import stat
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.backup import (
    BackupUsageError,
    _directory,
    _file,
    _utc,
    _uuid,
    validate_manifest_structure,
)


class BackupPurgeError(RuntimeError):
    def __init__(self, removed):
        self.removed = removed
        super().__init__("BACKUP_PURGE_FAILED")


def purge_backups(settings, *, backup_dir, now=None):
    instant = datetime.now(UTC) if now is None else now
    removed = 0
    with ExitStack() as stack:
        root = _directory(Path(backup_dir), test=settings.app_env == "test")
        stack.callback(os.close, root)
        lock = _file(root, ".backup.lock", os.O_CREAT | os.O_RDWR)
        stack.callback(os.close, lock)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            for name in sorted(os.listdir(root)):
                staged = name.startswith(".purge-")
                run_id = name.removeprefix(".purge-") if staged else name
                if not _uuid(run_id):
                    if name == ".backup.lock" or name.startswith(".stage-"):
                        continue
                    raise BackupUsageError()
                with ExitStack() as pair:
                    fd = os.open(
                        name,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                        dir_fd=root,
                    )
                    pair.callback(os.close, fd)
                    info = os.fstat(fd)
                    if (
                        info.st_uid != os.getuid()
                        or stat.S_IMODE(info.st_mode) != 0o700
                    ):
                        raise BackupUsageError()
                    files = set(os.listdir(fd))
                    if staged and not files:
                        os.rmdir(name, dir_fd=root)
                        os.fsync(root)
                        removed += 1
                        continue
                    if files != {"manifest.json", "backup.tar.age"} and not (
                        staged and files == {"manifest.json"}
                    ):
                        raise BackupUsageError()
                    manifest_fd = _file(fd, "manifest.json")
                    with os.fdopen(manifest_fd, "rb") as source:
                        raw = source.read(65537)
                    if len(raw) > 65536:
                        raise BackupUsageError()
                    manifest = json.loads(raw)
                    validate_manifest_structure(manifest, now=instant)
                    if manifest["run_id"] != run_id:
                        raise BackupUsageError()
                    eligible = (
                        _utc(manifest["original_expires_at"]) - timedelta(days=1)
                        <= instant
                    )
                    if staged and not eligible:
                        raise BackupUsageError()
                    if "backup.tar.age" in files:
                        with os.fdopen(_file(fd, "backup.tar.age"), "rb") as ciphertext:
                            if (
                                os.fstat(ciphertext.fileno()).st_size
                                != manifest["ciphertext"]["bytes"]
                                or hashlib.file_digest(ciphertext, "sha256").hexdigest()
                                != manifest["ciphertext"]["sha256"]
                            ):
                                raise BackupUsageError()
                    if not eligible:
                        continue
                    if not staged:
                        stage = ".purge-" + run_id
                        if stage in os.listdir(root):
                            raise BackupUsageError()
                        os.rename(name, stage, src_dir_fd=root, dst_dir_fd=root)
                        name = stage
                        os.fsync(root)
                    # Manifest survives until ciphertext removal is durable, so retry keeps its clock.
                    if "backup.tar.age" in files:
                        os.unlink("backup.tar.age", dir_fd=fd)
                        os.fsync(fd)
                    os.unlink("manifest.json", dir_fd=fd)
                    os.fsync(fd)
                    os.rmdir(name, dir_fd=root)
                    os.fsync(root)
                    removed += 1
        except Exception:  # noqa: BLE001 - Report completed pairs without exception content.
            raise BackupPurgeError(removed) from None
    return removed
