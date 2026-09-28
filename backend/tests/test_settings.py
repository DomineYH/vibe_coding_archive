from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.settings import ConfigurationError, Settings

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def test_app_env_is_required_from_process_environment(tmp_path: Path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(
        "APP_ENV=development\nDATABASE_PATH=storage/development.sqlite3\n"
    )

    with pytest.raises(ConfigurationError, match="APP_ENV"):
        Settings.from_environment({}, repo_root=tmp_path, backend_root=backend)


def test_development_environment_file_is_overridden_by_process_values(
    tmp_path: Path,
):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(
        "DATABASE_PATH=storage/from-file.sqlite3\nPUBLIC_ORIGIN=http://localhost:5173\n"
    )

    settings = Settings.from_environment(
        {
            "APP_ENV": "development",
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        repo_root=tmp_path,
        backend_root=backend,
    )

    assert (
        settings.database_path == (tmp_path / "storage" / "from-file.sqlite3").resolve()
    )
    assert settings.public_origin == "http://localhost:5174"


def test_test_environment_does_not_fall_back_to_development_dotenv(
    tmp_path: Path,
):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(
        "DATABASE_PATH=/tmp/development.sqlite3\nPUBLIC_ORIGIN=http://localhost:5174\n"
    )

    with pytest.raises(ConfigurationError, match="explicit"):
        Settings.from_environment(
            {"APP_ENV": "test"}, repo_root=tmp_path, backend_root=backend
        )


def test_production_rejects_development_origin_and_repository_database(
    tmp_path: Path,
):
    outside = tmp_path.parent / "operations.sqlite3"
    with pytest.raises(ConfigurationError, match="outside the repository"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(tmp_path / "storage" / "production.sqlite3"),
                "PUBLIC_ORIGIN": "http://localhost:5174",
            },
            repo_root=tmp_path,
        )

    with pytest.raises(ConfigurationError, match="HTTPS"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(outside),
                "PUBLIC_ORIGIN": "http://archive.example.org",
            },
            repo_root=tmp_path,
        )

    settings = Settings.from_environment(
        {
            "APP_ENV": "production",
            "DATABASE_PATH": str(outside),
            "PUBLIC_ORIGIN": "https://archive.example.org",
        },
        repo_root=tmp_path,
    )
    assert settings.database_path == outside.resolve()


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:0",
        "http://localhost:99999",
        "http://localhost:not-a-port",
        "https://[malformed-ipv6",
        "https://archive.example.org?",
        "https://archive.example.org#",
    ],
)
def test_invalid_public_origin_is_reported_as_configuration_error(
    tmp_path: Path, origin: str
):
    with pytest.raises(ConfigurationError, match="exact HTTP origin"):
        Settings.from_environment(
            {
                "APP_ENV": "test",
                "DATABASE_PATH": str(tmp_path.parent / "api.sqlite3"),
                "PUBLIC_ORIGIN": origin,
            },
            repo_root=tmp_path,
        )


def test_unmigrated_database_refuses_process_start_without_leaking_path(
    tmp_path: Path,
):
    database_path = tmp_path / "unmigrated.sqlite3"
    with sqlite3.connect(database_path):
        pass
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
        ],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database_path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )

    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "Application configuration or database revision is invalid." in output
    assert str(tmp_path) not in output
    with sqlite3.connect(database_path) as connection:
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
            == []
        )
