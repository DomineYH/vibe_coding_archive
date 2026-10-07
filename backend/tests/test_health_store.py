import pytest
from app import health_store as store
from app.database import make_engine, make_session_factory
from sqlalchemy import text

STAMP = "2026-10-07T00:00:00.000000Z"
APP = "00000000-0000-4000-8000-000000000001"


@pytest.fixture
def db(tmp_path, migrate_test_database, seed_public_and_private_apps):
    path = tmp_path / "health.sqlite3"
    migrate_test_database(path)
    seed_public_and_private_apps(path)
    engine = make_engine(path)
    with make_session_factory(engine)() as session:
        session.execute(text("BEGIN IMMEDIATE"))
        yield session
    engine.dispose()


def test_individual_check_survives_session_and_publishes_result(db):
    status, accepted = store.request_check(db, APP, "anon:one", None, STAMP)
    assert status == 202
    assert accepted["disposition"] == "created"
    job_id = accepted["health"]["latest_job"]["id"]
    db.commit()
    db.execute(text("BEGIN IMMEDIATE"))
    store.heartbeat(db, worker_id="w1", boot_id="b1", mono=100, stamp=STAMP)
    job = store.claim(db, worker_id="w1", boot_id="b1", mono=100, stamp=STAMP)
    assert job["id"] == job_id
    assert job["attempts"] == 1
    assert store.finish(
        db,
        job,
        {"state": "healthy", "checked_at": STAMP, "http_status": 204, "response_ms": 3},
        boot_id="b1",
        mono=101,
        stamp=STAMP,
    )
    result = store.snapshot(db, APP, STAMP, admin=True)["health"]
    assert result["result"]["http_status"] == 204
    assert result["result"]["fresh_until"] == "2026-10-07T00:15:00.000000Z"
    assert result["latest_job"]["status"] == "completed"
    assert result["next_check_at"] == "2026-10-07T00:01:00.000000Z"
