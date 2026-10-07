"""Fenced health execution transitions; no network operations or commits."""

from app.health_store_views import after, execute, row, settle, stamp_string


def current_worker(db):
    return row(db, "SELECT * FROM health_worker WHERE singleton=1")


def heartbeat(db, *, worker_id, boot_id, mono, stamp, ready=True):
    execute(
        db,
        """INSERT INTO health_worker(singleton,worker_id,boot_id,heartbeat_mono,heartbeat_at,ready)
        VALUES(1,:worker,:boot,:mono,:stamp,:ready)
        ON CONFLICT(singleton) DO UPDATE SET worker_id=excluded.worker_id,
        boot_id=excluded.boot_id,heartbeat_mono=excluded.heartbeat_mono,
        heartbeat_at=excluded.heartbeat_at,ready=excluded.ready""",
        worker=worker_id,
        boot=boot_id,
        mono=mono,
        stamp=stamp_string(stamp),
        ready=int(ready),
    )


def availability(db, *, boot_id, mono):
    worker = current_worker(db)
    if not worker or not worker["ready"] or worker["boot_id"] != boot_id:
        return False
    if not 0 <= mono - worker["heartbeat_mono"] < 15:
        return False
    return (
        row(
            db,
            """SELECT id FROM health_jobs WHERE status='running'
        AND (boot_id<>:boot OR worker_id<>:worker OR lease_deadline<=:mono) LIMIT 1""",
            boot=boot_id,
            worker=worker["worker_id"],
            mono=mono,
        )
        is None
    )


def invalidate(db, worker_id, stamp):
    execute(
        db,
        "UPDATE health_worker SET ready=0,heartbeat_at=:stamp WHERE worker_id=:worker",
        worker=worker_id,
        stamp=stamp_string(stamp),
    )
    execute(
        db,
        "UPDATE health_jobs SET lease_deadline=0 WHERE worker_id=:worker AND status='running'",
        worker=worker_id,
    )


def claim(db, *, worker_id, boot_id, mono, stamp):
    stamp = stamp_string(stamp)
    worker = current_worker(db)
    if (
        not worker
        or worker["worker_id"] != worker_id
        or not availability(db, boot_id=boot_id, mono=mono)
    ):
        return None
    if (
        execute(
            db, "SELECT count(*) FROM health_jobs WHERE status='running'"
        ).scalar_one()
        >= 3
    ):
        return None
    candidates = (
        execute(
            db,
            """SELECT j.*,a.url FROM health_jobs j JOIN apps a ON a.id=j.app_id
        LEFT JOIN health_cooldowns c ON c.app_id=j.app_id
        WHERE j.status='queued' AND j.url_version=a.url_version AND j.attempts<2
        AND j.created_at>:cutoff AND (c.next_check_at IS NULL OR c.next_check_at<=:stamp)
        ORDER BY j.created_at,j.id""",
            stamp=stamp,
            cutoff=after(stamp, -86400),
        )
        .mappings()
        .all()
    )
    individual = next((j for j in candidates if j["individual"]), None)
    batch = next((j for j in candidates if not j["individual"]), None)
    job = (
        batch
        if batch and (not individual or worker["individual_streak"] >= 2)
        else individual or batch
    )
    if job is None:
        return None
    execute(
        db,
        """UPDATE health_jobs SET status='running',attempts=attempts+1,
        worker_id=:worker,boot_id=:boot,lease_deadline=:lease,started_at=coalesce(started_at,:stamp)
        WHERE id=:id""",
        id=job["id"],
        worker=worker_id,
        boot=boot_id,
        lease=mono + 30,
        stamp=stamp,
    )
    execute(
        db,
        """INSERT INTO health_cooldowns(app_id,started_at,next_check_at) VALUES(:app,:stamp,:next)
        ON CONFLICT(app_id) DO UPDATE SET started_at=excluded.started_at,next_check_at=excluded.next_check_at""",
        app=job["app_id"],
        stamp=stamp,
        next=after(stamp, 60),
    )
    execute(
        db,
        "UPDATE health_worker SET individual_streak=:streak WHERE singleton=1",
        streak=min(2, worker["individual_streak"] + 1) if job["individual"] else 0,
    )
    execute(
        db,
        "UPDATE health_batch_items SET status='running' WHERE job_id=:id AND status='queued'",
        id=job["id"],
    )
    value = row(db, "SELECT * FROM health_jobs WHERE id=:id", id=job["id"])
    return dict(value, url=job["url"])


def _live(db, job, boot_id, mono):
    return row(
        db,
        """SELECT j.* FROM health_jobs j JOIN apps a ON a.id=j.app_id
        WHERE j.id=:id AND j.status='running' AND j.attempts=:attempts
        AND j.worker_id=:worker AND j.boot_id=:boot AND j.lease_deadline>:mono
        AND j.url_version=a.url_version AND j.url_version=:version""",
        id=job["id"],
        attempts=job["attempts"],
        worker=job["worker_id"],
        boot=boot_id,
        mono=mono,
        version=job["url_version"],
    )


def _terminal(db, job_id, status, stamp, failure_code=None):
    execute(
        db,
        """UPDATE health_jobs SET status=:status,finished_at=:stamp,failure_code=:failure
        WHERE id=:id""",
        id=job_id,
        status=status,
        stamp=stamp_string(stamp),
        failure=failure_code,
    )
    execute(
        db,
        """UPDATE health_batch_items SET status=:status WHERE job_id=:id
        AND batch_id IN (SELECT id FROM health_batches WHERE finished_at IS NULL)
        AND status IN ('queued','running')""",
        id=job_id,
        status="result_obtained" if status == "completed" else status,
    )
    settle(db, stamp)


def finish(db, job, result, *, boot_id, mono, stamp):
    if not _live(db, job, boot_id, mono):
        return False
    checked = stamp_string(result["checked_at"])
    execute(
        db,
        """INSERT INTO health_results(app_id,url_version,state,checked_at,fresh_until,http_status,response_ms,error_kind,error_stage)
        VALUES(:app,:version,:state,:checked,:fresh,:http,:response,:kind,:stage)
        ON CONFLICT(app_id) DO UPDATE SET url_version=excluded.url_version,state=excluded.state,
        checked_at=excluded.checked_at,fresh_until=excluded.fresh_until,http_status=excluded.http_status,
        response_ms=excluded.response_ms,error_kind=excluded.error_kind,error_stage=excluded.error_stage""",
        app=job["app_id"],
        version=job["url_version"],
        state=result["state"],
        checked=checked,
        fresh=after(checked, 900),
        http=result.get("http_status"),
        response=result.get("response_ms"),
        kind=result.get("error_kind"),
        stage=result.get("error_stage"),
    )
    _terminal(db, job["id"], "completed", stamp)
    return True


def fail(db, job, *, boot_id, mono, stamp, code="CHECK_EXECUTION_FAILED"):
    if code not in ("CHECK_EXECUTION_FAILED", "RESULT_STORE_FAILED"):
        raise ValueError(
            "Only confirmed execution or persistence failures are terminal"
        )
    if not _live(db, job, boot_id, mono):
        return False
    _terminal(db, job["id"], "failed", stamp, code)
    return True


def maintain(db, *, boot_id, mono, stamp, stopped_worker_ids=()):
    stamp = stamp_string(stamp)
    for job in (
        execute(db, "SELECT * FROM health_jobs WHERE status IN ('queued','running')")
        .mappings()
        .all()
    ):
        app = row(db, "SELECT url_version FROM apps WHERE id=:id", id=job["app_id"])
        if not app or app["url_version"] != job["url_version"]:
            _terminal(db, job["id"], "cancelled", stamp)
        elif job["status"] == "running" and job["worker_id"] in stopped_worker_ids:
            if job["attempts"] >= 2:
                _terminal(db, job["id"], "failed", stamp, "WORKER_RECOVERY_EXHAUSTED")
            elif after(job["created_at"], 86400) <= stamp:
                _terminal(db, job["id"], "failed", stamp, "QUEUE_WAIT_EXPIRED")
            else:
                execute(
                    db,
                    "UPDATE health_jobs SET status='queued',worker_id=NULL,boot_id=NULL,lease_deadline=NULL WHERE id=:id",
                    id=job["id"],
                )
                execute(
                    db,
                    "UPDATE health_batch_items SET status='queued' WHERE job_id=:id AND status='running'",
                    id=job["id"],
                )
        elif job["status"] == "queued" and after(job["created_at"], 86400) <= stamp:
            _terminal(db, job["id"], "failed", stamp, "QUEUE_WAIT_EXPIRED")
    settle(db, stamp)
    execute(
        db,
        "DELETE FROM health_jobs WHERE finished_at<=:cutoff",
        cutoff=after(stamp, -604800),
    )
    execute(
        db,
        "DELETE FROM health_batches WHERE finished_at<=:cutoff",
        cutoff=after(stamp, -604800),
    )
    execute(
        db,
        "DELETE FROM health_requests WHERE created_at<=:cutoff",
        cutoff=after(stamp, -60),
    )


def cancel_all(db, stamp, reason="FEATURE_DISABLED"):
    for job_id in (
        execute(db, "SELECT id FROM health_jobs WHERE status IN ('queued','running')")
        .scalars()
        .all()
    ):
        _terminal(db, job_id, "cancelled", stamp)
    execute(db, "UPDATE health_worker SET ready=0 WHERE singleton=1")
