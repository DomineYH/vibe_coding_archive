"""Recent administrators atomically delete ordinary members and current owned apps."""

import hashlib
import json
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from app.admin_approval import (
    DeleteAdminUserInput,
    administrator,
    check_json,
    operation,
    target,
)
from app.app_create import idempotency_key
from app.auth import Unlocked
from app.auth_boundary import AuthError, after, now, response
from app.auth_reauth import current_admin, require_recent_admin
from app.member_deletion import delete_member
from app.user_deletion_ledger import FIELDS, confirm, new_group

router = APIRouter(dependencies=[Depends(check_json)])


def delete_administrator(db, request, *, recent=False):
    if (
        not request.app.state.auth_enabled
        or not request.app.state.auth_ready
        or (recent and not request.app.state.user_delete_ready)
    ):
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    if recent:
        return require_recent_admin(db, request, write=True)
    item, actor = administrator(db, request)
    current_admin(db, request)
    return item, actor


def request_hash(actor_id, target_id, count):
    value = {
        "version": 1,
        "actor_id": actor_id,
        "kind": "user_delete",
        "target_id": str(target_id),
        "expected_app_count": count,
    }
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def user_delete_operation_body(row):
    return {
        "key": row["key"],
        "kind": row["kind"],
        "target_id": row["target_id"],
        "issued_at": row["created_at"],
        "expires_at": row["expires_at"],
        "state": row["state"],
        "db_applied_at": row["db_applied_at"],
        "finalized_at": row["applied_at"],
        "rejection_code": row["failure_code"],
        "server_time": now(),
    }


def current_apps(db, id_, count):
    member = target(db, id_)
    if member["is_admin"]:
        raise AuthError("ADMIN_ACCOUNT_PROTECTED", 403)
    apps = (
        db.execute(
            text("SELECT id FROM apps WHERE owner_id=:id ORDER BY id"), {"id": str(id_)}
        )
        .scalars()
        .all()
    )
    if len(apps) != count:
        raise AuthError("APP_COUNT_CONFLICT")
    return apps


def issue_user_delete_operation(db, request, body):
    item, actor = delete_administrator(db, request, recent=True)
    current_apps(db, body.target_id, body.expected_app_count)
    stamp, key = now(), str(uuid4())
    db.execute(
        text(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_app_count,request_hash,created_at,expires_at,state) VALUES (:key,:actor,'user_delete',:target,:count,:hash,:stamp,:expiry,'unresolved')"
        ),
        {
            "key": key,
            "actor": actor["id"],
            "target": str(body.target_id),
            "count": body.expected_app_count,
            "hash": request_hash(actor["id"], body.target_id, body.expected_app_count),
            "stamp": stamp,
            "expiry": after(stamp, 86400),
        },
    )
    delete_administrator(db, request, recent=True)
    return response(
        db,
        request,
        user_delete_operation_body(operation(db, key, actor)),
        status=201,
        private=True,
        metadata=item,
    )


@router.delete("/admin/users/{id}")
def delete_user(id: UUID, request: Request, body: DeleteAdminUserInput, db=Unlocked):
    db.execute(text("BEGIN IMMEDIATE"))
    item, actor = delete_administrator(db, request, recent=True)
    key = idempotency_key(request)
    row = operation(db, key, actor)
    if (
        row["kind"] != "user_delete"
        or row["target_id"] != str(id)
        or row["expected_app_count"] != body.expected_app_count
        or row["request_hash"] != request_hash(actor["id"], id, body.expected_app_count)
    ):
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] in ("succeeded", "rejected"):
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    if row["state"] == "unresolved":
        try:
            apps = current_apps(db, id, body.expected_app_count)
        except AuthError as error:
            if error.code not in (
                "USER_NOT_FOUND",
                "ADMIN_ACCOUNT_PROTECTED",
                "APP_COUNT_CONFLICT",
            ):
                raise
            stamp = now()
            db.execute(
                text(
                    "UPDATE write_operations SET state='rejected',failure_code=:code,applied_at=:stamp WHERE key=:key"
                ),
                {"code": error.code, "stamp": stamp, "key": key},
            )
            audit(db, actor["id"], str(id), stamp, "rejected")
            delete_administrator(db, request, recent=True)
            operation(db, key, actor)
            db.commit()
            raise
        stamp = now()
        rows = new_group(str(id), apps, stamp)
        group_id = rows[0]["group_id"]
        delete_member(db, str(id), stamp)
        audit(db, actor["id"], str(id), stamp, "db_applied")
        for event in rows:
            db.execute(
                text(
                    f"INSERT INTO user_delete_outbox({','.join(FIELDS)},operation_key) VALUES ({','.join(':' + f for f in FIELDS)},:key)"
                ),
                dict(event, key=key),
            )
        db.execute(
            text(
                "UPDATE write_operations SET state='confirming_deletion',db_applied_at=:stamp WHERE key=:key"
            ),
            {"stamp": stamp, "key": key},
        )
    else:
        group_id = db.execute(
            text(
                "SELECT group_id FROM user_delete_outbox WHERE operation_key=:key AND kind='member'"
            ),
            {"key": key},
        ).scalar_one()
    delete_administrator(db, request, recent=True)
    operation(db, key, actor)
    result = response(db, request, None, status=204, metadata=item)
    try:
        confirmed = confirm(request.app.state.session_factory, group_id)
    except RuntimeError:
        request.app.state.user_delete_corrupt = True
        request.app.state.user_delete_ready = False
        request.app.state.auth_ready = False
        confirmed = False
    if not confirmed:
        raise AuthError(
            "DELETION_CONFIRMATION_PENDING",
            503,
            message="회원과 앱 삭제가 반영되었고 삭제 결과 확인을 기다리고 있어요.",
        )
    return result


def audit(db, actor, id_, stamp, outcome):
    db.execute(
        text(
            "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('user_delete',:actor,:target,:stamp,:outcome)"
        ),
        {"actor": actor, "target": id_, "stamp": stamp, "outcome": outcome},
    )
