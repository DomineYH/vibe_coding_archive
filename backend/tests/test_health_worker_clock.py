"""Controlled suspend observations at real SQLite waits; no claim of VM testing."""

import asyncio
import threading
from datetime import UTC, datetime

import pytest
from sqlalchemy import event, text

from app import health_worker
from app.health_store import request_check, snapshot
from app.health_worker import Worker
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

    def acquired(_connection, _cursor, statement, _parameters, _context, _many):
        if (
            statement == "BEGIN IMMEDIATE"
            and threading.current_thread().name.startswith("health-db")
        ):
            waiting.clear()

    event.listen(factory.kw["bind"], "before_cursor_execute", observe)
    event.listen(factory.kw["bind"], "after_cursor_execute", acquired)
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


@pytest.mark.parametrize("also_stop", [False, True])
async def test_disable_during_database_wait_cancels_without_starting_network(
    also_stop,
    worker_database,  # noqa: F811 - shared worker DB fixture
):
    settings, factory = worker_database
    waiting = watch_database_wait(factory)
    calls = []

    async def probe(url, **_kwargs):
        calls.append(url)
        await asyncio.Event().wait()

    worker = Worker(settings, factory, testing_probe=probe)
    running = asyncio.create_task(worker.run())
    try:
        await until(lambda: worker.clock is not None)
        with factory() as writer:
            writer.execute(text("BEGIN IMMEDIATE"))
            request_check(
                writer, app_id(1), "disable-test", None, datetime.now(UTC).isoformat()
            )
            await until(waiting.is_set)
            worker.disable()
            if also_stop:
                worker.stop()
            writer.commit()
        await asyncio.wait_for(running, 15)
        assert calls == []
        with factory() as db:
            observed = snapshot(db, app_id(1), datetime.now(UTC).isoformat())
        assert observed["health"]["latest_job"]["status"] == "cancelled"
        assert observed["health"]["result"]["state"] == "unchecked"
    finally:
        worker.disable()
        await asyncio.wait_for(running, 15)


async def test_disable_before_result_commit_preserves_previous_result(
    worker_database,  # noqa: F811 - shared worker DB fixture
):
    settings, factory = worker_database
    with factory() as db:
        request_check(
            db, app_id(1), "disable-save", None, datetime.now(UTC).isoformat()
        )
        db.commit()

    async def probe(_url, **_kwargs):
        return {
            "state": "healthy",
            "http_status": 200,
            "response_ms": 1,
            "checked_at": datetime.now(UTC).isoformat(),
        }

    worker = Worker(settings, factory, testing_probe=probe)

    def disable_after_result_write(
        _connection, _cursor, statement, _parameters, _context, _many
    ):
        if statement.startswith("INSERT INTO health_results"):
            worker.disable()

    event.listen(factory.kw["bind"], "after_cursor_execute", disable_after_result_write)
    await asyncio.wait_for(worker.run(), 15)
    with factory() as db:
        observed = snapshot(db, app_id(1), datetime.now(UTC).isoformat())
    assert observed["health"]["latest_job"]["status"] == "cancelled"
    assert observed["health"]["result"]["state"] == "unchecked"


async def test_disable_as_claim_commits_prevents_probe_io(
    worker_database,  # noqa: F811 - shared worker DB fixture
):
    settings, factory = worker_database
    with factory() as db:
        request_check(
            db, app_id(1), "disable-claim", None, datetime.now(UTC).isoformat()
        )
        db.commit()
    calls = []

    async def probe(url, **_kwargs):
        calls.append(url)
        await asyncio.Event().wait()

    worker = Worker(settings, factory, testing_probe=probe)

    def observe_claim(connection, _cursor, statement, _parameters, _context, _many):
        if statement.startswith("UPDATE health_jobs SET status='running'"):
            connection.info["disable_on_commit"] = True

    def disable_on_commit(connection):
        if connection.info.pop("disable_on_commit", False):
            # SQLAlchemy's commit hook runs after our pre-commit guards, before
            # the claimed job can return from the DB executor to start its probe.
            worker.disable()

    event.listen(factory.kw["bind"], "after_cursor_execute", observe_claim)
    event.listen(factory.kw["bind"], "commit", disable_on_commit)
    await asyncio.wait_for(worker.run(), 15)
    assert calls == []
    with factory() as db:
        observed = snapshot(db, app_id(1), datetime.now(UTC).isoformat())
        attempts = db.execute(text("SELECT attempts FROM health_jobs")).scalar_one()
    assert attempts == 1
    assert observed["health"]["latest_job"]["status"] == "cancelled"
    assert observed["health"]["result"]["state"] == "unchecked"


async def test_disable_during_sigterm_drain_closes_execution_without_revival(
    worker_database,  # noqa: F811 - shared worker DB fixture
):
    settings, factory = worker_database
    with factory() as db:
        request_check(
            db, app_id(1), "disable-drain", None, datetime.now(UTC).isoformat()
        )
        db.commit()
    entered, closed = asyncio.Event(), asyncio.Event()
    calls = []

    async def accept_socket(reader, writer):
        try:
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()
            closed.set()

    server = await asyncio.start_server(accept_socket, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]

    async def probe(url, **_kwargs):
        calls.append(url)
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        entered.set()
        try:
            await reader.read()
        finally:
            writer.close()
            await writer.wait_closed()

    worker = Worker(settings, factory, testing_probe=probe)
    running = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(entered.wait(), 15)
        worker.stop()

        def draining():
            with factory() as db:
                return (
                    db.execute(text("SELECT ready FROM health_worker")).scalar_one()
                    == 0
                )

        await until(draining)
        worker.disable()
        await asyncio.wait_for(closed.wait(), 2)
        await asyncio.wait_for(running, 5)
        with factory() as db:
            observed = snapshot(db, app_id(1), datetime.now(UTC).isoformat())
        assert observed["health"]["latest_job"]["status"] == "cancelled"
        assert observed["health"]["result"]["state"] == "unchecked"
    finally:
        worker.disable()
        await asyncio.wait_for(running, 15)
        server.close()
        await server.wait_closed()

    restarted = Worker(settings, factory, testing_probe=probe)
    running = asyncio.create_task(restarted.run())
    try:
        await until(lambda: restarted.clock is not None)
        await asyncio.sleep(0.2)
        assert len(calls) == 1
        with factory() as db:
            observed = snapshot(db, app_id(1), datetime.now(UTC).isoformat())
        assert observed["health"]["latest_job"]["status"] == "cancelled"
    finally:
        restarted.stop()
        await asyncio.wait_for(running, 5)
