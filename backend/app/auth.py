"""T01 preparation and recovery HTTP boundary; login/logout/me live in auth_login."""

import secrets
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth_boundary import (
    AuthError,
    advance,
    after,
    check_revision,
    cookie_budget,
    cookie_name,
    credential,
    current_session,
    digest,
    eligible,
    flow,
    increment,
    now,
    origin,
    pending,
    proof_context,
    rate_limit,
    response,
    save_flow,
    terminalize,
    transition_summary,
)

router = APIRouter(prefix="/auth")
Seq = Annotated[str, Field(strict=True, pattern=r"^(0|[1-9][0-9]*)$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateFlow(StrictModel):
    # Normal recovery discovers at most eight flows under the shared eight-cookie budget.
    restart_from: list[UUID] = Field(max_length=8)


class ExpectedRevision(StrictModel):
    expected_revision: Seq


class RotateRecovery(ExpectedRevision):
    expected_session_generation: Seq


class ResetFlow(ExpectedRevision):
    expected_session_generation: Seq | None = None


class Admission(RotateRecovery):
    flow_id: UUID
    transition_id: str
    kind: Literal[
        "anonymous_session", "login", "logout", "password_change", "reauthenticate"
    ]
    expected_session_generation: Seq | None


class Settle(ExpectedRevision):
    flow_id: UUID


class Discard(Settle):
    expected_session_generation: Seq


def open_session(request: Request, *, immediate: bool):
    if not request.app.state.auth_testing or not request.app.state.auth_ready:
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    with request.app.state.session_factory() as db:
        try:
            if request.method == "POST":
                origin(request)
                if immediate:
                    db.execute(text("BEGIN IMMEDIATE"))
            yield db
        except SQLAlchemyError as error:
            db.rollback()
            if "locked" in str(error).lower():
                raise AuthError("DB_BUSY", 503) from None
            raise AuthError("SERVICE_UNAVAILABLE", 503) from None


def auth_session(request: Request):
    yield from open_session(request, immediate=True)


def unlocked_session(request: Request):
    # Login hashes outside any write transaction and opens its own phases.
    yield from open_session(request, immediate=False)


Db = Depends(auth_session)
Unlocked = Depends(unlocked_session)


def recovery_body(item, row):
    return {
        "flow_id": item["id"],
        "revision": item["revision"],
        "recovery_csrf_token": row["recovery_csrf_token"],
        "expires_at": row["expires_at"],
    }


def issue_recovery(db, request, item):
    seq = increment(item["issued_seq"])
    token = secrets.token_urlsafe(32)
    name = cookie_name(request, "recovery", item["id"], seq)
    cookie_budget(request, name, token)
    db.execute(
        text(
            "UPDATE recovery_credentials SET revoked_at=:now WHERE flow_id=:id AND revoked_at IS NULL"
        ),
        {"now": now(), "id": item["id"]},
    )
    item.update(issued_seq=seq, current_recovery_seq=seq, recovery_ready=0)
    advance(db, item)
    row = {
        "hash": digest(token),
        "id": item["id"],
        "seq": seq,
        "recovery_csrf_token": secrets.token_urlsafe(32),
        "now": now(),
        "expires_at": item["expires_at"],
    }
    db.execute(
        text(
            "INSERT INTO recovery_credentials(token_hash,flow_id,issued_seq,recovery_csrf_token,created_at,expires_at) VALUES (:hash,:id,:seq,:recovery_csrf_token,:now,:expires_at)"
        ),
        row,
    )
    return row, (name, token)


@router.post("/flows")
def create_flow(request: Request, body: CreateFlow, db=Db):
    previous = [str(value) for value in body.restart_from]
    if len(set(previous)) != len(previous):
        raise AuthError("VALIDATION_ERROR", 422)
    for flow_id in previous:
        # Missing previously allocated IDs are permanently non-recreatable.
        old = (
            db.execute(text("SELECT * FROM auth_flows WHERE id=:id"), {"id": flow_id})
            .mappings()
            .first()
        )
        if old and not eligible(db, old):
            raise AuthError("AUTH_STATE_CHANGED")
    if proof_context(db, request):
        raise AuthError("AUTH_STATE_CHANGED")
    rate_limit(db, request, "prepare")
    item = {"id": str(uuid4()), "revision": "0", "issued_seq": "0", "now": now()}
    if db.execute(
        text("SELECT 1 FROM auth_retired_flow_ids WHERE id_hash=:hash"),
        {"hash": digest(item["id"])},
    ).first():
        raise AuthError("AUTH_BUSY", 503)
    item["expires_at"] = after(item["now"], 1800)
    db.execute(
        text(
            "INSERT INTO auth_flows(id,revision,issued_seq,recovery_ready,ever_ready,last_identity_change_revision,created_at,last_activity_at,expires_at) VALUES (:id,:revision,:issued_seq,0,0,'0',:now,:now,:expires_at)"
        ),
        item,
    )
    return response(
        db,
        request,
        {"flow_id": item["id"], "revision": "0", "expires_at": item["expires_at"]},
        status=201,
    )


@router.post("/flows/{flow_id}/recovery-cookie")
def first_recovery(flow_id: str, request: Request, db=Db):
    item = flow(db, flow_id)
    if item["ever_ready"] or item["current_recovery_seq"] is not None:
        raise AuthError("AUTH_STATE_CHANGED")
    rate_limit(db, request, "prepare")
    row, cookie = issue_recovery(db, request, item)
    return response(db, request, recovery_body(item, row), status=201, cookie=cookie)


@router.post("/flows/{flow_id}/ready")
def ready(flow_id: str, request: Request, body: ExpectedRevision, db=Db):
    item = flow(db, flow_id, proof_kind="recovery")
    credential(db, request, item, "recovery", csrf=True)
    check_revision(request, item, body.expected_revision)
    if not item["recovery_ready"]:
        item.update(recovery_ready=1, ever_ready=1)
        advance(db, item, activity=True)
    return response(
        db,
        request,
        {
            "flow_id": flow_id,
            "revision": item["revision"],
            "expires_at": item["expires_at"],
            "ready": True,
        },
    )


@router.post("/flows/{flow_id}/abandon")
def abandon(flow_id: str, request: Request, db=Db):
    item = flow(db, flow_id, live=False)
    if item["ever_ready"]:
        raise AuthError("AUTH_STATE_CHANGED")
    rate_limit(db, request, "prepare")
    revoke_flow(db, item)
    return response(db, request, {"restart_eligible": True})


@router.get("/recovery-context")
def recovery_context(request: Request, db=Db):
    return response(db, request, {"items": proof_context(db, request)})


@router.get("/flows/{flow_id}/recovery-csrf")
def recovery_csrf(flow_id: str, request: Request, db=Db):
    item = flow(db, flow_id, proof_kind="recovery")
    row = credential(db, request, item, "recovery")
    return response(db, request, recovery_body(item, row))


@router.get("/flows/{flow_id}/restart-eligibility")
def restart_eligibility(flow_id: str, request: Request, db=Db):
    try:
        item = flow(db, flow_id, live=False)
    except AuthError as error:
        if error.code != "AUTH_REQUIRED":
            raise
        return response(db, request, {"restart_eligible": True})
    return response(db, request, {"restart_eligible": eligible(db, item)})


@router.get("/flow-state")
def flow_state(request: Request, transition_id: str | None = None, db=Db):
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"), proof_kind="recovery")
    credential(db, request, item, "recovery")
    selected = current_session(db, item)
    present = credential(db, request, item, "session", required=False) is not None
    unresolved = pending(db, item)
    next_id = (
        f"{item['id']}.{item['revision']}"
        if item["recovery_ready"] and not unresolved and (not selected or present)
        else None
    )
    return response(
        db,
        request,
        {
            "flow_id": item["id"],
            "revision": item["revision"],
            "server_time": now(),
            "expires_at": item["expires_at"],
            "recovery_ready": bool(item["recovery_ready"]),
            "session_generation": selected["issued_seq"] if selected else None,
            "session_cookie_present": present,
            "last_identity_change_revision": item["last_identity_change_revision"],
            "pending_transition": transition_summary(
                db, item, unresolved["transition_id"]
            )
            if unresolved
            else None,
            "requested_transition": transition_summary(db, item, transition_id)
            if transition_id
            else None,
            "next_transition_id": next_id,
        },
    )


def insert_transition(db, item, body, source):
    previous = item["revision"]
    advance(db, item)
    row = {
        "id": body.transition_id,
        "flow": item["id"],
        "kind": body.kind,
        "source": source,
        "before": previous,
        "revision": item["revision"],
        "now": now(),
    }
    row["permit"] = min(after(row["now"], 60), item["expires_at"])
    db.execute(
        text(
            "INSERT INTO auth_transitions(transition_id,flow_id,kind,source_session_generation,before_revision,admitted_revision,permit_expires_at,state,admitted_at) VALUES (:id,:flow,:kind,:source,:before,:revision,:permit,'admitted',:now)"
        ),
        row,
    )
    return row


@router.post("/transitions")
def admit(request: Request, body: Admission, db=Db):
    item = flow(
        db,
        str(body.flow_id),
        proof_kind="recovery" if body.kind == "anonymous_session" else None,
    )
    if body.kind == "reauthenticate":
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    member_kind = body.kind in ("login", "logout", "password_change")
    session = None
    if member_kind:
        # Member operations spend the current S and its CSRF, not R.
        session = credential(db, request, item, "session", csrf=True)
        if (
            body.expected_session_generation is None
            or session["issued_seq"] != body.expected_session_generation
        ):
            raise AuthError("AUTH_STATE_CHANGED")
    else:
        credential(db, request, item, "recovery", csrf=True)
    check_revision(
        request, item, body.expected_revision, body.expected_session_generation
    )
    if not item["recovery_ready"]:
        raise AuthError("AUTH_STATE_CHANGED")
    if pending(db, item):
        raise AuthError("AUTH_TRANSITION_PENDING")
    if member_kind:
        if body.kind == "login" and session["kind"] != "anonymous":
            raise AuthError("ALREADY_AUTHENTICATED")
        if body.kind == "password_change" and session["kind"] != "change_only":
            raise AuthError("SESSION_KIND_NOT_ALLOWED", 403)
    elif current_session(db, item) or body.expected_session_generation is not None:
        raise AuthError("AUTH_STATE_CHANGED")
    if body.transition_id != f"{item['id']}.{item['revision']}":
        raise AuthError("AUTH_STATE_CHANGED")
    row = insert_transition(db, item, body, session["issued_seq"] if session else None)
    return response(
        db,
        request,
        {
            "flow_id": item["id"],
            "revision": item["revision"],
            "transition_id": body.transition_id,
            "kind": body.kind,
            "permit_expires_at": row["permit"],
        },
        status=201,
    )


@router.post("/anonymous-session")
def anonymous(request: Request, body: ExpectedRevision, db=Db):
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"), proof_kind="recovery")
    credential(db, request, item, "recovery", csrf=True)
    check_revision(request, item, body.expected_revision)
    transition = pending(db, item)
    if (
        not item["recovery_ready"]
        or not transition
        or transition["transition_id"] != request.headers.get("X-EduVibe-Transition-Id")
        or transition["state"] != "admitted"
        or transition["admitted_revision"] != item["revision"]
        or transition["kind"] != "anonymous_session"
    ):
        raise AuthError("AUTH_STATE_CHANGED")
    if transition["permit_expires_at"] <= now() or current_session(db, item):
        raise AuthError("AUTH_STATE_CHANGED")
    seq = increment(item["issued_seq"])
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    name = cookie_name(request, "session", item["id"], seq)
    cookie_budget(request, name, token)
    rate_limit(db, request, "anonymous")
    db.execute(
        text(
            "UPDATE auth_transitions SET state='executing' WHERE transition_id=:id AND state='admitted'"
        ),
        {"id": transition["transition_id"]},
    )
    timestamp = now()
    expiry = after(timestamp, 900)
    if transition["permit_expires_at"] <= timestamp or item["expires_at"] <= timestamp:
        raise AuthError("AUTH_STATE_CHANGED")
    db.execute(
        text(
            "INSERT INTO sessions(token_hash,flow_id,issued_seq,kind,csrf_token,created_at,last_activity_at,absolute_expires_at,expires_at) VALUES (:hash,:flow,:seq,'anonymous',:csrf,:now,:now,:expiry,:expiry)"
        ),
        {
            "hash": digest(token),
            "flow": item["id"],
            "seq": seq,
            "csrf": csrf,
            "now": timestamp,
            "expiry": expiry,
        },
    )
    item.update(issued_seq=seq, current_session_generation=seq)
    advance(db, item, activity=True)
    db.execute(
        text(
            "UPDATE auth_transitions SET state='succeeded',result_session_generation=:seq,terminal_at=:now WHERE transition_id=:id"
        ),
        {"seq": seq, "now": timestamp, "id": transition["transition_id"]},
    )
    return response(
        db,
        request,
        {
            "flow_id": item["id"],
            "revision": item["revision"],
            "session_generation": seq,
            "csrf_token": csrf,
            "expires_at": expiry,
        },
        status=201,
        cookie=(name, token),
        metadata=item,
    )


@router.get("/csrf")
def csrf(request: Request, db=Db):
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"))
    row = credential(db, request, item, "session")
    if (
        request.headers.get("X-EduVibe-Auth-Revision") is not None
        or request.headers.get("X-EduVibe-Session-Generation") is not None
    ):
        check_revision(
            request,
            item,
            request.headers.get("X-EduVibe-Auth-Revision"),
            row["issued_seq"],
        )
    return response(
        db,
        request,
        {
            "csrf_token": row["csrf_token"],
            "expires_at": min(row["expires_at"], row["absolute_expires_at"]),
        },
        metadata=item,
    )


@router.post("/transitions/{transition_id}/settle")
def settle(transition_id: str, request: Request, body: Settle, db=Db):
    item = flow(db, str(body.flow_id), proof_kind="recovery")
    credential(db, request, item, "recovery", csrf=True)
    check_revision(request, item, body.expected_revision)
    result = transition_summary(db, item, transition_id)
    active = pending(db, item)
    if active and active["transition_id"] != transition_id:
        raise AuthError("AUTH_STATE_CHANGED")
    if active:
        terminalize(
            db, item, "expired" if active["permit_expires_at"] <= now() else "cancelled"
        )
        advance(db, item, activity=True)
    elif result["availability"] == "unavailable" and not result["execution_blocked"]:
        if transition_id != f"{item['id']}.{item['revision']}":
            raise AuthError("AUTH_STATE_CHANGED")
        advance(db, item, activity=True)
    return response(
        db,
        request,
        {
            "flow_id": item["id"],
            "revision": item["revision"],
            "transition_id": transition_id,
            "result": transition_summary(db, item, transition_id),
        },
    )


@router.post("/transitions/{transition_id}/discard-session")
def discard(transition_id: str, request: Request, body: Discard, db=Db):
    item = flow(db, str(body.flow_id), proof_kind="recovery")
    credential(db, request, item, "recovery", csrf=True)
    check_revision(request, item, body.expected_revision)
    result = transition_summary(db, item, transition_id)
    if (
        result["availability"] != "available"
        or result["state"] != "succeeded"
        or result["result_session_generation"] != body.expected_session_generation
    ):
        raise AuthError("AUTH_STATE_CHANGED")
    target = (
        db.execute(
            text("SELECT * FROM sessions WHERE flow_id=:flow AND issued_seq=:seq"),
            {"flow": item["id"], "seq": body.expected_session_generation},
        )
        .mappings()
        .first()
    )
    if not target:
        raise AuthError("AUTH_STATE_CHANGED")
    token = request.cookies.get(
        cookie_name(request, "session", item["id"], target["issued_seq"])
    )
    if token and secrets.compare_digest(digest(token), target["token_hash"]):
        raise AuthError("AUTH_STATE_CHANGED")
    if target["revoked_at"] is None:
        db.execute(
            text("UPDATE sessions SET revoked_at=:now WHERE token_hash=:hash"),
            {"now": now(), "hash": target["token_hash"]},
        )
        if item["current_session_generation"] == target["issued_seq"]:
            item["current_session_generation"] = None
        advance(db, item, activity=True)
    return response(db, request, {"flow_id": item["id"], "revision": item["revision"]})


@router.post("/flows/{flow_id}/recovery-cookie/rotate")
def rotate(flow_id: str, request: Request, body: RotateRecovery, db=Db):
    item = flow(db, flow_id)
    row = credential(db, request, item, "session", csrf=True)
    check_revision(
        request, item, body.expected_revision, body.expected_session_generation
    )
    if row["issued_seq"] != body.expected_session_generation:
        raise AuthError("AUTH_STATE_CHANGED")
    # Budget is checked before cancelling or revoking any existing proof.
    row, cookie = issue_recovery(db, request, item)
    terminalize(db, item)
    item["last_activity_at"] = now()
    item["expires_at"] = after(item["last_activity_at"], 1800)
    save_flow(db, item)
    db.execute(
        text(
            "UPDATE recovery_credentials SET expires_at=:expiry WHERE flow_id=:id AND issued_seq=:seq"
        ),
        {
            "expiry": item["expires_at"],
            "id": flow_id,
            "seq": item["current_recovery_seq"],
        },
    )
    row["expires_at"] = item["expires_at"]
    return response(db, request, recovery_body(item, row), status=201, cookie=cookie)


def revoke_flow(db, item):
    if item["revoked_at"] is None:
        terminalize(db, item)
        item["revoked_at"] = now()
        item["last_identity_change_revision"] = increment(item["revision"])
        advance(db, item)
        for table in ("sessions", "recovery_credentials"):
            db.execute(
                text(
                    f"UPDATE {table} SET revoked_at=:now WHERE flow_id=:id AND revoked_at IS NULL"
                ),
                {"now": now(), "id": item["id"]},
            )


@router.post("/flows/{flow_id}/reset")
def reset(flow_id: str, request: Request, body: ResetFlow, db=Db):
    item = flow(
        db,
        flow_id,
        proof_kind="recovery"
        if body.expected_session_generation is None
        else "session",
    )
    if body.expected_session_generation is None:
        credential(db, request, item, "recovery", csrf=True)
    else:
        row = credential(db, request, item, "session", csrf=True)
        if row["issued_seq"] != body.expected_session_generation:
            raise AuthError("AUTH_STATE_CHANGED")
    check_revision(
        request, item, body.expected_revision, body.expected_session_generation
    )
    revoke_flow(db, item)
    return response(db, request, {"restart_eligible": True})


@router.post("/register")
@router.post("/reauth")
def member_execution(db=Db):
    raise AuthError("FEATURE_UNAVAILABLE", 503)
