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


def _assert_safe_startup_rejection(result, database_path: Path):
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "Application configuration or database revision is invalid." in output
    assert str(database_path) not in output


@pytest.mark.parametrize("environment", [{}, {"APP_ENV": ""}])
def test_development_environment_is_resolved_from_dotenv(tmp_path: Path, environment):
    backend = tmp_path / "backend"
    backend.mkdir()
    blocklist = tmp_path / "blocklist.txt"
    (backend / ".env").write_text(
        "APP_ENV=development\nDATABASE_PATH=storage/from-file.sqlite3\n"
        "PUBLIC_ORIGIN=http://localhost:5173\n"
        f"PASSWORD_BLOCKLIST_PATH={blocklist}\n"
    )
    original = environment.copy()
    settings = Settings.from_environment(
        environment, repo_root=tmp_path, backend_root=backend
    )
    assert settings.app_env == "development"
    assert settings.database_path == (tmp_path / "storage/from-file.sqlite3").resolve()
    assert settings.public_origin == "http://localhost:5173"
    assert settings.password_blocklist_path == blocklist.resolve()
    assert environment == original


@pytest.mark.parametrize(
    "dotenv", [None, "DATABASE_PATH=storage/dev.sqlite3\n", "APP_ENV=\n"]
)
@pytest.mark.parametrize("environment", [{}, {"APP_ENV": ""}])
def test_app_env_is_required_from_either_source(tmp_path: Path, dotenv, environment):
    backend = tmp_path / "backend"
    backend.mkdir()
    if dotenv is not None:
        (backend / ".env").write_text(dotenv)
    with pytest.raises(ConfigurationError, match="APP_ENV"):
        Settings.from_environment(environment, repo_root=tmp_path, backend_root=backend)


@pytest.mark.parametrize("process_app_env", ["development", "production"])
def test_environment_file_is_overridden_by_process_values(
    tmp_path: Path, process_app_env
):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(
        f"APP_ENV={'production' if process_app_env == 'development' else 'development'}\n"
        "DATABASE_PATH=storage/from-file.sqlite3\nPUBLIC_ORIGIN=http://localhost:5173\n"
        f"PASSWORD_BLOCKLIST_PATH={tmp_path / 'from-file.txt'}\n"
    )
    database = (
        tmp_path / "storage/from-process.sqlite3"
        if process_app_env == "development"
        else Path(tempfile.gettempdir()).parent / "operations.sqlite3"
    )
    origin = (
        "http://localhost:5174"
        if process_app_env == "development"
        else "https://archive.example.org"
    )
    blocklist = tmp_path / "from-process.txt"
    environment = {
        "APP_ENV": process_app_env,
        "DATABASE_PATH": str(database),
        "PUBLIC_ORIGIN": origin,
        "PASSWORD_BLOCKLIST_PATH": str(blocklist),
    }
    settings = Settings.from_environment(
        environment, repo_root=tmp_path, backend_root=backend
    )
    assert settings.app_env == process_app_env
    assert settings.database_path == database.resolve()
    assert settings.public_origin == origin
    assert settings.password_blocklist_path == blocklist.resolve()


def test_production_environment_is_resolved_from_dotenv(tmp_path: Path):
    backend = tmp_path / "backend"
    backend.mkdir()
    database = Path(tempfile.gettempdir()).parent / "operations.sqlite3"
    blocklist = tmp_path / "blocklist.txt"
    (backend / ".env").write_text(
        f"APP_ENV=production\nDATABASE_PATH={database}\n"
        f"PUBLIC_ORIGIN=https://archive.example.org\nPASSWORD_BLOCKLIST_PATH={blocklist}\n"
    )
    settings = Settings.from_environment({}, repo_root=tmp_path, backend_root=backend)
    assert settings.app_env == "production"
    assert settings.database_path == database.resolve()
    assert settings.public_origin == "https://archive.example.org"
    assert settings.password_blocklist_path == blocklist.resolve()


@pytest.mark.parametrize(
    ("database", "origin", "message"),
    [
        (None, "https://archive.example.org", "explicit"),
        ("outside", None, "explicit"),
        ("relative.sqlite3", "https://archive.example.org", "absolute"),
        ("repo", "https://archive.example.org", "outside the repository"),
        ("temporary", "https://archive.example.org", "temporary directory"),
        ("outside", "http://archive.example.org", "HTTPS"),
        ("outside", "https://localhost", "HTTPS"),
    ],
)
def test_production_dotenv_retains_validation(
    tmp_path: Path, database, origin, message
):
    backend = tmp_path / "backend"
    backend.mkdir()
    paths = {
        "outside": Path(tempfile.gettempdir()).parent / "operations.sqlite3",
        "repo": tmp_path / "storage/production.sqlite3",
        "temporary": tmp_path.parent / "production.sqlite3",
    }
    dotenv = "APP_ENV=production\n"
    if database is not None:
        dotenv += f"DATABASE_PATH={paths.get(database, database)}\n"
    if origin is not None:
        dotenv += f"PUBLIC_ORIGIN={origin}\n"
    (backend / ".env").write_text(dotenv)
    with pytest.raises(ConfigurationError, match=message):
        Settings.from_environment({}, repo_root=tmp_path, backend_root=backend)


@pytest.mark.parametrize("environment", [{}, {"APP_ENV": ""}])
def test_dotenv_cannot_select_test_environment(tmp_path: Path, environment):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text("APP_ENV=test\n")
    with pytest.raises(
        ConfigurationError, match="APP_ENV=test must be set in the process environment"
    ):
        Settings.from_environment(environment, repo_root=tmp_path, backend_root=backend)


@pytest.mark.parametrize(
    ("environment", "file_app_env"),
    [({"APP_ENV": "invalid"}, "development"), ({}, "invalid")],
)
def test_invalid_app_env_is_rejected(tmp_path: Path, environment, file_app_env):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(f"APP_ENV={file_app_env}\n")
    with pytest.raises(ConfigurationError, match="supported environment"):
        Settings.from_environment(environment, repo_root=tmp_path, backend_root=backend)


@pytest.mark.parametrize("explicit_settings", [False, True])
def test_test_environment_never_reads_development_dotenv(
    tmp_path: Path, monkeypatch, explicit_settings
):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(
        "APP_ENV=development\nDATABASE_PATH=storage/development.sqlite3\n"
        "PUBLIC_ORIGIN=http://localhost:5173\n"
    )

    def reject_dotenv_read(*args, **kwargs):
        raise AssertionError("test must not read backend/.env")

    monkeypatch.setattr("app.settings.dotenv_values", reject_dotenv_read)
    environment = {"APP_ENV": "test"}
    if explicit_settings:
        environment.update(
            DATABASE_PATH=str(tmp_path.parent / "test.sqlite3"),
            PUBLIC_ORIGIN="http://localhost:5174",
        )
        settings = Settings.from_environment(
            environment, repo_root=tmp_path, backend_root=backend
        )
        assert settings.app_env == "test"
        assert settings.database_path == (tmp_path.parent / "test.sqlite3").resolve()
        assert settings.public_origin == "http://localhost:5174"
    else:
        with pytest.raises(ConfigurationError, match="explicit"):
            Settings.from_environment(
                environment, repo_root=tmp_path, backend_root=backend
            )


def test_seed_accepts_development_selected_only_by_dotenv(tmp_path: Path, monkeypatch):
    from app import cli

    repo = tmp_path / "checkout"
    backend = repo / "backend"
    backend.mkdir(parents=True)
    database = repo / "storage/development.sqlite3"
    (backend / ".env").write_text(
        "APP_ENV=development\nDATABASE_PATH=storage/development.sqlite3\n"
    )
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert migration.returncode == 0, migration.stdout + migration.stderr
    for key in ("APP_ENV", "DATABASE_PATH", "PUBLIC_ORIGIN"):
        monkeypatch.delenv(key, raising=False)
    resolve_settings = Settings.from_environment
    monkeypatch.setattr(
        Settings,
        "from_environment",
        lambda: resolve_settings(repo_root=repo, backend_root=backend),
    )
    monkeypatch.setattr(cli, "ROOT", repo)
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True)
    settings = cli._development_database()
    assert settings.app_env == "development"
    assert settings.database_path == database.resolve()


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
            backend_root=tmp_path / "backend",
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
            backend_root=tmp_path / "backend",
        )

    with pytest.raises(ConfigurationError, match="HTTPS"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(outside),
                "PUBLIC_ORIGIN": "http://archive.example.org",
            },
            repo_root=tmp_path,
            backend_root=tmp_path / "backend",
        )

    settings = Settings.from_environment(
        {
            "APP_ENV": "production",
            "DATABASE_PATH": str(outside),
            "PUBLIC_ORIGIN": "https://archive.example.org",
        },
        repo_root=tmp_path,
        backend_root=tmp_path / "backend",
    )
    assert settings.database_path == outside.resolve()


def test_production_rejects_origin_with_whitespace_in_host(tmp_path: Path):
    database_path = Path(tempfile.gettempdir()).parent / "operations.sqlite3"
    with pytest.raises(ConfigurationError, match="exact HTTP origin"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(database_path),
                "PUBLIC_ORIGIN": "https://bad host",
            },
            repo_root=tmp_path,
            backend_root=tmp_path / "backend",
        )


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
            backend_root=tmp_path / "backend",
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
            backend_root=tmp_path / "backend",
        )


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:0",
        "http://localhost:99999",
        "http://localhost:not-a-port",
        "https://[malformed-ipv6",
        "https://[archive.example.org]",
        "https://-archive.example.org",
        "https://archive..example.org",
        "https://bad_host.example",
        "https://xn--a.example",
        "https://archive.example.org/",
        " https://archive.example.org",
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
            backend_root=tmp_path / "backend",
        )


@pytest.mark.parametrize(
    "origin",
    [
        "https://archive.example.org",
        "https://archive.example.org.",
        "http://192.0.2.1:8080",
        "https://[2001:db8::1]:8443",
        "https://bücher.example",
        "https://xn--bcher-kva.example",
    ],
)
def test_valid_dns_ip_and_idn_origins_are_preserved(tmp_path: Path, origin: str):
    settings = Settings.from_environment(
        {
            "APP_ENV": "test",
            "DATABASE_PATH": str(tmp_path.parent / "origin.sqlite3"),
            "PUBLIC_ORIGIN": origin,
        },
        repo_root=tmp_path,
        backend_root=tmp_path / "backend",
    )

    assert settings.public_origin == origin


def test_unmigrated_database_refuses_process_start_without_leaking_path(
    tmp_path: Path,
):
    database_path = tmp_path / "unmigrated.sqlite3"
    with sqlite3.connect(database_path):
        pass
    result = _run_application(database_path)
    _assert_safe_startup_rejection(result, database_path)
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
    _assert_safe_startup_rejection(result, database_path)


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
    _assert_safe_startup_rejection(result, database_path)


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
    _assert_safe_startup_rejection(result, database_path)
