"""Explicit Node-dependent regression: run after frontend dependencies are installed."""

import json
import os
import selectors
import socket
import sqlite3
import subprocess
import time
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

import httpx
import pytest
import uvicorn
from starlette.requests import Request

from app.auth_boundary import digest
from tests.auth_client import Browser
from tests.support import AUTH_PASSWORD

FRONTEND = Path(__file__).resolve().parents[3] / "frontend"


@pytest.fixture
def dev_proxy(member_app, tmp_path):
    app, database = member_app()

    @app.get("/api/test-peer")
    def peer(request: Request):
        return {
            "headers": {
                name: request.headers.get(name)
                for name in (
                    "x-forwarded-for",
                    "x-real-ip",
                    "x-forwarded-proto",
                    "forwarded",
                    "expect",
                )
            },
            "client": request.client.host,
            "scheme": request.url.scheme,
        }

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                log_level="error",
                lifespan="on",
                proxy_headers=True,
                forwarded_allow_ips="127.0.0.1",
            )
        )
        worker = Thread(target=server.run, kwargs={"sockets": [listener]})
        worker.start()
        node = None
        try:
            deadline = time.monotonic() + 15
            while not server.started and worker.is_alive():
                assert time.monotonic() < deadline, "Uvicorn readiness timed out"
                time.sleep(0.01)
            assert server.started, "Uvicorn failed to start"
            with (tmp_path / "vite-stderr.log").open("w+") as errors:
                node = subprocess.Popen(
                    [
                        "node",
                        "tests/helpers/dev-proxy-server.mjs",
                        f"http://127.0.0.1:{listener.getsockname()[1]}",
                        str(tmp_path / "vite-cache"),
                    ],
                    cwd=FRONTEND,
                    env={**os.environ, "VITE_DATA_MODE": "api"},
                    stdout=subprocess.PIPE,
                    stderr=errors,
                    text=True,
                )
                with selectors.DefaultSelector() as ready:
                    ready.register(node.stdout, selectors.EVENT_READ)
                    assert ready.select(60), "Vite readiness timed out"
                    line = node.stdout.readline()
                errors.seek(0)
                assert line, f"Vite startup failed: {errors.read()}"
                url = json.loads(line)["url"]
                assert urlsplit(url).port not in (5173, 5174, 8000), (
                    "Vite must use an isolated ephemeral port"
                )
                # Origin remains the fixture's public browser origin, independently
                # of the isolated transport port; Browser supplies localhost:5174.
                with httpx.Client(base_url=url, timeout=30, trust_env=False) as client:
                    yield client, database
        finally:
            try:
                if node is not None:
                    node.terminate()
                    try:
                        node.communicate(timeout=30)
                    except subprocess.TimeoutExpired:
                        node.kill()
                        node.communicate(timeout=5)
                        pytest.fail("Vite did not close after SIGTERM")
            finally:
                server.should_exit = True
                worker.join(10)
                assert not worker.is_alive(), "Uvicorn did not shut down"


@pytest.mark.parametrize(
    "initial, forged",
    [
        ([], [("X-Forwarded-For", "203.0.113.7")]),
        (
            [("X-Forwarded-For", "203.0.113.7")],
            [("X-Forwarded-For", "198.51.100.8")],
        ),
        ([], [("X-Forwarded-For", "203.0.113.7, 198.51.100.8")]),
        (
            [],
            [("X-Forwarded-For", "203.0.113.7"), ("X-Forwarded-For", "198.51.100.8")],
        ),
        ([], [("X-Real-IP", "203.0.113.7")]),
        ([], [("Forwarded", "for=203.0.113.7;proto=https")]),
        (
            [],
            [
                ("X-Forwarded-For", "203.0.113.7"),
                ("X-Real-IP", "198.51.100.8"),
                ("X-Forwarded-Proto", "https"),
                ("Forwarded", "for=192.0.2.9;proto=https"),
            ],
        ),
        ([], [("Expect", "100-continue"), ("X-Forwarded-For", "203.0.113.7")]),
    ],
    ids=[
        "xff-a",
        "xff-a-to-b",
        "xff-list",
        "xff-duplicate",
        "real-ip",
        "forwarded",
        "combined",
        "expect",
    ],
)
def test_vite_forwarded_headers_cannot_reset_login_limit(dev_proxy, initial, forged):
    client, database = dev_proxy
    client.headers = httpx.Headers(initial)
    browser = Browser(client).prepare().anonymous()
    for _ in range(10):
        result = browser.login("member-a", AUTH_PASSWORD + "incorrect")
        assert result.status_code == 401, result.text
    client.headers = httpx.Headers(forged)
    result = browser.login("member-a")
    assert result.status_code == 429, result.text
    assert result.json()["error"]["code"] == "RATE_LIMITED"
    assert int(result.headers["Retry-After"]) > 0
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT purpose, subject_hash, count(*) FROM rate_limit_events "
            "WHERE purpose IN ('login_account', 'login_ip') "
            "GROUP BY purpose, subject_hash ORDER BY purpose"
        ).fetchall() == [
            ("login_account", digest(f"member-a\n{digest('127.0.0.1')}"), 10),
            ("login_ip", digest("127.0.0.1"), 10),
        ]


def test_vite_allows_normal_login_without_forwarded_headers(dev_proxy):
    client, _ = dev_proxy
    browser = Browser(client).prepare().anonymous()
    assert browser.login("member-a").status_code == 200
    assert browser.me().status_code == 200


@pytest.mark.parametrize("kind", ["normal", "expect", "duplicate"])
def test_vite_outbound_identity_matches_socket_peer(dev_proxy, kind):
    client, _ = dev_proxy
    supplied = [
        ("X-Forwarded-For", "203.0.113.7"),
        ("X-Real-IP", "198.51.100.8"),
        ("X-Forwarded-Proto", "https"),
        ("Forwarded", "for=192.0.2.9;proto=https"),
    ]
    if kind == "expect":
        supplied.append(("Expect", "100-continue"))
    elif kind == "duplicate":
        supplied.append(("X-Forwarded-For", "198.51.100.8"))
    result = client.get("/api/test-peer", headers=supplied)
    assert result.status_code == 200
    assert result.json() == {
        "headers": {
            "x-forwarded-for": "127.0.0.1",
            "x-real-ip": "127.0.0.1",
            "x-forwarded-proto": "http",
            "forwarded": None,
            "expect": "100-continue" if kind == "expect" else None,
        },
        "client": "127.0.0.1",
        "scheme": "http",
    }
