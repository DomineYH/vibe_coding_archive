from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from app.settings import ConfigurationError, Settings

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def _test_environment(database_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "APP_ENV": "test",
        "DATABASE_PATH": str(database_path),
        "PUBLIC_ORIGIN": "http://localhost:5174",
    }


def _run_application(database_path: Path, *, bootstrap: str | None = None):
    command = (
        [sys.executable, "-c", bootstrap]
        if bootstrap is not None
        else [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
        ]
    )
    return subprocess.run(
        command,
        cwd=BACKEND,
        env=_test_environment(database_path),
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )


def _assert_safe_startup_rejection(result, temporary_path: Path):
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "Application configuration or database revision is invalid." in output
    assert str(temporary_path) not in output


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


@pytest.mark.parametrize(
    "database_path",
    [
        Path(tempfile.gettempdir()) / "shared.sqlite3",
        Path(tempfile.gettempdir()).parent / "persistent.sqlite3",
    ],
)
def test_test_environment_requires_a_dedicated_temporary_database(
    tmp_path: Path, database_path: Path
):
    with pytest.raises(ConfigurationError, match="temporary directory"):
        Settings.from_environment(
            {
                "APP_ENV": "test",
                "DATABASE_PATH": str(database_path),
                "PUBLIC_ORIGIN": "http://localhost:5174",
            },
            repo_root=tmp_path,
        )


def test_production_rejects_development_origin_and_repository_database(
    tmp_path: Path,
):
    outside = Path(tempfile.gettempdir()).parent / "operations.sqlite3"
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


def test_production_rejects_temporary_database_path(tmp_path: Path):
    with pytest.raises(ConfigurationError, match="temporary directory"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(
                    Path(tempfile.gettempdir()) / "production.sqlite3"
                ),
                "PUBLIC_ORIGIN": "https://archive.example.org",
            },
            repo_root=tmp_path,
        )


def test_production_rejects_loopback_origin_with_trailing_dns_dot(tmp_path: Path):
    with pytest.raises(ConfigurationError, match="HTTPS"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(
                    Path(tempfile.gettempdir()).parent / "operations.sqlite3"
                ),
                "PUBLIC_ORIGIN": "https://localhost.",
            },
            repo_root=tmp_path,
        )


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
    result = _run_application(database_path)
    _assert_safe_startup_rejection(result, tmp_path)
    with sqlite3.connect(database_path) as connection:
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
            == []
        )


def test_persistent_database_path_refuses_test_process_start_safely(
    tmp_path: Path,
):
    database_path = Path(tempfile.gettempdir()).parent / "persistent.sqlite3"
    result = _run_application(database_path)
    _assert_safe_startup_rejection(result, tmp_path)


def test_unknown_database_revision_refuses_process_start_safely(tmp_path: Path):
    database_path = tmp_path / "unknown-revision.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"
        )
        connection.execute(
            "INSERT INTO alembic_version (version_num) VALUES (?)",
            ("revision-not-in-this-build",),
        )

    result = _run_application(database_path)
    _assert_safe_startup_rejection(result, tmp_path)


def test_database_revision_mismatch_refuses_process_start_safely(
    tmp_path: Path,
):
    database_path = tmp_path / "mismatched-revision.sqlite3"
    environment = _test_environment(database_path)
    migration = subprocess.run(
        ["uv", "run", "--frozen", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert migration.returncode == 0, migration.stdout + migration.stderr

    bootstrap = """\
import app.database
app.database.current_head = lambda: 'another-expected-revision'
import uvicorn
uvicorn.run('app.main:app', host='127.0.0.1', port=0)
"""
    result = _run_application(database_path, bootstrap=bootstrap)
    _assert_safe_startup_rejection(result, tmp_path)
