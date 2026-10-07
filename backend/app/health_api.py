"""Current-permission health reads and durable check admission; never network I/O."""

import re

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import health_store
from app.auth_boundary import (
    AuthError,
    now,
    read_context,
    response,
    screen_read_context,
)
from app.health_runtime import boot_clock, runtime_enabled
from app.public_apps import UUID_PATTERN

router = APIRouter()


def database(request: Request):
    with request.app.state.session_factory() as db:
        try:
            yield db
        except SQLAlchemyError as error:
            db.rollback()
            raise AuthError(
                "DB_BUSY" if "locked" in str(error).lower() else "SERVICE_UNAVAILABLE",
                503,
            ) from None


Db = Depends(database)


def no_query(request):
    if request.scope["query_string"]:
        raise AuthError("VALIDATION_ERROR", 422)


def identifier(value):
    if not re.fullmatch(UUID_PATTERN, value):
        raise AuthError("NOT_FOUND", 404, message="요청한 자료를 찾을 수 없습니다.")
    return value.lower()


def readable_app(db, id_, member):
    app = (
        db.execute(
            text("SELECT id,owner_id,is_public FROM apps WHERE id=:id"), {"id": id_}
        )
        .mappings()
        .first()
    )
    if app is None or not (
        app["is_public"]
        or member is not None
        and (member["is_admin"] or member["id"] == app["owner_id"])
    ):
        raise AuthError("NOT_FOUND", 404, message="요청한 자료를 찾을 수 없습니다.")
    return app


def read_actor(db, request):
    context = read_context(request)
    # A consistent read transaction binds authorization to the returned snapshot.
    db.execute(text("BEGIN"))
    item, _, member = screen_read_context(db, request, context)
    return item, member


def checks_available(db, request):
    state = request.app.state
    if not state.auth_enabled or not state.auth_ready:
        return False
    if not state.health_testing and not runtime_enabled(state.settings):
        return False
    boot_id, mono = boot_clock()
    return health_store.availability(db, boot_id=boot_id, mono=mono)


@router.get("/apps/{id}/health", operation_id="getAppHealth")
def get_app_health(id: str, request: Request, db=Db):
    no_query(request)
    item, member = read_actor(db, request)
    app_id = identifier(id)
    readable_app(db, app_id, member)
    body = health_store.snapshot(
        db,
        app_id,
        now(),
        admin=bool(member and member["is_admin"]),
        available=checks_available(db, request),
    )
    return response(db, request, body, metadata=item, private=True)


async def empty_body(request: Request):
    if await request.body():
        raise AuthError("VALIDATION_ERROR", 422)


def write_actor(db, request):
    """Anonymous session proof is sufficient only for publicly readable targets."""
    from app.admin_approval import protected_member
    from app.auth_boundary import check_revision, credential, flow, origin, pending

    origin(request)
    if not request.app.state.auth_enabled or not request.app.state.auth_ready:
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    db.execute(text("BEGIN IMMEDIATE"))
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"))
    session = credential(db, request, item, "session", csrf=True)
    context = read_context(request)
    if context is None:
        raise AuthError("VALIDATION_ERROR", 422)
    check_revision(request, item, context[1], session["issued_seq"])
    if pending(db, item):
        raise AuthError("AUTH_TRANSITION_PENDING")
    if session["kind"] != "anonymous":
        return protected_member(db, request, write=True)
    return item, None


def actor_key(request, member):
    import ipaddress

    from app.auth_boundary import digest

    if member is not None:
        return "member:" + member["id"]
    try:
        peer = str(ipaddress.ip_address(request.client.host))
    except (ValueError, AttributeError):
        raise AuthError("SERVICE_UNAVAILABLE", 503) from None
    return "ip:" + digest(peer)


@router.post(
    "/apps/{id}/health-checks",
    operation_id="requestAppHealthCheck",
    dependencies=[Depends(empty_body)],
)
def request_app_check(id: str, request: Request, db=Db):
    no_query(request)
    item, member = write_actor(db, request)
    app_id = identifier(id)
    readable_app(db, app_id, member)
    try:
        status, body = health_store.request_check(
            db,
            app_id,
            actor_key(request, member),
            member["id"] if member else None,
            now(),
            available=checks_available(db, request),
            admin=bool(member and member["is_admin"]),
        )
    except AuthError as error:
        if error.code == "FEATURE_UNAVAILABLE":
            error.reasons = ["operational_restriction"]
        # Count requests admitted by current permission/Origin/CSRF even if limited.
        db.commit()
        raise
    return response(db, request, body, status=status, metadata=item, private=True)


@router.get("/health-checks/{id}", operation_id="getHealthCheckJob")
def get_health_job(id: str, request: Request, db=Db):
    no_query(request)
    item, member = read_actor(db, request)
    job_id = identifier(id)
    app_id = db.execute(
        text("SELECT app_id FROM health_jobs WHERE id=:id"), {"id": job_id}
    ).scalar_one_or_none()
    if app_id is None:
        raise AuthError("NOT_FOUND", 404, message="요청한 자료를 찾을 수 없습니다.")
    readable_app(db, app_id, member)
    body = health_store.job_response(
        db, job_id, now(), admin=bool(member and member["is_admin"])
    )
    if not checks_available(db, request):
        body["health"]["next_check_at"] = None
    return response(db, request, body, metadata=item, private=True)


@router.post(
    "/admin/health-check-batches",
    operation_id="requestAdminHealthBatch",
    dependencies=[Depends(empty_body)],
)
def request_health_batch(request: Request, db=Db):
    no_query(request)
    item, member = write_actor(db, request)
    if member is None:
        raise AuthError("AUTH_REQUIRED", 401)
    if not member["is_admin"]:
        raise AuthError("FORBIDDEN", 403)
    try:
        status, body = health_store.request_batch(
            db, member["id"], now(), available=checks_available(db, request)
        )
    except AuthError as error:
        if error.code == "FEATURE_UNAVAILABLE":
            error.reasons = ["operational_restriction"]
        db.commit()
        raise
    return response(db, request, body, status=status, metadata=item, private=True)


@router.get("/admin/health-check-batches/{id}", operation_id="getAdminHealthBatch")
def get_health_batch(id: str, request: Request, db=Db):
    from app.admin_approval import administrator

    no_query(request)
    read_context(request)
    if not request.app.state.auth_enabled or not request.app.state.auth_ready:
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    item, _ = administrator(db, request)
    body = health_store.batch_view(db, identifier(id), now())
    return response(db, request, body, metadata=item, private=True)
