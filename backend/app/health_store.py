"""Persistent health queue API. Caller owns the immediate transaction and commit."""

from uuid import uuid4

from app.auth_boundary import AuthError
from app.health_store_views import (
    active_job,
    after,
    app_row,
    batch_ids,
    batch_view,
    cooldown,
    create_job,
    execute,
    job_response,
    limited,
    result_row,
    row,
    settle,
    snapshot,
    stamp_string,
)
from app.health_store_worker import (
    availability,
    cancel_all,
    claim,
    current_worker,
    fail,
    finish,
    heartbeat,
    invalidate,
    maintain,
)

__all__ = [
    "availability",
    "batch_ids",
    "batch_view",
    "cancel_all",
    "claim",
    "current_worker",
    "fail",
    "finish",
    "heartbeat",
    "invalidate",
    "job_response",
    "maintain",
    "request_batch",
    "request_check",
    "snapshot",
]


def request_check(
    db, app_id, actor_key, requested_by, stamp, available=True, admin=False
):
    stamp = stamp_string(stamp)
    app = app_row(db, app_id)
    requests = (
        execute(
            db,
            """SELECT created_at FROM health_requests WHERE actor_key=:actor
        AND created_at>:cutoff ORDER BY created_at,id""",
            actor=actor_key,
            cutoff=after(stamp, -60),
        )
        .scalars()
        .all()
    )
    reasons = {}
    if len(requests) >= 10:
        reasons["actor_rate_limit"] = after(requests[-10], 60)
    else:
        execute(
            db,
            "INSERT INTO health_requests(actor_key,created_at) VALUES(:actor,:stamp)",
            actor=actor_key,
            stamp=stamp,
        )
    if not available:
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    active = active_job(db, app_id)
    next_check = cooldown(db, app_id, stamp)
    result = result_row(db, app)
    if active is None and next_check and result["state"] == "unchecked":
        reasons["app_cooldown"] = next_check
    if reasons:
        limited(reasons)
    if active:
        execute(db, "UPDATE health_jobs SET individual=1 WHERE id=:id", id=active["id"])
        disposition = "active_reused"
    elif next_check:
        disposition = "result_reused"
    else:
        create_job(db, app, requested_by, stamp, True)
        disposition = "created"
    return (
        200 if disposition == "result_reused" else 202,
        dict(snapshot(db, app_id, stamp, admin), disposition=disposition),
    )


def request_batch(db, requested_by, stamp, available=True):
    stamp = stamp_string(stamp)
    if not available:
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    active = row(db, "SELECT id FROM health_batches WHERE finished_at IS NULL")
    if active:
        return 202, {
            "disposition": "active_reused",
            "batch": batch_view(db, active["id"], stamp),
        }
    latest = row(
        db,
        "SELECT created_at FROM health_batches ORDER BY created_at DESC,id DESC LIMIT 1",
    )
    if latest and after(latest["created_at"], 300) > stamp:
        limited({"batch_cooldown": after(latest["created_at"], 300)})
    apps = execute(db, "SELECT id,url_version FROM apps ORDER BY id").mappings().all()
    batch_id = str(uuid4())
    execute(
        db,
        """INSERT INTO health_batches(id,requested_by,created_at,target_count)
        VALUES(:id,:requester,:stamp,:count)""",
        id=batch_id,
        requester=requested_by,
        stamp=stamp,
        count=len(apps),
    )
    for ordinal, app in enumerate(apps):
        job = active_job(db, app["id"])
        if job:
            disposition, status = "active_reused", job["status"]
        elif (
            cooldown(db, app["id"], stamp)
            and result_row(db, app)["state"] != "unchecked"
        ):
            disposition, status = "result_reused", "result_obtained"
        else:
            job = create_job(db, app, requested_by, stamp, False)
            disposition, status = "created", "queued"
        execute(
            db,
            """INSERT INTO health_batch_items(batch_id,ordinal,app_id,job_id,url_version,disposition,status)
            VALUES(:batch,:ordinal,:app,:job,:version,:disposition,:status)""",
            batch=batch_id,
            ordinal=ordinal,
            app=app["id"],
            job=job["id"] if job else None,
            version=app["url_version"],
            disposition=disposition,
            status=status,
        )
    settle(db, stamp)
    return 202, {"disposition": "created", "batch": batch_view(db, batch_id, stamp)}
