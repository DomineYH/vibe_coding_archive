"""Observable process output is the security boundary, not exception text."""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SECRET = "T06_PASSWORD_HASH_SESSION_RECOVERY_CSRF_HMAC_EMAIL_PHONE_BODY_QUERY"
FORGED_ID = "00000000-0000-4000-8000-000000000200"


def process(code=None, *, args=(), env=None):
    return subprocess.run(
        [sys.executable, *(["-c", code] if code else ["-m", "app.cli"]), *args],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "HEALTH_CHECKS_ENABLED": "false",
            **(env or {}),
        },
        capture_output=True,
        check=False,
        timeout=30,
    )


def excludes_secrets(output):
    absent = SECRET.encode() not in output
    assert absent, "sensitive sentinel escaped into process output"


def test_cli_usage_excludes_untrusted_arguments():
    result = process(args=(SECRET,))
    assert result.returncode == 2
    excludes_secrets(result.stdout + result.stderr)


def test_foreign_logging_never_formats_message_arguments_or_extras():
    result = process(
        """
import logging
from app.safe_logging import install, emit
install()
class Hostile:
    def __str__(self): raise RuntimeError('"""
        + SECRET
        + """')
    __repr__ = __str__
try:
    raise RuntimeError('"""
        + SECRET
        + """')
except RuntimeError:
    logging.getLogger('third.party').exception('%s', Hostile(), stack_info=True,
        extra={'password': '"""
        + SECRET
        + """', '_safe_event': {'code': 'REQUEST_COMPLETED', 'route': '"""
        + SECRET
        + """'}})
    logging.getLogger('eduvibe.safe').error('"""
        + SECRET
        + """', extra={'_safe_event': {'code': 'REQUEST_COMPLETED', 'route': '"""
        + SECRET
        + """'}})
emit('CLI_COMPLETED')
"""
    )
    assert result.returncode == 0
    excludes_secrets(result.stdout + result.stderr)
    import json

    events = [json.loads(line) for line in result.stderr.splitlines()]
    assert [event["code"] for event in events] == [
        "DIAGNOSTIC_SUPPRESSED",
        "DIAGNOSTIC_SUPPRESSED",
        "CLI_COMPLETED",
    ]


import json
import socket
import sqlite3
import time
from contextlib import contextmanager

import httpx
import pytest


@contextmanager
def running_api(member_app, *, restore_marked=False):
    _, database = member_app()
    if restore_marked:
        marker = database.parent / ".restore-blocked"
        marker.write_text(SECRET)
        marker.chmod(0o600)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    code = (
        """
from app.safe_logging import install
install()
import asyncio, logging, sqlite3
from fastapi import Request, Response
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from app.main import create_app
from app.settings import Settings
from app.auth_boundary import AuthError
from app.api import run
app = create_app(Settings.from_environment(), auth_testing=True)
@app.post('/drill/{item}')
def drill(item: str, request: Request, response: Response, mode: str = 'normal', number: int = 1):
    logging.getLogger('remote').error('REMOTE_RESPONSE_"""
        + SECRET
        + """')
    if mode == 'exception':
        raise OperationalError('SELECT """
        + SECRET
        + """', {'password': '"""
        + SECRET
        + """'}, sqlite3.OperationalError('"""
        + SECRET
        + """'))
    if mode == 'busy':
        try:
            with app.state.session_factory() as db:
                db.execute(text('BEGIN IMMEDIATE'))
        except SQLAlchemyError:
            raise AuthError('DB_BUSY', 503) from None
    response.set_cookie('sensitive', '"""
        + SECRET
        + """')
    return {'remote': '"""
        + SECRET
        + """'}
@app.get('/task')
async def task():
    async def failed(): raise RuntimeError('"""
        + SECRET
        + """')
    asyncio.create_task(failed())
    await asyncio.sleep(0.05)
    return {'ok': True}
raise SystemExit(run(app, port="""
        + str(port)
        + "))\n"
    )
    child = subprocess.Popen(
        [sys.executable, "-c", code],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "HEALTH_CHECKS_ENABLED": "false",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    captured = []
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=12) as client:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                assert child.poll() is None, "safe API exited during startup"
                try:
                    if client.get("/healthz").status_code == 200:
                        break
                except httpx.TransportError:
                    time.sleep(0.05)
            else:
                pytest.fail("safe API startup timed out")
            yield client, database, captured
    finally:
        if child.poll() is None:
            child.terminate()
        stdout, stderr = child.communicate(timeout=15)
        captured.append(stdout + stderr)
        excludes_secrets(stdout + stderr)
        assert child.returncode in (0, -15), "safe API shutdown failed"


@pytest.mark.parametrize(
    ("mode", "status"),
    [("normal", 200), ("validation", 422), ("busy", 503), ("exception", 500)],
)
def test_real_api_output_excludes_secrets_on_every_result(member_app, mode, status):
    with (
        running_api(member_app) as (client, database, captured),
        sqlite3.connect(database) as lock,
    ):
        if mode == "busy":
            lock.execute("BEGIN IMMEDIATE")
        response = client.post(
            f"/drill/{SECRET}",
            params={
                "mode": mode,
                "number": SECRET if mode == "validation" else "1",
                "query": SECRET,
            },
            headers={
                "X-Request-Id": FORGED_ID,
                "Authorization": SECRET,
                "X-CSRF-Token": SECRET,
                "Cookie": f"S={SECRET}; R={SECRET}",
                "X-HMAC": SECRET,
                "X-Email": SECRET,
                "X-Phone": SECRET,
            },
            content=SECRET,
        )
        assert response.status_code == status
    events = [
        json.loads(line) for line in captured[0].splitlines() if line.startswith(b"{")
    ]
    completed = [
        event
        for event in events
        if event["code"] == "REQUEST_COMPLETED" and event["route"] == "/drill/{item}"
    ]
    assert len(completed) == 1
    assert completed[0]["status"] == status
    assert completed[0]["duration_ms"] >= 0
    from uuid import UUID

    assert UUID(completed[0]["run_id"]).version == 4
    assert completed[0]["run_id"] != FORGED_ID


def test_unmatched_body_limit_and_background_failures_use_safe_events(member_app):
    with running_api(member_app) as (client, _, captured):
        assert (
            client.get(
                f"/missing/{SECRET}?bad=%ZZ", headers={"X-Request-Id": SECRET}
            ).status_code
            == 404
        )
        assert (
            client.post(
                "/api/v1/auth/flows",
                content=SECRET,
                headers={"Content-Type": "application/json"},
            ).status_code
            == 400
        )
        assert (
            client.post("/api/v1/auth/flows", content=SECRET * 3000).status_code == 413
        )
        assert client.get("/task").status_code == 200
    events = [
        json.loads(line) for line in captured[0].splitlines() if line.startswith(b"{")
    ]
    assert any(e.get("route") == "unmatched" and e.get("status") == 404 for e in events)
    assert any(e.get("status") == 413 for e in events)
    assert any(e["code"] == "BACKGROUND_FAILED" for e in events)


@pytest.mark.parametrize("entry", ["app.cli", "app.health_worker", "app.api"])
def test_invalid_configuration_has_no_traceback(entry):
    result = process(
        code=f"import runpy; runpy.run_module('{entry}', run_name='__main__')",
        args=("sweep-pending",) if entry == "app.cli" else (),
        env={"APP_ENV": SECRET},
    )
    assert result.returncode != 0
    excludes_secrets(result.stdout + result.stderr)
    assert b"Traceback" not in result.stderr


def test_api_startup_failure_excludes_lifespan_exception(tmp_path):
    result = process(
        code="from app.api import run; raise SystemExit(run())",
        env={
            "DATABASE_PATH": str(tmp_path / (SECRET + ".sqlite3")),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
    )
    assert result.returncode != 0
    excludes_secrets(result.stdout + result.stderr)
    assert b"Traceback" not in result.stderr


def test_cli_database_busy_keeps_nonzero_safe_exit(member_app):
    _, database = member_app()
    with sqlite3.connect(database) as lock:
        lock.execute("BEGIN IMMEDIATE")
        result = process(
            args=("sweep-pending",),
            env={
                "DATABASE_PATH": str(database),
                "PUBLIC_ORIGIN": "http://localhost:5174",
            },
        )
    assert result.returncode == 1
    excludes_secrets(result.stdout + result.stderr)
    assert b"Traceback" not in result.stderr


def test_worker_disabled_startup_excludes_database_and_configuration_values(member_app):
    _, database = member_app()
    result = process(
        code="from app.health_worker import main; raise SystemExit(main())",
        env={
            "DATABASE_PATH": str(database),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "HEALTH_WORKER_LOCK_PATH": "/tmp/" + SECRET,
        },
    )
    assert result.returncode == 1
    excludes_secrets(result.stdout + result.stderr)
    assert b"WORKER_FAILED" in result.stderr


def test_sqlalchemy_hides_bound_parameters(tmp_path):
    from sqlalchemy import text
    from sqlalchemy.exc import SQLAlchemyError

    from app.database import make_engine

    engine = make_engine(tmp_path / "empty.sqlite3")
    try:
        with engine.connect() as connection, pytest.raises(SQLAlchemyError) as failure:
            connection.execute(
                text("SELECT * FROM missing WHERE password=:password"),
                {"password": SECRET},
            )
        excludes_secrets(str(failure.value).encode())
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("boundary", "failure"),
    [("cli", "ValueError"), ("worker", "RuntimeError"), ("worker", "cleanup")],
)
def test_process_boundary_sanitizes_external_input_database_and_cleanup_errors(
    member_app, boundary, failure
):
    _, database = member_app()
    if boundary == "cli":
        code = (
            """
import sys
from unittest.mock import patch
from app.cli import main
sys.argv = ['app.cli', 'bootstrap-admin']
with patch('sys.stdin.isatty', return_value=True), patch('sys.stdout.isatty', return_value=True), patch('builtins.input', side_effect=ValueError('"""
            + SECRET
            + """')):
    raise SystemExit(main())
"""
        )
    else:
        method = "dispose" if failure == "cleanup" else "connect"
        code = (
            """
from unittest.mock import patch
from app.health_worker import main
with patch('sqlalchemy.engine.Engine."""
            + method
            + """', side_effect=OSError('"""
            + SECRET
            + """')):
    raise SystemExit(main())
"""
        )
    result = process(
        code=code,
        env={"DATABASE_PATH": str(database), "PUBLIC_ORIGIN": "http://localhost:5174"},
    )
    assert result.returncode == 1
    excludes_secrets(result.stdout + result.stderr)
    assert b"Traceback" not in result.stderr
    expected = b"CLI_FAILED" if boundary == "cli" else b"WORKER_FAILED"
    assert expected in result.stderr


def test_cli_usage_has_a_generated_run_id():
    from uuid import UUID

    result = process(args=(SECRET,))
    events = [
        json.loads(line) for line in result.stderr.splitlines() if line.startswith(b"{")
    ]
    assert len(events) == 1
    assert events[0]["code"] == "CLI_USAGE_INVALID"
    assert UUID(events[0]["run_id"]).version == 4


def test_restore_latch_logs_safe_decision_and_every_blocked_request(member_app):
    with running_api(member_app, restore_marked=True) as (client, database, captured):
        assert client.get("/readyz").status_code == 503
        response = client.get("/api/v1/apps/" + SECRET, params={"query": SECRET})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
        (database.parent / ".restore-blocked").unlink()
        assert client.get("/api/v1/auth/state").status_code == 503
        assert client.get("/readyz").status_code == 503
    events = [json.loads(line) for line in captured[0].splitlines()]
    assert sum(event["code"] == "RESTORE_MAINTENANCE_REQUIRED" for event in events) == 1
    completions = [event for event in events if event["code"] == "REQUEST_COMPLETED"]
    assert sum(event["status"] == 503 for event in completions) == 4
    assert all(event["route"] in ("unmatched", "/healthz") for event in completions)


def test_restore_latch_restores_previous_loop_exception_handler(tmp_path):
    (tmp_path / ".restore-blocked").write_text(SECRET)
    result = process(
        """
import asyncio
from app.safe_logging import install, background_error
install()
from app.main import create_app
from app.settings import Settings
async def check():
    loop = asyncio.get_running_loop()
    previous = loop.get_exception_handler()
    app = create_app(Settings.from_environment())
    async with app.router.lifespan_context(app):
        assert loop.get_exception_handler() is background_error
    assert loop.get_exception_handler() is previous
asyncio.run(check())
""",
        env={
            "DATABASE_PATH": str(tmp_path / "never-created.sqlite3"),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
    )
    excludes_secrets(result.stdout + result.stderr)
    assert result.returncode == 0, "restore latch leaked its loop exception handler"
    assert not (tmp_path / "never-created.sqlite3").exists()


@pytest.mark.parametrize("entrypoint", [False, True])
def test_worker_restore_latch_logs_only_fixed_events(tmp_path, entrypoint):
    private = tmp_path / SECRET
    private.mkdir(mode=0o700)
    (private / ".restore-blocked").write_text(SECRET)
    code = """
from app.safe_logging import install
install()
from app.health_worker import Worker, main
from app.settings import Settings
"""
    code += (
        "raise SystemExit(main())"
        if entrypoint
        else """
settings = Settings.from_environment()
worker = Worker(settings, None)
assert worker.disabled
(settings.database_path.parent / '.restore-blocked').unlink()
assert worker.disabled
assert not worker.enabled()
"""
    )
    database = private / "never-created.sqlite3"
    result = process(
        code,
        env={
            "DATABASE_PATH": str(database),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
    )
    excludes_secrets(result.stdout + result.stderr)
    assert result.returncode == int(entrypoint)
    assert not database.exists()
    events = [json.loads(line)["code"] for line in result.stderr.splitlines()]
    events = [code for code in events if code != "DIAGNOSTIC_SUPPRESSED"]
    assert events == ["RESTORE_MAINTENANCE_REQUIRED"] + (
        ["WORKER_FAILED"] if entrypoint else []
    )


@pytest.mark.parametrize(
    "command,args,module,function",
    [
        ("ops-check", ("--backup-dir", SECRET), "app.operations", "main"),
        ("disable-health", (), "app.operational_commands", "disable_health"),
        (
            "rotate-reset-key",
            ("--generate",),
            "app.operational_commands",
            "rotate_reset_key",
        ),
    ],
)
def test_operational_cli_sentinels_cover_usage_configuration_runtime_and_signals(
    member_app, command, args, module, function
):
    import signal

    _, database = member_app()
    environment = {
        "DATABASE_PATH": str(database),
        "PUBLIC_ORIGIN": "http://localhost:5174",
    }
    usage = process(args=(command, *args, "--unknown", SECRET), env=environment)
    assert usage.returncode == 2
    config = process(args=(command, *args), env={**environment, "APP_ENV": SECRET})
    assert config.returncode == 2
    for result in (usage, config):
        excludes_secrets(result.stdout + result.stderr)
    for signum in (None, signal.SIGINT, signal.SIGTERM):
        effect = (
            f"lambda *a,**k: os.kill(os.getpid(),{int(signum)})"
            if signum
            else f"RuntimeError({SECRET!r})"
        )
        keyword = "side_effect"
        code = f"""
import os,sys
from unittest.mock import patch
from app.cli import main
sys.argv = {["app.cli", command, *args]!r}
with patch('{module}.{function}',{keyword}={effect}):
    raise SystemExit(main())
"""
        result = process(code=code, env=environment)
        assert result.returncode == (128 + int(signum) if signum else 1)
        excludes_secrets(result.stdout + result.stderr)
        assert b"Traceback" not in result.stderr
