"""Persistent restore isolation, checked before any service database access."""

import os
from pathlib import Path

MARKER = ".restore-blocked"
MIGRATION_MARKER = ".migration-blocked"


def restore_blocked(database: Path) -> bool:
    try:
        os.lstat(database.parent / MARKER)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True


def maintenance_blocked(database: Path) -> bool:
    """Compose resumable migration maintenance with permanent restore quarantine."""
    if restore_blocked(database):
        return True
    try:
        os.lstat(database.parent / MIGRATION_MARKER)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True
