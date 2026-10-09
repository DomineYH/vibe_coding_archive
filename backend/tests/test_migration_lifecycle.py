"""Explicit commands and real process boundaries over isolated persistent storage."""

import fcntl
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest

from tests.support import populate_public_and_private_apps
from tests.test_backup import backup_case, run_backup  # noqa: F401

BACKEND = Path(__file__).resolve().parents[1]


def environment(database):
    return {
        **os.environ,
        "APP_ENV": "test",
        "DATABASE_PATH": str(database),
        "PUBLIC_ORIGIN": "http://localhost:5174",
        "HEALTH_CHECKS_ENABLED": "false",
    }


def command(database, *args, release=BACKEND):
    return subprocess.run(
        [sys.executable, "-m", *args],
        cwd=release,
        env=environment(database),
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )


@contextmanager
def api(database, release=BACKEND):
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-m", "app.api", "--port", str(port)],
        cwd=release,
        env=environment(database),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=2) as client:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                assert process.poll() is None, "API refused startup"
                try:
                    if client.get("/healthz").status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                time.sleep(0.05)
            else:
                raise AssertionError("API never became live")
            yield client
    finally:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=15)


def assert_blocked(database):
    with api(database) as client:
        assert client.get("/healthz").status_code == 200
        for endpoint in (
            "/readyz",
            "/api/v1/apps",
            "/api/v1/auth/me",
            "/api/v1/admin/users",
        ):
            assert client.get(endpoint).status_code == 503
    worker = command(database, "app.health_worker")
    assert worker.returncode != 0
    assert "MIGRATION_MAINTENANCE_REQUIRED" in worker.stderr


def test_maintenance_block_precedes_database_access_and_survives_restart(tmp_path):
    database = tmp_path / "absent.sqlite3"
    result = command(database, "app.cli", "maintenance-block")
    assert result.returncode == 0, result.stderr
    marker = tmp_path / ".migration-blocked"
    assert marker.is_file()
    assert marker.stat().st_mode & 0o777 == 0o600
    assert not database.exists()

    for _ in range(2):
        assert_blocked(database)
        assert marker.exists()
        assert not database.exists()
    with api(database) as client:
        marker.unlink()
        assert client.get("/readyz").status_code == 503
        assert client.get("/api/v1/apps").status_code == 503
    assert not database.exists()


def rows(database, tables):
    with sqlite3.connect(database) as db:
        return {
            table: sorted(db.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
            for table in tables
        }


def state(database):
    with sqlite3.connect(database) as db:
        schema = db.execute(
            "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"
        ).fetchall()
        tables = [
            row[0]
            for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        ]
    return schema, rows(database, tables)


def integrity(database, revision="0012_health_checks"):
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT version_num FROM alembic_version").fetchall() == [
            (revision,)
        ]
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("initial", [None, "0011_user_delete", "head"])
def test_explicit_upgrade_empty_and_existing_database(tmp_path, initial):
    database = tmp_path / "database.sqlite3"
    if initial:
        assert command(database, "alembic", "upgrade", initial).returncode == 0
        populate_public_and_private_apps(database)
        original = rows(database, ("members", "apps", "app_grades"))
    assert command(database, "alembic", "upgrade", "head").returncode == 0
    integrity(database)
    if initial:
        assert rows(database, original) == original
    upgraded = state(database)
    assert command(database, "alembic", "upgrade", "head").returncode == 0
    assert state(database) == upgraded


@pytest.mark.parametrize(
    "revision", [None, "0011_user_delete", "unknown", "9999_future"]
)
@pytest.mark.parametrize("entrypoint", ["app.api", "app.health_worker"])
def test_api_and_worker_refuse_wrong_revision_without_migrating(
    tmp_path, revision, entrypoint
):
    database = tmp_path / "wrong.sqlite3"
    if revision == "0011_user_delete":
        assert command(database, "alembic", "upgrade", revision).returncode == 0
        populate_public_and_private_apps(database)
    else:
        # Deliberately invalid synthetic metadata, never used to fake release compatibility.
        with sqlite3.connect(database) as db:
            if revision:
                db.execute("CREATE TABLE alembic_version(version_num TEXT NOT NULL)")
                db.execute("INSERT INTO alembic_version VALUES (?)", (revision,))
    original = state(database)
    result = command(database, entrypoint)
    assert result.returncode != 0
    assert not result.stdout
    assert (
        "WORKER_FAILED" in result.stderr
        if entrypoint.endswith("worker")
        else "DIAGNOSTIC_SUPPRESSED" in result.stderr
    )
    assert state(database) == original
    if entrypoint.endswith("worker"):
        precedence = subprocess.run(
            [
                sys.executable,
                "-c",
                'import asyncio\nfrom app.health_worker import serve, ActivationRequired\nfrom app.settings import Settings\ntry:\n    asyncio.run(serve(Settings.from_environment()))\nexcept RuntimeError as error:\n    assert not isinstance(error, ActivationRequired)\n    assert str(error) == "Database migration revision is not current."\n    raise SystemExit(17)\nraise SystemExit(0)\n',
            ],
            cwd=BACKEND,
            env=environment(database),
            check=False,
            capture_output=True,
            timeout=15,
        )
        assert precedence.returncode == 17


@pytest.mark.parametrize(
    "unsafe", ["directory", "symlink", "hardlink", "nonregular", "existing"]
)
def test_maintenance_block_refuses_unsafe_paths_and_preserves_restore_quarantine(
    tmp_path, unsafe
):
    database = tmp_path / "database.sqlite3"
    marker = tmp_path / ".migration-blocked"
    restore = tmp_path / ".restore-blocked"
    restore.write_bytes(b"permanent quarantine")
    if unsafe == "directory":
        tmp_path.chmod(0o755)
    elif unsafe == "symlink":
        marker.symlink_to(restore)
    elif unsafe == "hardlink":
        os.link(restore, marker)
    elif unsafe == "nonregular":
        os.mkfifo(marker, 0o600)
    else:
        marker.write_bytes(b"existing marker")
    before = marker.lstat() if unsafe != "directory" else None
    result = command(database, "app.cli", "maintenance-block")
    assert result.returncode == 1
    assert restore.read_bytes() == b"permanent quarantine"
    assert not database.exists()
    if before:
        assert marker.lstat().st_ino == before.st_ino
    assert not any(
        value in result.stderr
        for value in (str(tmp_path), "permanent quarantine", "Traceback")
    )
    tmp_path.chmod(0o700)
    with api(database) as client:
        assert client.get("/readyz").status_code == 503
    if marker.exists() or marker.is_symlink():
        marker.unlink()
    with api(database) as client:
        assert client.get("/api/v1/apps").status_code == 503
    assert restore.exists()


def test_concurrent_maintenance_reservation_and_uncertain_fsync_remain_blocked(
    tmp_path,
):
    database = tmp_path / "database.sqlite3"
    children = [
        subprocess.Popen(
            [sys.executable, "-m", "app.cli", "maintenance-block"],
            cwd=BACKEND,
            env=environment(database),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for _ in range(2)
    ]
    for child in children:
        stdout, stderr = child.communicate(timeout=15)
        assert not stdout
        assert "MIGRATION_MAINTENANCE_REQUIRED" in stderr.decode()
    assert sorted(child.returncode for child in children) == [0, 1]
    assert_blocked(database)
    (tmp_path / ".migration-blocked").unlink()
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import os, sys\nfrom app.cli import main\nsys.argv = ['cli', 'maintenance-block']\ndef fail(*args):\n    raise OSError('secret SQL path sentinel')\nos.fsync = fail\nraise SystemExit(main())\n",
        ],
        cwd=BACKEND,
        env=environment(database),
        check=False,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 1
    assert b"secret SQL path sentinel" not in result.stderr
    assert_blocked(database)


def copied_release(directory):
    directory.mkdir(mode=0o700)
    (directory / "contracts").symlink_to(
        BACKEND.parent / "contracts", target_is_directory=True
    )
    directory = directory / "backend"
    directory.mkdir(mode=0o700)
    shutil.copytree(
        BACKEND / "alembic",
        directory / "alembic",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    shutil.copyfile(BACKEND / "alembic.ini", directory / "alembic.ini")
    shutil.copytree(
        BACKEND / "app", directory / "app", ignore=shutil.ignore_patterns("__pycache__")
    )
    return directory


@pytest.mark.parametrize("phase", ["before", "during", "after"])
def test_migration_failure_or_loss_retains_maintenance(tmp_path, backup_case, phase):  # noqa: F811
    database = backup_case[0] if phase == "before" else tmp_path / "older.sqlite3"
    if phase != "before":
        assert (
            command(database, "alembic", "upgrade", "0011_user_delete").returncode == 0
        )
        populate_public_and_private_apps(database)
    original = state(database)
    business = rows(database, ("members", "apps", "app_grades"))
    ledger = backup_case[0].with_suffix(".deletions.sqlite3")
    ledger_original = state(ledger)
    assert command(database, "app.cli", "maintenance-block").returncode == 0
    if phase == "before":
        result = run_backup(backup_case)
        assert result.returncode == 3
        assert result.stdout == "LOCAL_ONLY_REMOTE_NOT_CONFIRMED\n"
        # The operator stops on any nonzero result; no upgrade/release command follows.
        assert state(database) == original
    elif phase == "during":
        release = copied_release(tmp_path / "interrupted-release")
        revision = release / "alembic" / "versions" / "0012_health_checks.py"
        barrier = tmp_path / "ddl-reached"
        source = revision.read_text()
        # Barrier after the actual DDL/backfill, before Alembic commits its transaction.
        index = source.index("\ndef downgrade()")
        source = (
            source[:index]
            + f"\n    from pathlib import Path\n    import time\n    Path({str(barrier)!r}).touch()\n    while True: time.sleep(.01)\n"
            + source[index:]
        )
        revision.write_text(source)
        process = subprocess.Popen(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=release,
            env=environment(database),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.monotonic() + 15
            while not barrier.exists():
                assert process.poll() is None
                assert time.monotonic() < deadline
                time.sleep(0.02)
            process.kill()
            assert process.wait(timeout=10) == -signal.SIGKILL
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
        integrity(database, "0011_user_delete")
        assert state(database) == original
    else:
        assert command(database, "alembic", "upgrade", "head").returncode == 0
        integrity(database)
    assert rows(database, business) == business
    assert state(ledger) == ledger_original
    assert (tmp_path / ".migration-blocked").exists()
    assert_blocked(database)
    if phase == "after":
        (tmp_path / ".migration-blocked").unlink()
        with api(database) as client:
            assert client.get("/readyz").status_code == 200
            assert client.get("/api/v1/apps").status_code == 200


def test_downgrade_and_incompatible_release_refuse_without_data_changes(
    tmp_path, migrate_test_database
):
    database = tmp_path / "database.sqlite3"
    migrate_test_database(database)
    populate_public_and_private_apps(database)
    original = state(database)
    assert command(database, "alembic", "downgrade", "0011_user_delete").returncode != 0
    assert state(database) == original
    release = copied_release(tmp_path / "old-release")
    (release / "alembic" / "versions" / "0012_health_checks.py").unlink()
    head = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.database import current_head; print(current_head())",
        ],
        cwd=release,
        env=environment(database),
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert head.stdout.strip() == "0011_user_delete"
    imported = subprocess.run(
        [sys.executable, "-c", "import app.main; print('loaded')"],
        cwd=release,
        env=environment(database),
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert imported.returncode == 0 and imported.stdout.strip() == "loaded"
    for entrypoint in ("app.api", "app.health_worker"):
        assert command(database, entrypoint, release=release).returncode != 0
        assert state(database) == original


def test_release_switch_and_restart_preserve_business_data_and_ledger(
    member_app, password_blocklist, tmp_path
):
    from tests.app_create_client import INPUT
    from tests.app_delete_client import delete, delete_key
    from tests.app_update_client import detail, registered, update, update_key
    from tests.auth_client import signed_in
    from tests.auth_process import AuthProcess
    from tests.contracts.test_admin_approval import headers

    _, database = member_app()
    releases = []
    for name in ("release-one", "release-two"):
        release = tmp_path / name
        release.symlink_to(BACKEND, target_is_directory=True)
        releases.append(release)
    current = tmp_path / "current"
    current.symlink_to(releases[0], target_is_directory=True)
    server = AuthProcess(database, password_blocklist, release=current)
    ledger = database.with_suffix(".deletions.sqlite3")
    migration_lock = tmp_path / ".migration.lock"
    descriptor = migration_lock.open("w+")
    migration_lock.chmod(0o600)
    lock_inode = migration_lock.stat().st_ino
    try:
        server.start()
        with server.client() as client:
            owner = signed_in(client)
            created = registered(
                owner, {**INPUT, "prompt": "line 1  \n\n  line 2\t", "is_public": False}
            )
            key = update_key(owner, created["id"])
            assert update(owner, created["id"], key).status_code == 200
            expected = detail(owner, created["id"]).json()["item"]
            disposable = registered(owner)
            assert (
                delete(
                    owner, disposable["id"], delete_key(owner, disposable["id"])
                ).status_code
                == 204
            )
            cookie_jar = dict(client.cookies)
            auth_headers = headers(owner)
            business = rows(database, ("members", "apps", "app_grades"))
            evidence = state(ledger)
            assert len(evidence[1]["completed_app_delete_events"]) == 1
        assert command(database, "app.cli", "maintenance-block").returncode == 0
        server.kill()
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        contender = subprocess.run(
            [
                "flock",
                "--exclusive",
                "--nonblock",
                str(migration_lock),
                sys.executable,
                "-c",
                "pass",
            ],
            cwd=releases[1],
            env=environment(database),
            check=False,
            capture_output=True,
            timeout=15,
        )
        assert contender.returncode == 1
        assert (
            command(
                database, "alembic", "upgrade", "head", release=releases[1]
            ).returncode
            == 0
        )
        integrity(database)
        selection = tmp_path / "next"
        selection.symlink_to(releases[1], target_is_directory=True)
        os.replace(selection, current)
        directory = os.open(tmp_path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        server.start()
        with server.client() as client:
            client.cookies.update(cookie_jar)
            assert (
                client.get(
                    f"/api/v1/apps/{created['id']}", headers=auth_headers
                ).status_code
                == 503
            )
            assert client.get("/api/v1/apps").status_code == 503
        assert rows(database, business) == business
        assert state(ledger) == evidence
        server.kill()
        (tmp_path / ".migration-blocked").unlink()
        server.start()
        with server.client() as client:
            client.cookies.update(cookie_jar)
            assert client.get("/readyz").status_code == 200
            assert (
                client.get(
                    f"/api/v1/apps/{created['id']}", headers=auth_headers
                ).json()["item"]
                == expected
            )
            assert (
                client.get(
                    f"/api/v1/apps/{disposable['id']}", headers=auth_headers
                ).status_code
                == 404
            )
            assert (
                client.get("/api/v1/auth/me", headers=auth_headers).status_code == 200
            )
        assert rows(database, business) == business
        assert state(ledger) == evidence
        assert current.readlink() == releases[1]
        assert migration_lock.stat().st_ino == lock_inode
    finally:
        server.close()
        descriptor.close()
