"""Consume a temporary credential once on the existing permit/commit boundary."""

from fastapi import APIRouter, Request
from sqlalchemy import text

from app.auth import StrictModel, Unlocked
from app.auth_boundary import AuthError, now
from app.auth_login import (
    HASHER,
    check_password,
    execution_context,
    fail,
    issue_member_session,
    member_session,
    refuse_expired_permit,
)
from app.password_policy import new_password

router = APIRouter(prefix="/auth")


class PasswordBody(StrictModel):
    password: str


@router.post("/password")
def change_password(request: Request, body: PasswordBody, db=Unlocked):
    execution_context(db, request, "password_change", "admitted")
    with request.app.state.hash_gate:
        db.execute(text("BEGIN IMMEDIATE"))
        item, session, transition = execution_context(
            db, request, "password_change", "admitted"
        )
        refuse_expired_permit(db, item, transition)
        try:
            password = new_password(body.password, request.app.state.password_blocklist)
        except AuthError as error:
            fail(db, item, transition, error)
        _, _, snapshot = member_session(db, request)
        db.execute(
            text(
                "UPDATE auth_transitions SET state='executing' WHERE transition_id=:id"
            ),
            {"id": transition["transition_id"]},
        )
        db.commit()
        same = check_password(password, snapshot["password_hash"])
        hashed = None if same else HASHER.hash(password)
        db.execute(text("BEGIN IMMEDIATE"))
        item, session, transition = execution_context(
            db, request, "password_change", "executing"
        )
        refuse_expired_permit(db, item, transition)
        _, _, member = member_session(db, request)
        if any(
            member[key] != snapshot[key]
            for key in ("id", "account_version", "password_hash")
        ):
            fail(db, item, transition, AuthError("AUTH_STATE_CHANGED"))
        if same:
            fail(
                db,
                item,
                transition,
                AuthError(
                    "VALIDATION_ERROR",
                    422,
                    fields={
                        "password": "임시 비밀번호와 다른 비밀번호를 입력해 주세요."
                    },
                ),
            )
        stamp = now()
        db.execute(
            text(
                "UPDATE members SET password_hash=:hash, must_change_password=0, temporary_password_expires_at=NULL, account_version=account_version+1, updated_at=:now WHERE id=:id"
            ),
            {"hash": hashed, "now": stamp, "id": member["id"]},
        )
        db.execute(
            text(
                "UPDATE sessions SET revoked_at=:now WHERE member_id=:id AND kind='change_only' AND revoked_at IS NULL"
            ),
            {"now": stamp, "id": member["id"]},
        )
        member = dict(member, must_change_password=False)
        return issue_member_session(
            db, request, item, session, transition, member, recent_auth=True
        )
