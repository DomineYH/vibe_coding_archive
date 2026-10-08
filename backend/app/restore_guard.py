"""Persistent restore isolation, checked before any service database access."""

import os
from pathlib import Path

MARKER = ".restore-blocked"


def restore_blocked(database: Path) -> bool:
    try:
        os.lstat(database.parent / MARKER)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True
