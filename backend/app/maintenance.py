"""Explicit durable migration latch; only an operator may remove it."""

import os

from app.restore_guard import MIGRATION_MARKER
from app.safe_logging import emit
from app.settings import private_directory


def block(settings) -> int:
    emit("MIGRATION_MAINTENANCE_REQUIRED")
    try:
        parent = settings.database_path.parent
        private_directory(parent)
        descriptor = os.open(
            parent / MIGRATION_MARKER,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        try:
            os.fchmod(descriptor, 0o600)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except (OSError, ValueError):
        # Never remove a reserved marker, even when durability is uncertain.
        return 1
    return 0
