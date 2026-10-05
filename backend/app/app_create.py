"""Approved full members create apps atomically under their issued work key."""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import select, text

from app.admin_approval import check_json, operation, protected_member
from app.app_input import AppInput
from app.auth import open_session
from app.auth_boundary import AuthError, after, now, response
from app.models import App
from app.public_apps import AppDetailResponse, _app_detail

router = APIRouter(dependencies=[Depends(check_json)])


def app_operation_body(row):
    return {
        "key": row["key"],
        "kind": row["kind"],
        "target_id": row["target_id"],
        "issued_at": row["created_at"],
        "expires_at": row["expires_at"],
        "state": row["state"],
        "db_applied_at": row["db_applied_at"]
        if row["kind"] == "app_delete"
        else None
        if row["kind"] == "app_update" and row["state"] != "succeeded"
        else row["applied_at"],
        "finalized_at": row["applied_at"],
        "result_version": row["result_version"],
        "rejection_code": row["failure_code"],
        "server_time": now(),
    }


def issue_app_operation(db, request, body):
    item, actor = protected_member(db, request, write=True)
    stamp, key = now(), str(uuid4())
    db.execute(
        text(
            "INSERT INTO write_operations(key,actor_id,kind,request_hash,created_at,expires_at,state) VALUES (:key,:actor,'app_create',:hash,:stamp,:expiry,'unresolved')"
        ),
        {
            "key": key,
            "actor": actor["id"],
            "hash": body.request_hash(),
            "stamp": stamp,
            "expiry": after(stamp, 86400),
        },
    )
    protected_member(db, request, write=True)
    return response(
        db,
        request,
        app_operation_body(operation(db, key, actor)),
        status=201,
        private=True,
        metadata=item,
    )


def app_body(body: Annotated[AppInput, Body()]):
    return body


AppBody = Depends(app_body)


def app_database(request: Request, body=AppBody):
    # Validate/normalize before acquiring the write reservation.
    yield from open_session(request, immediate=True)


AppDb = Depends(app_database)


def idempotency_key(request):
    keys = request.headers.getlist("Idempotency-Key")
    try:
        if len(keys) != 1 or str(UUID(keys[0])) != keys[0]:
            raise ValueError()
        return keys[0]
    except ValueError:
        raise AuthError(
            "VALIDATION_ERROR", 422, fields={"form": "등록 작업 키를 확인해 주세요."}
        ) from None


@router.post("/apps")
def create_app(request: Request, body=AppBody, db=AppDb):
    item, actor = protected_member(db, request, write=True)
    key = idempotency_key(request)
    row = operation(db, key, actor)
    if row["kind"] != "app_create" or row["request_hash"] != body.request_hash():
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] == "rejected":
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    if row["state"] == "unresolved":
        app_id, stamp = str(uuid4()), now()
        values = {
            **body.model_dump(exclude={"grades"}),
            "id": app_id,
            "owner": actor["id"],
            "stamp": stamp,
        }
        db.execute(
            text(
                "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,stack_db,stack_backend,stack_frontend,stack_hosting,version,url_version,created_at,updated_at) VALUES (:id,:owner,:name,:url,:prompt,:description,:subject,:is_public,:theme_id,:stack_db,:stack_backend,:stack_frontend,:stack_hosting,1,1,:stamp,:stamp)"
            ),
            values,
        )
        db.execute(
            text("INSERT INTO app_grades(app_id,grade) VALUES (:id,:grade)"),
            [{"id": app_id, "grade": grade} for grade in body.grades],
        )
        db.execute(
            text("INSERT INTO health_results(app_id,state) VALUES (:id,'unchecked')"),
            {"id": app_id},
        )
        db.execute(
            text(
                "UPDATE write_operations SET state='succeeded',target_id=:id,result_version=1,applied_at=:stamp WHERE key=:key"
            ),
            {"id": app_id, "stamp": stamp, "key": key},
        )
    else:
        app_id = row["target_id"]
    saved = db.scalar(select(App).where(App.id == app_id))
    if saved is None:
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    detail = AppDetailResponse.model_validate(
        {"item": _app_detail(saved), "server_time": now()}
    ).model_dump(mode="json")
    protected_member(db, request, write=True)
    operation(db, key, actor)
    return response(db, request, detail, status=201, metadata=item)
