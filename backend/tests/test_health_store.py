import shutil

import pytest
from sqlalchemy import text

from app import health_store as store
from app.database import make_engine, make_session_factory

STAMP = "2026-10-07T00:00:00.000000Z"
APP = "00000000-0000-4000-8000-000000000001"


@pytest.fixture
def db(tmp_path, tmp_path_factory, migrate_test_database, seed_public_and_private_apps):
    template = tmp_path_factory.getbasetemp() / "health-template.sqlite3"
    if not template.exists():
        migrate_test_database(template)
        seed_public_and_private_apps(template)
    path = tmp_path / "health.sqlite3"
    shutil.copyfile(template, path)
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


def request(db, app=APP, stamp=STAMP, actor="anon:one"):
    return store.request_check(db, app, actor, None, stamp)


def claim(db, stamp=STAMP, mono=100, worker="w1", boot="b1"):
    store.heartbeat(db, worker_id=worker, boot_id=boot, mono=mono, stamp=stamp)
    return store.claim(db, worker_id=worker, boot_id=boot, mono=mono, stamp=stamp)


def finish(db, job, stamp=STAMP, mono=101):
    return store.finish(
        db,
        job,
        {"state": "healthy", "checked_at": stamp, "http_status": 200, "response_ms": 1},
        boot_id="b1",
        mono=mono,
        stamp=stamp,
    )


def test_url_change_discards_old_result_cancels_shared_batch_and_keeps_cooldown(db):
    request(db)
    job = claim(db)
    batch = store.request_batch(db, None, STAMP)[1]["batch"]
    assert finish(db, job)
    assert store.batch_view(db, batch["id"], STAMP)["counts"]["result_obtained"] == 1
    db.execute(
        text(
            "UPDATE apps SET url='https://new.example',url_version=2,updated_at=:stamp WHERE id=:id"
        ),
        {"id": APP, "stamp": STAMP},
    )
    assert not finish(db, job)
    assert store.snapshot(db, APP, STAMP)["health"]["result"]["state"] == "unchecked"
    assert store.batch_view(db, batch["id"], STAMP)["counts"]["cancelled"] == 1
    from app.auth_boundary import AuthError

    with pytest.raises(AuthError) as error:
        request(db)
    assert error.value.reasons == ["app_cooldown"]
    assert error.value.retry_at == "2026-10-07T00:01:00.000000Z"


def test_lease_expiry_does_not_authorize_recovery_and_attempts_fence_late_saves(db):
    request(db)
    first = claim(db)
    store.maintain(db, boot_id="b1", mono=130, stamp=STAMP)
    assert store.job_response(db, first["id"], STAMP)["job"]["status"] == "running"
    assert not finish(db, first, mono=130)
    assert not store.availability(db, boot_id="b1", mono=130)
    store.maintain(db, boot_id="b1", mono=130, stamp=STAMP, stopped_worker_ids=("w1",))
    assert claim(db, mono=130) is None  # cooldown still runs from first claim
    second = claim(db, stamp="2026-10-07T00:01:00Z", mono=160, worker="w2")
    assert second["id"] == first["id"]
    assert second["attempts"] == 2
    assert second["started_at"] == STAMP
    assert not finish(db, first, mono=161)
    store.maintain(db, boot_id="b1", mono=161, stamp=STAMP, stopped_worker_ids=("w2",))
    assert (
        store.job_response(db, first["id"], STAMP)["job"]["failure_code"]
        == "WORKER_RECOVERY_EXHAUSTED"
    )


def test_rate_limit_counts_reuse_and_unavailable_but_never_extends_blocked_requests(db):
    from app.auth_boundary import AuthError

    for _ in range(10):
        with pytest.raises(AuthError) as error:
            store.request_check(db, APP, "actor", None, STAMP, available=False)
        assert error.value.status == 503
    with pytest.raises(AuthError) as error:
        request(db, actor="actor", stamp="2026-10-07T00:00:59.800000Z")
    assert error.value.status == 429
    assert error.value.retry_at == "2026-10-07T00:01:00.000000Z"
    assert error.value.reasons == ["actor_rate_limit"]
    assert request(db, actor="actor", stamp="2026-10-07T00:01:00Z")[0] == 202


def test_previous_worker_cannot_persist_after_worker_registration_changed(db):
    store.heartbeat(db, worker_id="w1", boot_id="b1", mono=100, stamp=STAMP)
    request(db)
    job = claim(db)
    store.heartbeat(db, worker_id="w2", boot_id="b2", mono=5, stamp=STAMP)
    # An old process must not write using a stale boot after registration changed.
    assert not finish(db, job, mono=101)


def test_worker_heartbeat_boundaries_boot_change_and_invalidation(db):
    store.heartbeat(db, worker_id="w1", boot_id="b1", mono=100, stamp=STAMP)
    assert store.availability(db, boot_id="b1", mono=114.999)
    assert not store.availability(db, boot_id="b1", mono=115)
    assert not store.availability(db, boot_id="other-boot", mono=101)
    request(db)
    job = claim(db)
    store.invalidate(db, "w1", STAMP)
    assert not store.execution_valid(db, job, boot_id="b1", mono=101)
    assert not finish(db, job)
    assert store.job_response(db, job["id"], STAMP)["job"]["status"] == "running"


def test_failed_job_preserves_previous_result_and_can_reuse_it_in_cooldown(db):
    request(db)
    first = claim(db)
    assert finish(db, first)
    later = "2026-10-07T00:01:00.000000Z"
    request(db, stamp=later)
    second = claim(db, stamp=later, mono=160)
    assert store.fail(db, second, boot_id="b1", mono=161, stamp=later)
    response = request(db, stamp=later)
    assert response[0] == 200
    assert response[1]["disposition"] == "result_reused"
    assert response[1]["health"]["result"]["checked_at"] == STAMP
    assert (
        response[1]["health"]["latest_job"]["failure_code"] == "CHECK_EXECUTION_FAILED"
    )
    store.maintain(db, boot_id="b1", mono=162, stamp=later, stopped_worker_ids=("w1",))
    assert store.job_response(db, second["id"], later)["job"]["status"] == "failed"


def test_fair_queue_promotes_shared_individual_requests_and_skips_cooldown(db):
    batch = store.request_batch(db, None, STAMP)[1]["batch"]
    request(db)
    second_app = "00000000-0000-4000-8000-000000000002"
    request(db, app=second_app)
    one, two, three = claim(db), claim(db), claim(db)
    assert {one["app_id"], two["app_id"]} == {APP, second_app}
    assert three["individual"] == 0
    assert claim(db) is None
    assert store.batch_view(db, batch["id"], STAMP)["counts"]["running"] == 3
    store.maintain(db, boot_id="b1", mono=102, stamp=STAMP, stopped_worker_ids=("w1",))
    # All three are queued during cooldown; no prematurely restarted call.
    assert claim(db, mono=102) is None
    assert store.batch_view(db, batch["id"], STAMP)["counts"]["queued"] == 3


def test_batch_reuses_result_and_delete_invalidates_only_unfinished_counts(db):
    request(db)
    assert finish(db, claim(db))
    batch = store.request_batch(db, None, STAMP)[1]["batch"]
    assert batch["counts"]["reused"] == 1
    assert store.request_batch(db, None, STAMP)[1]["disposition"] == "active_reused"
    db.execute(text("DELETE FROM apps WHERE id=:id"), {"id": APP})
    view = store.batch_view(db, batch["id"], STAMP)
    assert view["counts"]["reused"] == 0
    assert view["counts"]["cancelled"] == 1
    store.cancel_all(db, STAMP)
    frozen = store.batch_view(db, batch["id"], STAMP)
    assert frozen["is_finished"]
    db.execute(text("DELETE FROM apps"))
    assert store.batch_view(db, batch["id"], STAMP) == frozen


def test_member_delete_cascades_targets_but_not_jobs_requested_for_other_owners(db):
    member = "00000000-0000-4000-8000-000000000010"
    other_app = "00000000-0000-4000-8000-000000000003"
    status, accepted = store.request_check(db, other_app, "member", member, STAMP)
    assert status == 202
    batch = store.request_batch(db, member, STAMP)[1]["batch"]
    db.execute(text("DELETE FROM members WHERE id=:id"), {"id": member})
    job_id = accepted["health"]["latest_job"]["id"]
    assert store.job_response(db, job_id, STAMP)["job"]["status"] == "queued"
    assert store.batch_view(db, batch["id"], STAMP)["counts"]["cancelled"] == 2
    assert finish(db, claim(db))
    assert store.batch_view(db, batch["id"], STAMP)["is_finished"]


def test_queue_wait_and_retention_boundaries_keep_independent_last_result(db):
    from app.auth_boundary import AuthError

    request(db)
    first = claim(db)
    assert finish(db, first)
    second_app = "00000000-0000-4000-8000-000000000002"
    queued = request(db, app=second_app)[1]["health"]["latest_job"]
    tomorrow = "2026-10-08T00:00:00.000000Z"
    store.maintain(db, boot_id="b1", mono=200, stamp=tomorrow)
    assert (
        store.job_response(db, queued["id"], tomorrow)["job"]["failure_code"]
        == "QUEUE_WAIT_EXPIRED"
    )
    week = "2026-10-14T00:00:00.000000Z"
    with pytest.raises(AuthError) as error:
        store.job_response(db, first["id"], week)
    assert error.value.status == 404
    assert store.snapshot(db, APP, week)["health"]["latest_job"] is None
    store.maintain(db, boot_id="b1", mono=300, stamp=week)
    assert store.snapshot(db, APP, week)["health"]["result"]["checked_at"] == STAMP
    assert store.job_response(db, queued["id"], week)["job"]["status"] == "failed"


def test_empty_batch_finishes_and_obeys_global_cooldown_and_retention(db):
    from app.auth_boundary import AuthError

    db.execute(text("DELETE FROM apps"))
    status, accepted = store.request_batch(db, None, STAMP)
    batch = accepted["batch"]
    assert status == 202 and batch["is_finished"]
    assert batch["target_count"] == 0 and batch["processed_count"] == 0
    with pytest.raises(AuthError) as error:
        store.request_batch(db, None, "2026-10-07T00:04:59.800000Z")
    assert error.value.retry_at == "2026-10-07T00:05:00.000000Z"
    assert store.batch_ids(db, STAMP) == {
        "active_health_batch_id": None,
        "latest_health_batch_id": batch["id"],
    }
    week = "2026-10-14T00:00:00.000000Z"
    assert store.batch_ids(db, week)["latest_health_batch_id"] is None
    with pytest.raises(AuthError):
        store.batch_view(db, batch["id"], week)
    assert store.request_batch(db, None, "2026-10-07T00:05:00Z")[0] == 202


def test_concurrent_admission_has_one_shared_active_job(db):
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy.orm import Session

    db.commit()
    engine = db.get_bind()

    def submit(actor):
        with Session(engine) as session:
            session.execute(text("BEGIN IMMEDIATE"))
            response = request(session, actor=actor)
            session.commit()
            return response[1]

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, ["one", "two"]))
    assert {item["disposition"] for item in responses} == {"created", "active_reused"}
    assert len({item["health"]["latest_job"]["id"] for item in responses}) == 1


def test_result_job_and_batch_settlement_roll_back_as_one_transaction(db):
    batch = store.request_batch(db, None, STAMP)[1]["batch"]
    job = claim(db)
    db.commit()
    db.execute(text("BEGIN IMMEDIATE"))
    assert finish(db, job)
    db.rollback()
    assert store.job_response(db, job["id"], STAMP)["job"]["status"] == "running"
    assert (
        store.snapshot(db, job["app_id"], STAMP)["health"]["result"]["state"]
        == "unchecked"
    )
    view = store.batch_view(db, batch["id"], STAMP)
    assert view["counts"]["result_obtained"] == 0
    assert view["counts"]["running"] == 1


def test_explicit_disable_never_recovers_cancelled_jobs(db):
    request(db)
    job = claim(db)
    batch = store.request_batch(db, None, STAMP)[1]["batch"]
    store.cancel_all(db, STAMP)
    assert not finish(db, job)
    store.maintain(db, boot_id="b1", mono=101, stamp=STAMP, stopped_worker_ids=("w1",))
    assert store.job_response(db, job["id"], STAMP)["job"]["status"] == "cancelled"
    assert store.batch_view(db, batch["id"], STAMP)["counts"]["cancelled"] == 3
    assert claim(db, stamp="2026-10-07T00:01:00Z", mono=160) is None


def test_database_rejects_failure_without_a_safe_failure_code(db):
    from sqlalchemy.exc import IntegrityError

    job_id = request(db)[1]["health"]["latest_job"]["id"]
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "UPDATE health_jobs SET status='failed',finished_at=:stamp WHERE id=:id"
            ),
            {"stamp": STAMP, "id": job_id},
        )


def test_two_to_one_fairness_does_not_starve_batch_with_more_individual_work(db):
    fourth = "00000000-0000-4000-8000-000000000004"
    db.execute(
        text("""INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,
        theme_id,version,url_version,created_at,updated_at)
        SELECT :id,owner_id,name,url,prompt,description,subject,is_public,
        theme_id,version,url_version,created_at,updated_at FROM apps WHERE id=:source"""),
        {"id": fourth, "source": APP},
    )
    store.request_batch(db, None, STAMP)
    for app in (
        APP,
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
    ):
        request(db, app=app)
    one, two, three = claim(db), claim(db), claim(db)
    assert one["individual"] == two["individual"] == 1
    assert three["app_id"] == fourth
    assert finish(db, one)
    assert claim(db)["individual"] == 1


def test_new_runnable_job_passes_recovered_jobs_waiting_for_cooldown(db):
    request(db)
    first = claim(db)
    store.maintain(db, boot_id="b1", mono=101, stamp=STAMP, stopped_worker_ids=("w1",))
    second_app = "00000000-0000-4000-8000-000000000002"
    request(db, app=second_app)
    second = claim(db)
    assert second["app_id"] == second_app
    assert store.job_response(db, first["id"], STAMP)["job"]["status"] == "queued"


def test_combined_actor_and_app_limits_report_latest_release_time(db):
    from app.auth_boundary import AuthError

    for _ in range(10):
        request(db)
    job = claim(db, stamp="2026-10-07T00:00:30Z", mono=130)
    assert store.fail(db, job, boot_id="b1", mono=131, stamp="2026-10-07T00:00:31Z")
    with pytest.raises(AuthError) as error:
        request(db, stamp="2026-10-07T00:00:40Z")
    assert error.value.reasons == ["actor_rate_limit", "app_cooldown"]
    assert error.value.retry_at == "2026-10-07T00:01:30.000000Z"


def test_migration_preserves_existing_result_and_backfills_current_url_version(
    tmp_path, migrate_test_database, seed_public_and_private_apps
):
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    path = tmp_path / "upgrade.sqlite3"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0011_user_delete"],
        cwd=Path(__file__).resolve().parents[1],
        check=True,
        capture_output=True,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
    )
    seed_public_and_private_apps(path)
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE apps SET url_version=3 WHERE id=?", (APP,))
        connection.execute(
            "UPDATE health_results SET state='healthy',checked_at=?,fresh_until=? WHERE app_id=?",
            (STAMP, "2026-10-07T00:15:00.000000Z", APP),
        )
    migrate_test_database(path)
    engine = make_engine(path)
    with make_session_factory(engine)() as session:
        health = store.snapshot(session, APP, STAMP, admin=True)
        assert health["url_version"] == 3
        assert health["health"]["result"]["state"] == "healthy"
        assert health["health"]["result"]["checked_at"] == STAMP
        assert health["health"]["result"]["http_status"] is None
    engine.dispose()
