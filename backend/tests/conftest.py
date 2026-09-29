from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.support import populate_public_and_private_apps

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


@pytest.fixture
def migrate_test_database():
    def migrate(database_path: Path) -> None:
        env = {
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database_path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        }
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

    return migrate


@pytest.fixture
def seed_public_and_private_apps():
    return populate_public_and_private_apps
