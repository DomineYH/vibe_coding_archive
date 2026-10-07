"""Owner or administrator app edits and atomic minimum operation results."""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import select, text

from app.admin_approval import check_json, operation, protected_member
from app.app_create import app_operation_body, idempotency_key
from app.app_input import UpdateAppInput, update_request_hash
from app.auth import open_session
from app.auth_boundary import AuthError, after, now, response
from app.models import App
from app.public_apps import AppDetailResponse, _app_detail

router = APIRouter(dependencies=[Depends(check_json)])


def authorize_app_change(app, actor):
    if app is None or (
        app.owner_id != actor["id"] and not actor["is_admin"] and not app.is_public
    ):
        raise AuthError("NOT_FOUND", 404, message="아카이브 앱을 찾을 수 없어요.")
    if app.owner_id != actor["id"] and not actor["is_admin"]:
        raise AuthError("FORBIDDEN", 403)


def writable_target(db, app_id, actor):
    app = db.scalar(select(App).where(App.id == str(app_id)))
    authorize_app_change(app, actor)
    return app


def issue_update_operation(db, request, body):
    item, actor = protected_member(db, request, write=True)
    app = writable_target(db, body.target_id, actor)
    if app.version != body.expected_version:
        raise AuthError("VERSION_CONFLICT")
    stamp, key = now(), str(uuid4())
    db.execute(
        text(
            "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_version,request_hash,created_at,expires_at,state) VALUES (:key,:actor,'app_update',:target,:version,:hash,:stamp,:expiry,'unresolved')"
        ),
        {
            "key": key,
            "actor": actor["id"],
            "target": str(body.target_id),
            "version": body.expected_version,
            "hash": update_request_hash(
                body.target_id,
                body.expected_version,
                body.input.model_dump(exclude_unset=True),
            ),
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


def patch_body(body: Annotated[UpdateAppInput, Body()]):
    return body


PatchBody = Depends(patch_body)


def patch_database(request: Request, body=PatchBody):
    # open_session's error boundary includes the PATCH reservation below.
    yield from open_session(request, immediate=False)


PatchDb = Depends(patch_database)


@router.patch("/apps/{id}")
def update_app(id: UUID, request: Request, body=PatchBody, db=PatchDb):
    db.execute(text("BEGIN IMMEDIATE"))
    item, actor = protected_member(db, request, write=True)
    key = idempotency_key(request)
    row = operation(db, key, actor)
    if (
        row["kind"] != "app_update"
        or row["target_id"] != str(id)
        or row["expected_version"] != body.expected_version
        or row["request_hash"] != body.request_hash(id)
    ):
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] != "unresolved":
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    if db.scalar(select(App.id).where(App.id == str(id))) is None:
        db.execute(
            text(
                "UPDATE write_operations SET state='rejected',failure_code='NOT_FOUND',applied_at=:stamp WHERE key=:key"
            ),
            {"key": key, "stamp": now()},
        )
        protected_member(db, request, write=True)
        operation(db, key, actor)
        db.commit()
        raise AuthError("NOT_FOUND", 404, message="아카이브 앱을 찾을 수 없어요.")
    app = writable_target(db, id, actor)
    if app.version != body.expected_version:
        db.execute(
            text(
                "UPDATE write_operations SET state='rejected',failure_code='VERSION_CONFLICT',applied_at=:stamp WHERE key=:key"
            ),
            {"key": key, "stamp": now()},
        )
        _, current_actor = protected_member(db, request, write=True)
        authorize_app_change(app, current_actor)
        operation(db, key, actor)
        db.commit()
        raise AuthError("VERSION_CONFLICT")
    if app.version == 9007199254740991:
        raise AuthError("SERVICE_UNAVAILABLE", 503)
    operation(db, key, actor)
    patch = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    url_changed = (
        "url" in patch and app.url.split("#", 1)[0] != patch["url"].split("#", 1)[0]
    )
    if url_changed and app.url_version == 9007199254740991:
        raise AuthError("SERVICE_UNAVAILABLE", 503)
    version, stamp = app.version + 1, now()
    columns = {field: value for field, value in patch.items() if field != "grades"}
    assignments = [f"{field}=:{field}" for field in columns]
    assignments += ["version=:new_version", "updated_at=:stamp"]
    if url_changed:
        assignments.append("url_version=url_version+1")
    db.execute(
        text(f"UPDATE apps SET {','.join(assignments)} WHERE id=:id"),
        {**columns, "id": str(id), "new_version": version, "stamp": stamp},
    )
    if "grades" in patch:
        db.execute(text("DELETE FROM app_grades WHERE app_id=:id"), {"id": str(id)})
        db.execute(
            text("INSERT INTO app_grades(app_id,grade) VALUES (:id,:grade)"),
            [{"id": str(id), "grade": grade} for grade in patch["grades"]],
        )
    if url_changed:
        db.execute(
            text(
                "INSERT INTO health_results(app_id,state) VALUES (:id,'unchecked') ON CONFLICT(app_id) DO UPDATE SET state='unchecked',checked_at=NULL,fresh_until=NULL"
            ),
            {"id": str(id)},
        )
    if app.owner_id != actor["id"]:
        db.execute(
            text(
                "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('app_update',:actor,:id,:stamp,'succeeded')"
            ),
            {"actor": actor["id"], "id": str(id), "stamp": stamp},
        )
    db.execute(
        text(
            "UPDATE write_operations SET state='succeeded',result_version=:version,applied_at=:stamp WHERE key=:key"
        ),
        {"key": key, "version": version, "stamp": stamp},
    )
    # SQL writes replaced relationships; serialize current values before commit.
    db.expire_all()
    detail = AppDetailResponse.model_validate(
        {"item": _app_detail(app), "server_time": now()}
    ).model_dump(mode="json")
    _, current_actor = protected_member(db, request, write=True)
    authorize_app_change(app, current_actor)
    operation(db, key, actor)
    return response(db, request, detail, metadata=item)
