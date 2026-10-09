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


@pytest.mark.parametrize("environment", [{}, {"APP_ENV": ""}])
def test_dotenv_cannot_select_production(tmp_path, environment):
    (tmp_path / ".env").write_text("APP_ENV=production\n")
    with pytest.raises(ConfigurationError, match="process environment"):
        Settings.from_environment(environment, backend_root=tmp_path)


@pytest.mark.parametrize("complete", [False, True])
def test_production_never_reads_dotenv(tmp_path, monkeypatch, complete):
    def reject_read(*args, **kwargs):
        raise AssertionError("production must not read dotenv")

    monkeypatch.setattr("app.settings.dotenv_values", reject_read)
    environment = {"APP_ENV": "production"}
    if complete:
        environment.update(
            DATABASE_PATH="/srv/eduvibe/data/api.sqlite3",
            PUBLIC_ORIGIN="https://archive.example.org",
        )
        settings = Settings.from_environment(environment, backend_root=tmp_path)
        assert not settings.health_checks_enabled
        assert settings.auth_activation_path is None
    else:
        with pytest.raises(ConfigurationError, match="explicit"):
            Settings.from_environment(environment, backend_root=tmp_path)


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
def test_production_process_configuration_retains_validation(
    tmp_path: Path, database, origin, message
):
    backend = tmp_path / "backend"
    backend.mkdir()
    paths = {
        "outside": Path(tempfile.gettempdir()).parent / "operations.sqlite3",
        "repo": tmp_path / "storage/production.sqlite3",
        "temporary": tmp_path.parent / "production.sqlite3",
    }
    environment = {"APP_ENV": "production"}
    if database is not None:
        environment["DATABASE_PATH"] = str(paths.get(database, database))
    if origin is not None:
        environment["PUBLIC_ORIGIN"] = origin
    with pytest.raises(ConfigurationError, match=message):
        Settings.from_environment(environment, repo_root=tmp_path, backend_root=backend)


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


@pytest.mark.parametrize(
    "updates",
    [
        {"AUTH_ACTIVATION_PATH": "relative.json", "APP_RELEASE_ID": "release-1"},
        {"AUTH_ACTIVATION_PATH": "/srv/eduvibe/auth.json"},
        {"AUTH_ACTIVATION_PATH": "/srv/eduvibe/auth.json", "APP_RELEASE_ID": " "},
        {"AUTH_ACTIVATION_PATH": "/srv/eduvibe/auth.json", "APP_RELEASE_ID": "x" * 257},
        {"AUTH_ACTIVATION_PATH": "/tmp/auth.json", "APP_RELEASE_ID": "release-1"},
        {"DATABASE_PATH": "/var/tmp/api.sqlite3"},
        {"DATABASE_PATH": "/dev/shm/api.sqlite3"},
    ],
)
def test_production_candidate_configuration_rejects_invalid_input(updates):
    with pytest.raises(ConfigurationError):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": "/srv/eduvibe/data/api.sqlite3",
                "PUBLIC_ORIGIN": "https://archive.example.org",
                **updates,
            }
        )


def test_candidate_configuration_accepts_explicit_release():
    settings = Settings.from_environment(
        {
            "APP_ENV": "production",
            "DATABASE_PATH": "/srv/eduvibe/data/api.sqlite3",
            "PUBLIC_ORIGIN": "https://archive.example.org",
            "AUTH_ACTIVATION_PATH": "/srv/eduvibe/data/auth.json",
            "APP_RELEASE_ID": "release-1",
        }
    )
    assert settings.auth_activation_path == Path("/srv/eduvibe/data/auth.json")
    assert settings.app_release_id == "release-1"


@pytest.mark.parametrize(
    "kind",
    [
        "valid",
        "missing",
        "mode",
        "owner",
        "directory",
        "symlink",
        "parent",
        "ancestor",
        "wal",
        "shm",
    ],
)
def test_production_storage_permissions(tmp_path, monkeypatch, kind):
    from types import SimpleNamespace

    private = tmp_path / "data"
    private.mkdir(mode=0o700)
    database = private / "api.sqlite3"
    database.write_bytes(b"")
    database.chmod(0o600)
    if kind == "missing":
        database.unlink()
    elif kind == "mode":
        database.chmod(0o644)
    elif kind == "directory":
        database.unlink()
        database.mkdir()
    elif kind == "symlink":
        target = private / "target"
        target.write_bytes(b"")
        target.chmod(0o600)
        database.unlink()
        database.symlink_to(target)
    elif kind == "parent":
        private.chmod(0o755)
    elif kind in {"wal", "shm"}:
        sidecar = Path(f"{database}-{kind}")
        sidecar.write_bytes(b"")
        sidecar.chmod(0o644)
    # Only metadata/open calls are mapped. No actual production file is accessed.
    virtual = Path("/srv/eduvibe-synthetic/data")
    real_stat, real_lstat, real_open, real_fstat = (
        Path.stat,
        Path.lstat,
        os.open,
        os.fstat,
    )

    def mapped(path):
        if path.is_relative_to(virtual):
            return private / path.relative_to(virtual)
        if path == virtual.parent:
            return tmp_path
        return path

    def lstat(path, *args, **kwargs):
        result = real_lstat(mapped(path), *args, **kwargs)
        if kind == "ancestor" and path == virtual.parent:
            return SimpleNamespace(st_mode=result.st_mode | 0o002, st_uid=result.st_uid)
        return result

    def fstat(descriptor):
        result = real_fstat(descriptor)
        if kind == "owner":
            return SimpleNamespace(st_mode=result.st_mode, st_uid=os.geteuid() + 1)
        return result

    monkeypatch.setattr(
        Path,
        "stat",
        lambda path, *args, **kwargs: real_stat(mapped(path), *args, **kwargs),
    )
    monkeypatch.setattr(Path, "lstat", lstat)
    monkeypatch.setattr(
        os,
        "open",
        lambda path, flags, *args, **kwargs: real_open(
            mapped(Path(path)), flags, *args, **kwargs
        ),
    )
    monkeypatch.setattr(os, "fstat", fstat)
    settings = Settings(
        app_env="production",
        database_path=virtual / "api.sqlite3",
        public_origin="https://archive.example.test",
    )
    if kind == "valid":
        settings.validate_production_runtime()
    else:
        with pytest.raises(ConfigurationError):
            settings.validate_production_runtime()


@pytest.mark.parametrize(
    "updates",
    [
        {"database_path": Path("relative.sqlite3")},
        {"database_path": Path("/tmp/production.sqlite3")},
        {"public_origin": "http://archive.example.test"},
        {"auth_activation_path": Path("/srv/eduvibe/data/auth.json")},
    ],
)
def test_explicit_production_settings_cannot_bypass_startup_guard(
    tmp_path, monkeypatch, updates
):
    from fastapi.testclient import TestClient

    from app.main import create_app

    def reject_open(*args):
        raise AssertionError("invalid production settings opened a database")

    monkeypatch.setattr("app.main.make_engine", reject_open)
    settings = Settings(
        app_env="production",
        database_path=Path("/srv/eduvibe/data/api.sqlite3"),
        public_origin="https://archive.example.test",
    ).model_copy(update=updates)
    with (
        pytest.raises(
            RuntimeError,
            match="Application configuration or database revision is invalid",
        ),
        TestClient(create_app(settings)),
    ):
        pass


@pytest.mark.parametrize(
    "origin",
    [
        "https://localhost",
        "https://sub.localhost.",
        "https://127.0.0.2",
        "https://[::1]",
        "https://[::ffff:127.0.0.1]",
        "https://[::ffff:7f00:1]",
    ],
)
def test_production_rejects_loopback_origin_matrix(origin):
    with pytest.raises(ConfigurationError, match="HTTPS"):
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": "/srv/eduvibe/data/api.sqlite3",
                "PUBLIC_ORIGIN": origin,
            }
        )


@pytest.mark.parametrize("value", [None, "", " \t\n"])
def test_support_settings_empty_is_null(tmp_path, value):
    environment = {
        "APP_ENV": "test",
        "DATABASE_PATH": str(tmp_path / "support.sqlite3"),
        "PUBLIC_ORIGIN": "http://localhost:5174",
    }
    if value is not None:
        environment.update(
            dict.fromkeys(
                ["SUPPORT_EMAIL", "SUPPORT_SERVICE_URL", "SUPPORT_ANNOUNCEMENT_URL"],
                value,
            )
        )
    settings = Settings.from_environment(environment)
    assert (
        settings.support_email,
        settings.support_service_url,
        settings.support_announcement_url,
    ) == (None, None, None)


@pytest.mark.parametrize(
    "support",
    [
        {"SUPPORT_EMAIL": "support+archive@example.test"},
        {"SUPPORT_SERVICE_URL": "https://service.example.test/help?q=archive#contact"},
        {"SUPPORT_ANNOUNCEMENT_URL": "https://notice.example.test/updates"},
        {
            "SUPPORT_EMAIL": "support@example.test",
            "SUPPORT_SERVICE_URL": "https://service.example.test/help",
            "SUPPORT_ANNOUNCEMENT_URL": "https://notice.example.test/updates",
        },
    ],
)
def test_support_settings_preserve_public_values(tmp_path, support):
    settings = Settings.from_environment(
        {
            "APP_ENV": "test",
            "DATABASE_PATH": str(tmp_path / "support.sqlite3"),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            **support,
        }
    )
    assert settings.support_email == support.get("SUPPORT_EMAIL")
    assert settings.support_service_url == support.get("SUPPORT_SERVICE_URL")
    assert settings.support_announcement_url == support.get("SUPPORT_ANNOUNCEMENT_URL")


@pytest.mark.parametrize(
    "value",
    [
        "name <support@example.test>",
        "a@example.test,b@example.test",
        "mailto:a@example.test",
        "a..b@example.test",
        ".a@example.test",
        "a@example.test?subject=x",
        "a#b@example.test",
        "a%b@example.test",
        "a@-example.test",
        "a@localhost",
        "한글@example.test",
        " a@example.test",
        "a@example.test\n",
        "a\x7f@example.test",
    ],
)
def test_invalid_support_email_configuration_is_rejected(tmp_path, value):
    with pytest.raises(ConfigurationError) as failure:
        Settings.from_environment(
            {
                "APP_ENV": "test",
                "DATABASE_PATH": str(tmp_path / "support.sqlite3"),
                "PUBLIC_ORIGIN": "http://localhost:5174",
                "SUPPORT_EMAIL": value,
            }
        )
    assert value not in str(failure.value)


@pytest.mark.parametrize("field", ["SUPPORT_SERVICE_URL", "SUPPORT_ANNOUNCEMENT_URL"])
@pytest.mark.parametrize(
    "value",
    [
        "http://service.example.test/help",
        "//service.example.test/help",
        "javascript:alert(1)",
        "data:text/html,x",
        "mailto:a@example.test",
        "https://",
        "https://user:pass@service.example.test/",
        "https://-bad.test/",
        "https://service.example.test:0/",
        "https://service.example.test:65536/",
        "https://service.example.test:bad/",
        "https://service.example.test:/",
        "https://[::1",
        "https://[::1]suffix/",
        "https://999.1.1.1/",
        "https://service.example.test/white space",
        "https://service.example.test/\n",
        "https://service.example.test/\x7f",
        "https://service.example.test\\evil/",
        " https://service.example.test/",
        "https://service.example.test/%ZZ",
    ],
)
def test_invalid_support_url_configuration_is_rejected(tmp_path, field, value):
    with pytest.raises(ConfigurationError) as failure:
        Settings.from_environment(
            {
                "APP_ENV": "test",
                "DATABASE_PATH": str(tmp_path / "support.sqlite3"),
                "PUBLIC_ORIGIN": "http://localhost:5174",
                field: value,
            }
        )
    assert value not in str(failure.value)


def test_support_validation_rejects_direct_settings(tmp_path):
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="Support"):
        Settings(
            app_env="test",
            database_path=tmp_path / "support.sqlite3",
            public_origin="http://localhost:5174",
            support_email="invalid",
        )
