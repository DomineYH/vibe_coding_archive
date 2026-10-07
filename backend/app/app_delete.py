"""Owner or administrator deletion with independent durable confirmation."""

import hashlib
import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import select, text

from app.admin_approval import Version, check_json, operation, protected_member
from app.app_create import app_operation_body, idempotency_key
from app.app_deletion_ledger import confirm
from app.app_update import authorize_app_change, writable_target
from app.auth import StrictModel, open_session
from app.auth_boundary import AuthError, after, now, response
from app.models import App

router = APIRouter(dependencies=[Depends(check_json)])


class DeleteAppInput(StrictModel):
    expected_version: Version


def request_hash(target_id, version):
    return hashlib.sha256(
        json.dumps(
            {
                "kind": "app_delete",
                "target_id": str(target_id),
                "expected_version": version,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def issue_delete_operation(db, request, body):
    item, actor = protected_member(db, request, write=True)
    app = writable_target(db, body.target_id, actor)
    if app.version != body.expected_version:
        raise AuthError("VERSION_CONFLICT")
    stamp, key = now(), str(uuid4())
    db.execute(
        text(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_version,request_hash,created_at,expires_at,state) VALUES (:key,:actor,'app_delete',:target,:version,:hash,:stamp,:expiry,'unresolved')"
        ),
        {
            "key": key,
            "actor": actor["id"],
            "target": str(body.target_id),
            "version": body.expected_version,
            "hash": request_hash(body.target_id, body.expected_version),
            "stamp": stamp,
            "expiry": after(stamp, 86400),
        },
    )
    _, current_actor = protected_member(db, request, write=True)
    authorize_app_change(app, current_actor)
    return response(
        db,
        request,
        app_operation_body(operation(db, key, actor)),
        status=201,
        private=True,
        metadata=item,
    )


def delete_body(body: Annotated[DeleteAppInput, Body()]):
    return body


DeleteBody = Depends(delete_body)


def delete_database(request: Request, body=DeleteBody):
    yield from open_session(request, immediate=False)


DeleteDb = Depends(delete_database)


@router.delete("/apps/{id}")
def delete_app(id: UUID, request: Request, body=DeleteBody, db=DeleteDb):
    db.execute(text("BEGIN IMMEDIATE"))
    item, actor = protected_member(db, request, write=True)
    key = idempotency_key(request)
    row = operation(db, key, actor)
    if (
        row["kind"] != "app_delete"
        or row["target_id"] != str(id)
        or row["expected_version"] != body.expected_version
        or row["request_hash"] != request_hash(id, body.expected_version)
    ):
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] in ("succeeded", "rejected"):
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    if row["state"] == "unresolved":
        exists = db.scalar(select(App.id).where(App.id == str(id)))
        app = writable_target(db, id, actor) if exists else None
        rejection = (
            "NOT_FOUND"
            if app is None
            else "VERSION_CONFLICT"
            if app.version != body.expected_version
            else None
        )
        if rejection:
            db.execute(
                text(
                    "UPDATE write_operations SET state='rejected',failure_code=:code,applied_at=:stamp WHERE key=:key"
                ),
                {"code": rejection, "stamp": now(), "key": key},
            )
            _, current_actor = protected_member(db, request, write=True)
            if app is not None:
                authorize_app_change(app, current_actor)
            operation(db, key, actor)
            db.commit()
            if rejection == "NOT_FOUND":
                raise AuthError(
                    "NOT_FOUND", 404, message="아카이브 앱을 찾을 수 없어요."
                )
            raise AuthError("VERSION_CONFLICT")
        stamp, event_id = now(), str(uuid4())
        db.execute(text("DELETE FROM apps WHERE id=:id"), {"id": str(id)})
        db.execute(
            text(
                "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('app_delete',:actor,:id,:stamp,'db_applied')"
            ),
            {"actor": actor["id"], "id": str(id), "stamp": stamp},
        )
        db.execute(
            text(
                "INSERT INTO app_delete_outbox(event_id,operation_key,app_id,source,db_applied_at) VALUES (:event,:key,:id,'interactive_app_delete',:stamp)"
            ),
            {"event": event_id, "key": key, "id": str(id), "stamp": stamp},
        )
        db.execute(
            text(
                "UPDATE write_operations SET state='confirming_deletion',db_applied_at=:stamp WHERE key=:key"
            ),
            {"stamp": stamp, "key": key},
        )
    else:
        event_id = db.execute(
            text("SELECT event_id FROM app_delete_outbox WHERE operation_key=:key"),
            {"key": key},
        ).scalar_one()
    _, current_actor = protected_member(db, request, write=True)
    if row["state"] == "unresolved":
        authorize_app_change(app, current_actor)
    operation(db, key, actor)
    # Prepare cookie cleanup and commit before independent storage I/O.
    result = response(db, request, None, status=204, metadata=item)
    try:
        confirmed = confirm(request.app.state.session_factory, event_id)
    except RuntimeError:
        confirmed = False
    if not confirmed:
        raise AuthError(
            "DELETION_CONFIRMATION_PENDING",
            503,
            message="앱 삭제가 반영되었고 삭제 결과 확인을 기다리고 있어요.",
        )
    return result
