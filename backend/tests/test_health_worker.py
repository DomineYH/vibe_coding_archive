import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.app_input import validate_url
from app.database import make_engine, make_session_factory
from app.health_probe import probe
from app.health_store import request_check, snapshot
from app.health_worker import ActivationRequired, Worker, WorkerLock
from app.settings import Settings
from tests.admin_apps_fixtures import app_id
from tests.support import populate_public_and_private_apps
from tests.test_health_probe import Network


@pytest.fixture
def worker_database(tmp_path, migrate_test_database):
    path = tmp_path / "worker.sqlite3"
    migrate_test_database(path)
    populate_public_and_private_apps(path)
    engine = make_engine(path)
    configured = Settings(
        app_env="test",
        database_path=path,
        public_origin="http://localhost:5174",
        health_worker_lock_path=tmp_path / "worker.lock",
    )
    yield configured, make_session_factory(engine)
    engine.dispose()


def test_second_worker_cannot_acquire_the_same_os_lock(tmp_path):
    path = tmp_path / "worker.lock"
    with (
        WorkerLock(path),
        pytest.raises(RuntimeError, match="already running"),
        WorkerLock(path),
    ):
        pass
    assert path.exists()
    with WorkerLock(path):
        pass


async def test_worker_refuses_network_without_activation(worker_database):
    configured, factory = worker_database
    with pytest.raises(ActivationRequired):
        await Worker(configured, factory).run()


async def test_worker_completes_a_persisted_job_and_preserves_queue_on_stop(
    worker_database,
):
    configured, factory = worker_database
    stamp = datetime.now(UTC).isoformat()
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        _, accepted = request_check(db, app_id(1), "anon:test", None, stamp)
        db.commit()
    called = asyncio.Event()

    async def observed_probe(url, **kwargs):
        called.set()
        return {
            "state": "http_error",
            "http_status": 404,
            "response_ms": 12,
            "error_kind": None,
            "error_stage": None,
            "checked_at": datetime.now(UTC).isoformat(),
        }

    worker = Worker(configured, factory, testing_probe=observed_probe)
    task = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(called.wait(), 5)
        async with asyncio.timeout(5):
            while True:
                with factory() as db:
                    state = snapshot(db, app_id(1), datetime.now(UTC).isoformat(), True)
                if state["health"]["latest_job"]["status"] == "completed":
                    break
                await asyncio.sleep(0.01)
        assert state["health"]["result"]["state"] == "http_error"
        assert state["health"]["result"]["http_status"] == 404
        assert (
            state["health"]["latest_job"]["id"]
            == accepted["health"]["latest_job"]["id"]
        )
    finally:
        worker.stop()
        await asyncio.wait_for(task, 5)


@pytest.mark.parametrize(
    "url",
    [
        "http://[64:ff9b::7f00:1]/",
        "http://[2002:7f00:1::]/",
        "http://[::ffff:0:7f00:1]/",
    ],
)
async def test_worker_blocks_registered_transition_url(worker_database, url):
    configured, factory = worker_database
    assert validate_url(url) == url
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        db.execute(
            text("UPDATE apps SET url=:url WHERE id=:id"),
            {"url": url, "id": app_id(1)},
        )
        _, accepted = request_check(
            db, app_id(1), "anon:test", None, datetime.now(UTC).isoformat()
        )
        db.commit()
    called = asyncio.Event()
    network = Network()
    observed_urls = []

    async def observed_probe(url, *, dns_servers, denied_ips):
        observed_urls.append(url)
        called.set()
        return await probe(
            url,
            dns_servers=dns_servers,
            denied_ips=denied_ips,
            network_backend=network,
        )

    worker = Worker(configured, factory, testing_probe=observed_probe)
    task = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(called.wait(), 5)
        async with asyncio.timeout(5):
            while True:
                with factory() as db:
                    state = snapshot(db, app_id(1), datetime.now(UTC).isoformat(), True)
                if state["health"]["latest_job"]["status"] == "completed":
                    break
                await asyncio.sleep(0.01)
        assert state["health"]["result"]["state"] == "blocked"
        assert state["health"]["result"]["error_kind"] == "DESTINATION_BLOCKED"
        assert state["health"]["result"]["http_status"] is None
        assert (
            state["health"]["latest_job"]["id"]
            == accepted["health"]["latest_job"]["id"]
        )
        assert observed_urls == [url]
        assert network.calls == []
    finally:
        worker.stop()
        await asyncio.wait_for(task, 5)


async def test_explicit_disable_closes_probes_and_cancels_work(worker_database):
    from app.health_store import request_batch

    configured, factory = worker_database
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        request_batch(db, None, datetime.now(UTC).isoformat())
        db.commit()
    entered, closed = asyncio.Event(), asyncio.Event()

    async def waiting_probe(url, **kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    worker = Worker(configured, factory, testing_probe=waiting_probe)
    task = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(entered.wait(), 5)
        worker.disable()
        await asyncio.wait_for(task, 5)
        assert closed.is_set()
        with factory() as db:
            states = db.execute(text("SELECT status FROM health_jobs")).scalars().all()
            assert states and set(states) == {"cancelled"}
            result = snapshot(db, app_id(1), datetime.now(UTC).isoformat())
            assert result["health"]["result"]["state"] == "unchecked"
    finally:
        worker.stop()
        if not task.done():
            await asyncio.wait_for(task, 5)


async def test_deleting_an_app_closes_its_running_probe(worker_database):
    configured, factory = worker_database
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        request_check(db, app_id(1), "anon:test", None, datetime.now(UTC).isoformat())
        db.commit()
    entered, closed = asyncio.Event(), asyncio.Event()

    async def waiting_probe(url, **kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    worker = Worker(configured, factory, testing_probe=waiting_probe)
    task = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(entered.wait(), 5)
        with factory() as db:
            db.execute(text("DELETE FROM apps WHERE id=:id"), {"id": app_id(1)})
            db.commit()
        await asyncio.wait_for(closed.wait(), 5)
        with factory() as db:
            assert (
                db.execute(text("SELECT count(*) FROM health_jobs")).scalar_one() == 0
            )
    finally:
        worker.stop()
        await asyncio.wait_for(task, 5)
