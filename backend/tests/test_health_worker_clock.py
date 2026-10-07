"""Controlled suspend observations at real SQLite waits; no claim of VM testing."""

import asyncio
import threading
from datetime import UTC, datetime

from app import health_worker
from app.health_store import request_check, snapshot
from app.health_worker import Worker
from sqlalchemy import event, text

from tests.admin_apps_fixtures import app_id
from tests.test_health_worker import worker_database  # noqa: F401


async def until(predicate):
    async with asyncio.timeout(15):
        while not predicate():
            await asyncio.sleep(0.01)


def watch_database_wait(factory):
    waiting = threading.Event()

    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        if (
            statement == "BEGIN IMMEDIATE"
            and threading.current_thread().name.startswith("health-db")
        ):
            waiting.set()

    event.listen(factory.kw["bind"], "before_cursor_execute", observe)
    return waiting


async def test_suspend_during_database_wait_recovers_before_starting_network(
    worker_database,  # noqa: F811 - shared worker DB fixture
    monkeypatch,
):
    settings, factory = worker_database
    offset = [0.0]
    monkeypatch.setattr(health_worker, "suspend_offset", lambda: offset[0])
    waiting = watch_database_wait(factory)
    calls = []

    async def probe(_url, **_kwargs):
        calls.append(worker.worker_id)
        await asyncio.Event().wait()

    worker = Worker(settings, factory, testing_probe=probe)
    running = asyncio.create_task(worker.run())
    try:

        def ready():
            with factory() as db:
                return (
                    db.execute(
                        text("SELECT count(*) FROM health_worker WHERE ready=1")
                    ).scalar_one()
                    == 1
                )

        await until(ready)
        previous_generation = worker.worker_id
        with factory() as writer:
            writer.execute(text("BEGIN IMMEDIATE"))
            request_check(
                writer, app_id(1), "clock-test", None, datetime.now(UTC).isoformat()
            )
            waiting.clear()
            await until(waiting.is_set)
            offset[0] += 10
            writer.commit()
        await until(lambda: bool(calls))
        assert calls[0] != previous_generation, (
            "pre-suspend generation started network I/O"
        )
    finally:
        worker.disable()
        await asyncio.wait_for(running, 5)


async def test_suspend_while_completed_probe_waits_for_database_preserves_result(
    worker_database,  # noqa: F811 - shared worker DB fixture
    monkeypatch,
):
    settings, factory = worker_database
    offset = [0.0]
    monkeypatch.setattr(health_worker, "suspend_offset", lambda: offset[0])
    waiting = watch_database_wait(factory)
    entered, release = asyncio.Event(), asyncio.Event()
    with factory() as db:
        request_check(db, app_id(1), "clock-test", None, datetime.now(UTC).isoformat())
        db.commit()

    async def probe(_url, **_kwargs):
        entered.set()
        await release.wait()
        return {
            "state": "http_error",
            "http_status": 500,
            "response_ms": 1,
            "checked_at": datetime.now(UTC).isoformat(),
        }

    worker = Worker(settings, factory, testing_probe=probe)
    running = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(entered.wait(), 5)
        with factory() as writer:
            writer.execute(text("BEGIN IMMEDIATE"))
            waiting.clear()
            release.set()
            await until(waiting.is_set)
            offset[0] += 10
            writer.commit()

        observed = {}

        def settled():
            with factory() as db:
                observed.update(snapshot(db, app_id(1), datetime.now(UTC).isoformat()))
            return observed["health"]["latest_job"]["status"] != "running"

        await until(settled)
        assert observed["health"]["result"]["state"] == "unchecked"
        assert observed["health"]["latest_job"]["status"] == "queued"
    finally:
        worker.disable()
        await asyncio.wait_for(running, 5)
