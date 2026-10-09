"""Synthetic, loopback-only real HTTP measurements; numbers are measurements, not PASS."""

import argparse
import ipaddress
import json
import math
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import NAMESPACE_URL, uuid5

from tests.support import ROOT, populate_public_and_private_apps


def isolated(database):
    path = Path(database)
    temporary = Path(tempfile.gettempdir()).resolve()
    if (
        os.environ.get("APP_ENV") != "test"
        or not path.is_absolute()
        or path != path.resolve()
        or not path.is_relative_to(temporary)
        or len(path.relative_to(temporary).parts) < 2
        or path.is_relative_to(ROOT)
        or not path.is_file()
    ):
        raise ValueError("LOAD_ISOLATION_REQUIRED")
    return path


def seed(database, *, members, apps):
    path = isolated(database)
    if members < 2 or apps < 4:
        raise ValueError("LOAD_INPUT_INVALID")
    with sqlite3.connect(path) as db:
        if (
            db.execute("SELECT count(*) FROM members").fetchone()[0]
            or db.execute("SELECT count(*) FROM apps").fetchone()[0]
        ):
            raise ValueError("LOAD_EMPTY_DATABASE_REQUIRED")
    populate_public_and_private_apps(path, public_count=apps - 1)
    with sqlite3.connect(path) as db:
        for index in range(members - 2):
            member_id = str(uuid5(NAMESPACE_URL, f"synthetic-load-member-{index}"))
            login = f"synthetic-load-{index}"
            db.execute(
                """INSERT INTO members(id,login_id,login_id_key,nickname,password_hash,is_admin,approval_status,created_at,updated_at,first_approved_at)
                SELECT ?,?,?,?,password_hash,0,'approved',created_at,updated_at,first_approved_at FROM members LIMIT 1""",
                (member_id, login, login, login),
            )
        owners = [r[0] for r in db.execute("SELECT id FROM members ORDER BY id")]
        ids = [r[0] for r in db.execute("SELECT id FROM apps ORDER BY id")]
        db.executemany(
            "UPDATE apps SET owner_id=? WHERE id=?",
            [(owners[i % len(owners)], app) for i, app in enumerate(ids)],
        )
    path.chmod(0o600)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("LOAD_REDIRECT_REFUSED")


def percentile(latencies):
    return (
        sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1] if latencies else None
    )


def measure(base_url, database, *, concurrency, requests=None, seconds=None):
    path = isolated(database)
    try:
        parsed = urlsplit(base_url)
        valid = (
            parsed.scheme == "http"
            and ipaddress.ip_address(parsed.hostname).is_loopback
            and not parsed.username
            and not parsed.password
            and not parsed.path
            and not parsed.query
            and not parsed.fragment
            and parsed.port != 0
        )
    except (ValueError, TypeError):
        valid = False
    if not valid or concurrency < 1 or (requests is None) == (seconds is None):
        raise ValueError("LOAD_INPUT_INVALID")
    if requests is not None and requests < 1 or seconds is not None and seconds <= 0:
        raise ValueError("LOAD_INPUT_INVALID")
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        app = db.execute(
            "SELECT id FROM apps WHERE is_public=1 ORDER BY id LIMIT 1"
        ).fetchone()
    if not app:
        raise ValueError("LOAD_FIXTURE_REQUIRED")
    paths = ["/api/v1/apps", f"/api/v1/apps/{app[0]}"]
    latencies, errors = [], []
    lock = threading.Lock()
    issued = 0
    deadline = time.monotonic() + seconds if seconds is not None else None

    def worker():
        nonlocal issued
        opener = build_opener(ProxyHandler({}), NoRedirect())
        while True:
            with lock:
                if (requests is not None and issued >= requests) or (
                    deadline is not None and time.monotonic() >= deadline
                ):
                    return
                number = issued
                issued += 1
            started = time.monotonic()
            failed = False
            try:
                with opener.open(
                    Request(base_url + paths[number % 2]), timeout=10
                ) as response:
                    failed = response.status != 200
                    json.load(response)
            except Exception:  # noqa: BLE001 - Count transport/HTTP/JSON failures, never log payloads.
                failed = True
            elapsed = (time.monotonic() - started) * 1000
            with lock:
                latencies.append(elapsed)
                errors.append(int(failed))

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(pool.map(lambda _: worker(), range(concurrency)))
    return {
        "requests": len(latencies),
        "errors": sum(errors),
        "p95_ms": percentile(latencies),
        "latencies_ms": latencies,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--members", type=int, default=2)
    parser.add_argument("--apps", type=int, default=4)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--warmup", type=int, default=0)
    parser.add_argument("--seconds", type=int, default=1)
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args()
    if os.environ.get("APP_ENV") != "test" or args.warmup < 0 or args.repeat < 1:
        parser.error("LOAD_INPUT_INVALID")
    from tests.auth_process import AuthProcess

    with tempfile.TemporaryDirectory(prefix="ops-load-") as directory:
        database = Path(directory) / "load.sqlite3"
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            check=True,
            capture_output=True,
            env={
                **os.environ,
                "DATABASE_PATH": str(database),
                "PUBLIC_ORIGIN": "http://localhost:5174",
                "HEALTH_CHECKS_ENABLED": "false",
            },
        )
        seed(database, members=args.members, apps=args.apps)
        server = AuthProcess(database, Path(os.environ["PASSWORD_BLOCKLIST_PATH"]))
        try:
            server.start()
            url = f"http://127.0.0.1:{server.port}"
            if args.warmup:
                measure(
                    url, database, concurrency=args.concurrency, seconds=args.warmup
                )
            for _ in range(args.repeat):
                result = measure(
                    url, database, concurrency=args.concurrency, seconds=args.seconds
                )
                result.pop("latencies_ms")
                print(json.dumps(result))
        finally:
            server.close()


if __name__ == "__main__":
    main()
