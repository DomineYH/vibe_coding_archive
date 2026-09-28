from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI

from app.main import create_app
from app.settings import Settings

ROOT = Path(__file__).resolve().parents[3]
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
def make_test_app(migrate_test_database):
    def make(database_path: Path) -> FastAPI:
        migrate_test_database(database_path)
        env = {
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database_path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        }
        settings = Settings.from_environment(env, repo_root=ROOT)
        return create_app(settings)

    return make
