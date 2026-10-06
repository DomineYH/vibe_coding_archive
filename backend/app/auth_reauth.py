"""Current administrator verification using the durable auth transition boundary."""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import Field
from sqlalchemy import text

from app.admin_approval import administrator, check_json
from app.auth import StrictModel, Unlocked
from app.auth_boundary import (
    AuthError,
    client_subject,
    cookie_budget,
    cookie_name,
    digest,
    increment,
    now,
)
from app.auth_login import (
    check_password,
    execution_context,
    fail,
    issue_member_session,
    member_session,
    refuse_expired_permit,
    refuse_when_limited,
    unchanged,
)

router = APIRouter(prefix="/auth", dependencies=[Depends(check_json)])


class ReauthenticateBody(StrictModel):
    password: Annotated[str, Field(min_length=15, max_length=128)]


def current_admin(db, request, *, flow_id=None):
    """Prove the selected S and member, including during our pending transition."""
    item, session, member = member_session(db, request, flow_id=flow_id)
    if session["kind"] != "full" or member["must_change_password"]:
        raise AuthError("PASSWORD_CHANGE_REQUIRED", 403)
    if not member["is_admin"]:
        raise AuthError("FORBIDDEN", 403)
    return item, session, member


def require_recent_admin(db, request, *, write=False):
    """Future sensitive writes require this at admission and final execution.

    Existing operation-result reads retain administrator/ownership authorization.
    A recent grant never substitutes for a live full session.
    """
    item, member = administrator(db, request, write=write)
    _, session, _ = current_admin(db, request)
    if session["recent_auth_until"] is None or now() >= session["recent_auth_until"]:
        raise AuthError("REAUTH_REQUIRED", 403)
    return item, member


@router.post("/reauth")
def reauthenticate(request: Request, body: ReauthenticateBody, db=Unlocked):
    execution_context(db, request, "reauthenticate", "admitted")
    current_admin(db, request)
    with request.app.state.hash_gate:
        db.execute(text("BEGIN IMMEDIATE"))
        item, session, transition = execution_context(
            db, request, "reauthenticate", "admitted"
        )
        _, _, member = current_admin(db, request)
        subjects = (
            (
                "login_account",
                digest(f"{member['login_id_key']}\n{client_subject(request)}"),
            ),
            ("login_ip", client_subject(request)),
        )
        refuse_expired_permit(db, item, transition)
        refuse_when_limited(db, item, transition, subjects)
        try:
            cookie_budget(
                request,
                cookie_name(
                    request, "session", item["id"], increment(item["issued_seq"])
                ),
                secrets.token_urlsafe(32),
            )
        except AuthError as error:
            fail(db, item, transition, error)
        snapshot = dict(member)
        source = dict(session)
        db.execute(
            text(
                "UPDATE auth_transitions SET state='executing' WHERE transition_id=:id AND state='admitted'"
            ),
            {"id": transition["transition_id"]},
        )
        db.commit()
        verified = check_password(body.password, snapshot["password_hash"])
        db.execute(text("BEGIN IMMEDIATE"))
        item, session, transition = execution_context(
            db, request, "reauthenticate", "executing"
        )
        refuse_expired_permit(db, item, transition)
        try:
            _, _, member = current_admin(db, request)
        except AuthError as error:
            fail(db, item, transition, error)
        if not unchanged(member, snapshot) or any(
            session[key] != source[key]
            for key in ("token_hash", "issued_seq", "member_id", "absolute_expires_at")
        ):
            fail(db, item, transition, AuthError("AUTH_STATE_CHANGED"))
        refuse_when_limited(db, item, transition, subjects)
        if not verified:
            fail(
                db,
                item,
                transition,
                AuthError("INVALID_CREDENTIALS", 401),
                events=subjects,
            )
        return issue_member_session(
            db, request, item, session, transition, member, recent_auth=True
        )
