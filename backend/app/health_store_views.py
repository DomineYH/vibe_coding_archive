"""Health persistence reads and transaction-local shared operations.

Callers acquire BEGIN IMMEDIATE before mutations and sample their clocks after
that lock. These helpers never commit, perform network I/O or acquire a lease.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import text

from app.auth_boundary import AuthError

JOB_FIELDS = ("id", "status", "created_at", "started_at", "finished_at", "failure_code")
RESULT_FIELDS = ("state", "checked_at", "fresh_until")
ADMIN_FIELDS = ("http_status", "response_ms", "error_kind", "error_stage")


def stamp_string(stamp):
    value = stamp if isinstance(stamp, datetime) else datetime.fromisoformat(stamp)
    if value.tzinfo is None:
        raise ValueError("Health timestamps require a timezone")
    return (
        value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    )


def after(stamp, seconds):
    return stamp_string(
        datetime.fromisoformat(stamp_string(stamp)) + timedelta(seconds=seconds)
    )


def execute(db, sql, **params):
    return db.execute(text(sql), params)


def row(db, sql, **params):
    value = execute(db, sql, **params).mappings().first()
    return dict(value) if value is not None else None


def app_row(db, app_id):
    app = row(db, "SELECT id,url,url_version FROM apps WHERE id=:id", id=app_id)
    if app is None:
        raise AuthError("NOT_FOUND", 404)
    return app


def active_job(db, app_id):
    return row(
        db,
        "SELECT * FROM health_jobs WHERE app_id=:id AND status IN ('queued','running')",
        id=app_id,
    )


def cooldown(db, app_id, stamp):
    value = row(
        db,
        "SELECT next_check_at FROM health_cooldowns WHERE app_id=:id AND next_check_at>:stamp",
        id=app_id,
        stamp=stamp_string(stamp),
    )
    return value["next_check_at"] if value else None


def result_row(db, app):
    value = row(
        db,
        "SELECT * FROM health_results WHERE app_id=:id AND url_version=:version",
        id=app["id"],
        version=app["url_version"],
    )
    return value or dict(
        state="unchecked",
        checked_at=None,
        fresh_until=None,
        **dict.fromkeys(ADMIN_FIELDS),
    )


def snapshot(db, app_id, stamp, admin=False):
    stamp = stamp_string(stamp)
    app = app_row(db, app_id)
    result = result_row(db, app)
    latest = row(
        db,
        """SELECT * FROM health_jobs WHERE app_id=:id AND url_version=:version
        AND (finished_at IS NULL OR finished_at>:cutoff)
        ORDER BY created_at DESC,id DESC LIMIT 1""",
        id=app_id,
        version=app["url_version"],
        cutoff=after(stamp, -604800),
    )
    return {
        "app_id": app_id,
        "url_version": app["url_version"],
        "server_time": stamp,
        "health": {
            "result": {
                key: result[key]
                for key in RESULT_FIELDS + (ADMIN_FIELDS if admin else ())
            },
            "latest_job": {key: latest[key] for key in JOB_FIELDS} if latest else None,
            "next_check_at": cooldown(db, app_id, stamp),
        },
    }


def job_response(db, job_id, stamp, admin=False):
    job = row(
        db,
        """SELECT * FROM health_jobs WHERE id=:id
        AND (finished_at IS NULL OR finished_at>:cutoff)""",
        id=job_id,
        cutoff=after(stamp, -604800),
    )
    if job is None:
        raise AuthError("NOT_FOUND", 404)
    value = snapshot(db, job["app_id"], stamp, admin)
    # This URL version identifies the job. Health always describes the current URL.
    value["url_version"] = job["url_version"]
    value["job"] = {key: job[key] for key in JOB_FIELDS}
    return value


def settle(db, stamp):
    execute(
        db,
        """UPDATE health_batches SET finished_at=:stamp WHERE finished_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM health_batch_items WHERE batch_id=health_batches.id
        AND status IN ('queued','running'))""",
        stamp=stamp_string(stamp),
    )


def batch_view(db, batch_id, stamp):
    batch = row(
        db,
        """SELECT * FROM health_batches WHERE id=:id
        AND (finished_at IS NULL OR finished_at>:cutoff)""",
        id=batch_id,
        cutoff=after(stamp, -604800),
    )
    if batch is None:
        raise AuthError("NOT_FOUND", 404)
    counts = dict.fromkeys(
        ("queued", "running", "result_obtained", "failed", "cancelled", "reused"), 0
    )
    for item in execute(
        db,
        "SELECT status,disposition,count(*) AS n FROM health_batch_items WHERE batch_id=:id GROUP BY status,disposition",
        id=batch_id,
    ).mappings():
        counts[item["status"]] += item["n"]
        if (
            item["status"] == "result_obtained"
            and item["disposition"] == "result_reused"
        ):
            counts["reused"] += item["n"]
    return {
        "id": batch_id,
        "created_at": batch["created_at"],
        "finished_at": batch["finished_at"],
        "is_finished": batch["finished_at"] is not None,
        "server_time": stamp_string(stamp),
        "target_count": batch["target_count"],
        "processed_count": sum(
            counts[key] for key in ("result_obtained", "failed", "cancelled")
        ),
        "counts": counts,
    }


def batch_ids(db, stamp):
    batches = (
        execute(
            db,
            """SELECT id,finished_at FROM health_batches
        WHERE finished_at IS NULL OR finished_at>:cutoff ORDER BY created_at DESC,id DESC""",
            cutoff=after(stamp, -604800),
        )
        .mappings()
        .all()
    )
    return {
        "active_health_batch_id": next(
            (b["id"] for b in batches if b["finished_at"] is None), None
        ),
        "latest_health_batch_id": batches[0]["id"] if batches else None,
    }


def create_job(db, app, requested_by, stamp, individual):
    job_id = str(uuid4())
    execute(
        db,
        """INSERT INTO health_jobs(id,app_id,url_version,requested_by,individual,status,created_at)
        VALUES(:id,:app_id,:version,:requester,:individual,'queued',:stamp)""",
        id=job_id,
        app_id=app["id"],
        version=app["url_version"],
        requester=requested_by,
        individual=int(individual),
        stamp=stamp_string(stamp),
    )
    return row(db, "SELECT * FROM health_jobs WHERE id=:id", id=job_id)


def limited(reasons):
    error = AuthError("RATE_LIMITED", 429, retry_at=max(reasons.values()))
    error.reasons = list(reasons)
    raise error
