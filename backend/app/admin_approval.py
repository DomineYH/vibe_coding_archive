"""Current full administrators read members and resolve approval work keys."""

import json
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, Query, Request
from pydantic import Field
from sqlalchemy import text

from app.app_input import AppInput
from app.auth import Db, StrictModel, Unlocked, open_session
from app.auth_boundary import (
    AuthError,
    after,
    check_revision,
    credential,
    now,
    origin,
    pending,
    response,
)
from app.auth_login import member_session


def unique_fields(pairs):
    values = {}
    for key, value in pairs:
        if key in values:
            raise AuthError("BAD_REQUEST", 400)
        values[key] = value
    return values


async def check_json(request: Request):
    if request.method in ("POST", "PATCH") and (raw := await request.body()):
        try:
            json.loads(raw, object_pairs_hook=unique_fields)
        except (ValueError, UnicodeError):
            raise AuthError("BAD_REQUEST", 400) from None


router = APIRouter(dependencies=[Depends(check_json)])
Version = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class SetApproval(StrictModel):
    approved: Annotated[bool, Field(strict=True)]
    expected_account_version: Version


class CreateApproval(SetApproval):
    kind: Literal["user_approval"]
    target_id: UUID


class CreateAppOperation(StrictModel):
    kind: Literal["app_create"]
    input: AppInput


def operation_input(
    body: Annotated[CreateApproval | CreateAppOperation, Body(discriminator="kind")],
):
    return body


OperationBody = Depends(operation_input)


def operation_database(request: Request, body=OperationBody):
    yield from open_session(request, immediate=True)


OperationDb = Depends(operation_database)


def ordinary_target(db, id_, version):
    member = target(db, id_)
    if member["is_admin"]:
        raise AuthError("ADMIN_ACCOUNT_PROTECTED", 403)
    if member["account_version"] != version:
        raise AuthError("USER_STATE_CONFLICT")
    return member


def operation_body(row):
    return {
        "key": row["key"],
        "kind": row["kind"],
        "target_id": row["target_id"],
        "issued_at": row["created_at"],
        "expires_at": row["expires_at"],
        "state": row["state"],
        "applied_account_version": row["result_account_version"],
        "applied_approved": bool(row["result_approved"])
        if row["result_approved"] is not None
        else None,
        "finalized_at": row["applied_at"],
        "rejection_code": row["failure_code"],
        "server_time": now(),
    }


def operation(db, key, actor):
    row = (
        db.execute(
            text("SELECT * FROM write_operations WHERE key=:key AND actor_id=:actor"),
            {"key": str(key), "actor": actor["id"]},
        )
        .mappings()
        .first()
    )
    if not row:
        raise AuthError("OPERATION_NOT_FOUND", 404)
    if row["expires_at"] <= now():
        raise AuthError("OPERATION_EXPIRED", 410)
    return row


@router.post("/write-operations")
def create_operation(request: Request, body=OperationBody, db=OperationDb):
    if body.kind == "app_create":
        from app.app_create import issue_app_operation

        return issue_app_operation(db, request, body.input)
    item, actor = administrator(db, request, write=True)
    ordinary_target(db, body.target_id, body.expected_account_version)
    stamp = now()
    key = str(uuid4())
    db.execute(
        text(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,approved,created_at,expires_at,state) VALUES (:key,:actor,'user_approval',:target,:version,:approved,:stamp,:expiry,'unresolved')"
        ),
        {
            "key": key,
            "actor": actor["id"],
            "target": str(body.target_id),
            "version": body.expected_account_version,
            "approved": body.approved,
            "stamp": stamp,
            "expiry": after(stamp, 86400),
        },
    )
    administrator(db, request, write=True)
    return response(
        db,
        request,
        operation_body(operation(db, key, actor)),
        status=201,
        private=True,
        metadata=item,
    )


@router.get("/write-operations/{key}")
def get_operation(key: UUID, request: Request, db=Unlocked):
    db.execute(text("BEGIN"))
    kind = db.execute(
        text("SELECT kind FROM write_operations WHERE key=:key"), {"key": str(key)}
    ).scalar_one_or_none()
    if kind != "user_approval":
        from app.app_create import app_operation_body

        item, actor = protected_member(db, request)
        return response(
            db,
            request,
            app_operation_body(operation(db, key, actor)),
            private=True,
            metadata=item,
        )
    item, actor = administrator(db, request)
    return response(
        db,
        request,
        operation_body(operation(db, key, actor)),
        private=True,
        metadata=item,
    )


@router.post("/write-operations/{key}/cancel")
def cancel_operation(key: UUID, request: Request, db=Db):
    item, actor = administrator(db, request, write=True)
    row = operation(db, key, actor)
    if row["kind"] != "user_approval":
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] == "unresolved":
        stamp = now()
        db.execute(
            text(
                "UPDATE write_operations SET state='rejected',failure_code='OPERATION_CANCELLED',applied_at=:now WHERE key=:key"
            ),
            {"now": stamp, "key": str(key)},
        )
        db.execute(
            text(
                "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('cancel_user_approval',:actor,:target,:now,'rejected')"
            ),
            {"actor": actor["id"], "target": row["target_id"], "now": stamp},
        )
    administrator(db, request, write=True)
    return response(
        db,
        request,
        operation_body(operation(db, key, actor)),
        private=True,
        metadata=item,
    )


@router.patch("/admin/users/{id}/approval")
def set_approval(id: UUID, request: Request, body: SetApproval, db=Db):
    # PATCH uses the same short write lock as key issue/cancel (POST).
    db.execute(text("BEGIN IMMEDIATE"))
    item, actor = administrator(db, request, write=True)
    keys = request.headers.getlist("Idempotency-Key")
    try:
        if len(keys) != 1:
            raise ValueError()
        key = str(UUID(keys[0]))
        if key != keys[0]:
            raise ValueError()
    except ValueError:
        raise AuthError("VALIDATION_ERROR", 422) from None
    row = operation(db, key, actor)
    if (
        row["kind"] != "user_approval"
        or row["target_id"] != str(id)
        or row["expected_account_version"] != body.expected_account_version
        or bool(row["approved"]) != body.approved
    ):
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] != "unresolved":
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    try:
        member = ordinary_target(db, id, body.expected_account_version)
    except AuthError as error:
        stamp = now()
        db.execute(
            text(
                "UPDATE write_operations SET state='rejected',failure_code=:code,applied_at=:now WHERE key=:key"
            ),
            {"key": key, "code": error.code, "now": stamp},
        )
        db.execute(
            text(
                "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('user_approval',:actor,:target,:now,'rejected')"
            ),
            {"actor": actor["id"], "target": str(id), "now": stamp},
        )
        administrator(db, request, write=True)
        operation(db, key, actor)
        db.commit()
        raise
    if member["account_version"] == 9007199254740991:
        raise AuthError("SERVICE_UNAVAILABLE", 503)
    # Even a short transaction may wait at a DB boundary; do not spend an expired key.
    operation(db, key, actor)
    stamp = now()
    db.execute(
        text(
            "UPDATE members SET approval_status=:status,first_approved_at=:first,account_version=account_version+1,updated_at=:now WHERE id=:id"
        ),
        {
            "id": str(id),
            "now": stamp,
            "status": "approved"
            if body.approved
            else "revoked"
            if member["first_approved_at"]
            else "pending",
            "first": member["first_approved_at"] or (stamp if body.approved else None),
        },
    )
    if not body.approved:
        db.execute(
            text(
                "UPDATE sessions SET revoked_at=:now WHERE member_id=:id AND revoked_at IS NULL"
            ),
            {"now": stamp, "id": str(id)},
        )
    db.execute(
        text(
            "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('user_approval',:actor,:target,:now,'succeeded')"
        ),
        {"actor": actor["id"], "target": str(id), "now": stamp},
    )
    db.execute(
        text(
            "UPDATE write_operations SET state='succeeded',result_account_version=:version,result_approved=:approved,applied_at=:now WHERE key=:key"
        ),
        {
            "version": member["account_version"] + 1,
            "approved": body.approved,
            "now": stamp,
            "key": key,
        },
    )
    administrator(db, request, write=True)
    operation(db, key, actor)
    return response(
        db, request, user_body(db, target(db, id)), private=True, metadata=item
    )


def administrator(db, request, *, write=False):
    return protected_member(db, request, write=write, admin=True)


def protected_member(db, request, *, write=False, admin=False):
    if write:
        origin(request)
    elif not db.in_transaction():
        db.execute(text("BEGIN"))
    item, session, member = member_session(db, request)
    if session["kind"] != "full":
        raise AuthError("PASSWORD_CHANGE_REQUIRED", 403)
    if admin and not member["is_admin"]:
        raise AuthError("FORBIDDEN", 403)
    names = ("X-EduVibe-Auth-Revision", "X-EduVibe-Session-Generation")
    if any(request.headers.get(name) is None for name in names):
        raise AuthError("VALIDATION_ERROR", 422)
    check_revision(request, item, request.headers[names[0]], session["issued_seq"])
    if pending(db, item):
        raise AuthError("AUTH_TRANSITION_PENDING")
    if write:
        credential(db, request, item, "session", csrf=True)
    return item, member


def target(db, id_):
    member = (
        db.execute(text("SELECT * FROM members WHERE id=:id"), {"id": str(id_)})
        .mappings()
        .first()
    )
    if not member:
        raise AuthError("USER_NOT_FOUND", 404)
    return member


def user_body(db, member):
    return {
        "id": member["id"],
        "login_id": member["login_id"],
        "nickname": member["nickname"],
        "role": "admin" if member["is_admin"] else "user",
        "approved": member["approval_status"] == "approved",
        "account_version": member["account_version"],
        "app_count": db.execute(
            text("SELECT count(*) FROM apps WHERE owner_id=:id"), member
        ).scalar_one(),
        "created_at": member["created_at"],
        "first_approved_at": member["first_approved_at"],
        "pending_expires_at": after(member["created_at"], 90 * 86400)
        if member["first_approved_at"] is None
        else None,
    }


@router.get("/admin/users")
def list_users(
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    offset: Annotated[int, Query(ge=0, le=9007199254740991)] = 0,
    db=Unlocked,
):
    item, _ = administrator(db, request)
    users = (
        db.execute(
            text(
                "SELECT * FROM members ORDER BY (approval_status<>'approved') DESC,created_at,id LIMIT :limit OFFSET :offset"
            ),
            {"limit": limit, "offset": offset},
        )
        .mappings()
        .all()
    )
    total, unapproved = db.execute(
        text(
            "SELECT count(*),coalesce(sum(approval_status<>'approved'),0) FROM members"
        )
    ).one()
    total_apps = db.execute(text("SELECT count(*) FROM apps")).scalar_one()
    healthy, expiry = db.execute(
        text(
            "SELECT count(*),min(fresh_until) FROM health_results WHERE state='healthy' AND fresh_until>:now"
        ),
        {"now": now()},
    ).one()
    return response(
        db,
        request,
        {
            "items": [user_body(db, user) for user in users],
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": total,
                "has_more": offset + limit < total,
            },
            "stats": {
                "total_users": total,
                "pending_users": unapproved,
                "total_apps": total_apps,
                "healthy_apps": healthy,
                "next_health_expiry_at": expiry,
                "active_health_batch_id": None,
                "latest_health_batch_id": None,
            },
            "server_time": now(),
        },
        private=True,
        metadata=item,
    )


@router.get("/admin/users/{id}")
def get_user(id: UUID, request: Request, db=Unlocked):
    item, _ = administrator(db, request)
    return response(
        db, request, user_body(db, target(db, id)), private=True, metadata=item
    )
