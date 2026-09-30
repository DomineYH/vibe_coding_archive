from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def _server_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def _start_server(database_path: Path, port: int) -> subprocess.Popen:
    environment = {
        **os.environ,
        "APP_ENV": "test",
        "DATABASE_PATH": str(database_path),
        "PUBLIC_ORIGIN": "http://localhost:5174",
    }
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        cwd=BACKEND,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.communicate()[1]
            raise AssertionError(f"API process exited during startup: {stderr}")
        try:
            with urlopen(f"http://127.0.0.1:{port}/healthz", timeout=0.5) as response:
                if response.status == 200:
                    return process
        except URLError:
            time.sleep(0.05)
    process.terminate()
    stderr = process.communicate(timeout=5)[1]
    raise AssertionError(f"API process did not become ready: {stderr}")


def _read_public_apps(port: int) -> dict:
    with urlopen(f"http://127.0.0.1:{port}/api/v1/apps", timeout=3) as response:
        return json.load(response)


def _read_public_app_detail(port: int, app_id: str) -> dict:
    with urlopen(
        f"http://127.0.0.1:{port}/api/v1/apps/{app_id}", timeout=3
    ) as response:
        return json.load(response)


def test_public_apps_remain_after_api_process_restart(
    tmp_path: Path, migrate_test_database, seed_public_and_private_apps
):
    database_path = tmp_path / "restart.sqlite3"
    migrate_test_database(database_path)
    seed_public_and_private_apps(database_path)
    port = _server_port()
    first_process = _start_server(database_path, port)
    try:
        first = _read_public_apps(port)
        assert [item["name"] for item in first["items"]] == [
            "둘째 공개 앱",
            "첫 공개 앱",
        ]
    finally:
        first_process.terminate()
        first_process.communicate(timeout=10)

    second_process = _start_server(database_path, port)
    try:
        second = _read_public_apps(port)
        assert [item["id"] for item in second["items"]] == [
            "00000000-0000-4000-8000-000000000002",
            "00000000-0000-4000-8000-000000000001",
        ]
        assert second["pagination"]["total"] == 2
        detail = _read_public_app_detail(port, "00000000-0000-4000-8000-000000000002")[
            "item"
        ]
        assert detail["name"] == "둘째 공개 앱"
        assert detail["url"] == "https://example.test/app"
        assert detail["prompt"] == "line 1\nline 2"
    finally:
        second_process.terminate()
        second_process.communicate(timeout=10)
