"""Member login, logout and session restore on the T01 flow boundary.

The sequence is permit (POST /auth/transitions) → execute. Login verifies the
password outside any write transaction, then re-validates the flow, S, permit
and member row in the committing transaction so no past state can sign in.
"""

import secrets
import threading
import unicodedata
from datetime import datetime, timedelta, timezone
from functools import cache
from typing import Annotated

from argon2 import Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import verify_secret
from fastapi import APIRouter, Request
from pwdlib import PasswordHash
from pydantic import BeforeValidator, Field
from sqlalchemy import text

from app.auth import Db, StrictModel, Unlocked
from app.auth_boundary import (
    AuthError,
    advance,
    after,
    check_revision,
    client_subject,
    cookie_budget,
    cookie_name,
    credential,
    digest,
    flow,
    increment,
    normalized_login_id,
    now,
    pending,
    proof_context,
    rate_limit_window,
    response,
)

router = APIRouter(prefix="/auth")

# pwdlib's recommended Argon2id profile (RFC 9106 low-memory: m=64MiB, t=3, p=4).
# Production timing on the real host is measured at T07, not assumed here.
HASHER = PasswordHash.recommended()
ACCOUNT_FAILURES, IP_FAILURES, WINDOW = 10, 200, 900
FULL_ABSOLUTE, FULL_IDLE = 8 * 3600, 30 * 60


@cache
def dummy_hash():
    return HASHER.hash("unknown-member-timing-equalizer")


class HashGate:
    """At most `running` hashes at once; `waiting` queued, each for `wait` seconds."""

    def __init__(self, running=2, waiting=4, wait=1.0):
        self.slots = threading.BoundedSemaphore(running)
        self.lock = threading.Lock()
        self.queued, self.limit, self.wait = 0, waiting, wait

    def __enter__(self):
        if self.slots.acquire(blocking=False):
            return
        with self.lock:
            if self.queued >= self.limit:
                raise AuthError("AUTH_BUSY", 503)
            self.queued += 1
        try:
            got = self.slots.acquire(timeout=self.wait)
        finally:
            with self.lock:
                self.queued -= 1
        if not got:
            raise AuthError("AUTH_BUSY", 503)

    def __exit__(self, *exc):
        self.slots.release()


def nfc(value):
    return (
        unicodedata.normalize("NFC", value.strip()) if isinstance(value, str) else value
    )


class LoginBody(StrictModel):
    login_id: Annotated[
        str,
        BeforeValidator(nfc),
        Field(min_length=2, max_length=32, pattern=r"^[가-힣A-Za-z0-9_.-]+$"),
    ]
    # Only existing credentials are verified; the new-password policy is not applied.
    password: Annotated[str, Field(min_length=1)]


def argon2_verify(stored, password):
    """True/False once Argon2 really ran; raises when `stored` cannot be verified."""
    try:
        return verify_secret(stored.encode(), password.encode(), Type.ID)
    except VerifyMismatchError:
        return False


def check_password(password, stored):
    """Verify against the stored hash, or a real dummy hash so a miss costs the same."""
    password = unicodedata.normalize("NFC", password)
    try:
        if not stored:
            raise ValueError("no stored hash")
        return argon2_verify(stored, password)
    except (InvalidHashError, VerificationError, ValueError):
        # No hashing cost was paid: spend it on the dummy so the miss is not visible.
        argon2_verify(dummy_hash(), password)
        return False


def execution_context(db, request, kind, state):
    """Prove flow, current S, CSRF, headers and the admitted transition."""
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"))
    session = credential(db, request, item, "session", csrf=True)
    if kind == "password_change" and session["kind"] != "change_only":
        raise AuthError("SESSION_KIND_NOT_ALLOWED", 403)
    names = ("X-EduVibe-Auth-Revision", "X-EduVibe-Session-Generation")
    if any(request.headers.get(name) is None for name in names):
        raise AuthError("VALIDATION_ERROR", 422)
    check_revision(
        request, item, request.headers["X-EduVibe-Auth-Revision"], session["issued_seq"]
    )
    transition = pending(db, item)
    if (
        not transition
        or transition["transition_id"] != request.headers.get("X-EduVibe-Transition-Id")
        or transition["kind"] != kind
        or transition["state"] != state
        or transition["admitted_revision"] != item["revision"]
        or transition["source_session_generation"] != session["issued_seq"]
        or not item["recovery_ready"]
    ):
        raise AuthError("AUTH_STATE_CHANGED")
    return item, session, transition


def fail(db, item, transition, error, events=()):
    """Persist the terminal failure (and counted attempts), then answer."""
    timestamp = now()
    db.execute(
        text(
            "UPDATE auth_transitions SET state='failed', failure_code=:code, terminal_at=:now WHERE transition_id=:id AND state IN ('admitted','executing')"
        ),
        {"code": error.code, "now": timestamp, "id": transition["transition_id"]},
    )
    advance(db, item, activity=True)
    for purpose, subject in events:
        db.execute(
            text(
                "INSERT INTO rate_limit_events(purpose,subject_hash,occurred_at,expires_at) VALUES (:purpose,:subject,:now,:expiry)"
            ),
            {
                "purpose": purpose,
                "subject": subject,
                "now": timestamp,
                "expiry": after(timestamp, WINDOW),
            },
        )
    db.commit()
    raise error


def refuse_expired_permit(db, item, transition):
    """A permit is a 60 s start window: record the expiry, then refuse."""
    if transition["permit_expires_at"] > now():
        return
    db.execute(
        text(
            "UPDATE auth_transitions SET state='expired', terminal_at=:now WHERE transition_id=:id"
        ),
        {"now": now(), "id": transition["transition_id"]},
    )
    advance(db, item, activity=True)
    db.commit()
    raise AuthError("AUTH_STATE_CHANGED")


def refuse_when_limited(db, item, transition, subjects):
    """Rolling failure windows; a blocked attempt records nothing and extends nothing."""
    for (purpose, subject), limit in zip(
        subjects, (ACCOUNT_FAILURES, IP_FAILURES), strict=True
    ):
        if retry_at := rate_limit_window(db, purpose, subject, limit, WINDOW):
            fail(
                db, item, transition, AuthError("RATE_LIMITED", 429, retry_at=retry_at)
            )


def unchanged(member, snapshot):
    return all(
        member[key] == snapshot[key]
        for key in ("id", "account_version", "password_hash")
    )


def temporary_valid(member, at):
    expiry = member["temporary_password_expires_at"]
    return expiry is not None and expiry > at


def find_member(db, key):
    return (
        db.execute(text("SELECT * FROM members WHERE login_id_key=:key"), {"key": key})
        .mappings()
        .first()
    )


def self_body(member, session):
    restricted = session["kind"] == "change_only"
    result = {
        "id": member["id"],
        "login_id": member["login_id"],
        "nickname": member["nickname"],
        "role": "admin" if member["is_admin"] else "user",
        "approved": True,
        "must_change_password": restricted,
        "session_kind": session["kind"],
        "expires_at": min(session["expires_at"], session["absolute_expires_at"]),
    }
    if not restricted:
        result.update(
            email=member["email"],
            phone=member["phone"],
            recent_auth_until=session["recent_auth_until"],
        )
    return result


def issue_member_session(
    db, request, item, session, transition, member, *, recent_auth=False
):
    timestamp = now()
    restricted = bool(member["must_change_password"])
    reauth = transition["kind"] == "reauthenticate"
    seq = increment(item["issued_seq"])
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    name = cookie_name(request, "session", item["id"], seq)
    cookie_budget(request, name, token)
    if reauth:
        timestamp = now()
        # Recheck at allocation time: a grant must never mint an expired S.
        if (
            item["expires_at"] <= timestamp
            or session["expires_at"] <= timestamp
            or session["absolute_expires_at"] <= timestamp
        ):
            raise AuthError("AUTH_REQUIRED", 401)
        if transition["permit_expires_at"] <= timestamp:
            refuse_expired_permit(db, item, transition)
        if (
            restricted
            or session["kind"] != "full"
            or session["member_id"] != member["id"]
        ):
            raise AuthError("AUTH_STATE_CHANGED")
    absolute = (
        min(after(timestamp, 900), member["temporary_password_expires_at"])
        if restricted
        else after(timestamp, FULL_ABSOLUTE)
    )
    if reauth:
        absolute = session["absolute_expires_at"]
    row = {
        "hash": digest(token),
        "flow": item["id"],
        "seq": seq,
        "member": member["id"],
        "csrf": csrf,
        "now": timestamp,
        "kind": "change_only" if restricted else "full",
        "expires_at": absolute
        if restricted
        else min(after(timestamp, FULL_IDLE), absolute),
        "absolute_expires_at": absolute,
        "recent_auth_until": after(timestamp, 900)
        if recent_auth and member["is_admin"] and not restricted
        else None,
    }
    db.execute(
        text("UPDATE sessions SET revoked_at=:now WHERE token_hash=:hash"),
        {"now": timestamp, "hash": session["token_hash"]},
    )
    db.execute(
        text(
            "INSERT INTO sessions(token_hash,flow_id,issued_seq,member_id,kind,csrf_token,created_at,authenticated_at,last_activity_at,absolute_expires_at,expires_at,recent_auth_until) VALUES (:hash,:flow,:seq,:member,:kind,:csrf,:now,:now,:now,:absolute_expires_at,:expires_at,:recent_auth_until)"
        ),
        row,
    )
    item.update(issued_seq=seq, current_session_generation=seq)
    if not reauth:
        item["last_identity_change_revision"] = increment(item["revision"])
    advance(db, item, activity=True)
    db.execute(
        text(
            "UPDATE auth_transitions SET state='succeeded', result_session_generation=:seq, terminal_at=:now WHERE transition_id=:id"
        ),
        {"seq": seq, "now": timestamp, "id": transition["transition_id"]},
    )
    return response(
        db,
        request,
        {"user": self_body(member, row), "csrf_token": csrf},
        cookie=(name, token),
        metadata=item,
        private=True,
    )


@router.post("/login")
def login(request: Request, body: LoginBody, db=Unlocked):
    key = normalized_login_id(body.login_id)
    subjects = (
        ("login_account", digest(f"{key}\n{client_subject(request)}")),
        ("login_ip", client_subject(request)),
    )
    # Cheap proof first so unproven callers never occupy a hashing slot.
    execution_context(db, request, "login", "admitted")
    with request.app.state.hash_gate:
        db.execute(text("BEGIN IMMEDIATE"))
        item, session, transition = execution_context(db, request, "login", "admitted")
        if session["kind"] != "anonymous":
            raise AuthError("ALREADY_AUTHENTICATED")
        refuse_expired_permit(db, item, transition)
        refuse_when_limited(db, item, transition, subjects)
        seq = increment(item["issued_seq"])
        token = secrets.token_urlsafe(32)
        name = cookie_name(request, "session", item["id"], seq)
        cookie_budget(request, name, token)
        snapshot = find_member(db, key)
        db.execute(
            text(
                "UPDATE auth_transitions SET state='executing' WHERE transition_id=:id AND state='admitted'"
            ),
            {"id": transition["transition_id"]},
        )
        db.commit()
        verified = check_password(
            body.password, snapshot["password_hash"] if snapshot else None
        )
        db.execute(text("BEGIN IMMEDIATE"))
        item, session, transition = execution_context(db, request, "login", "executing")
        refuse_expired_permit(db, item, transition)
        timestamp = now()
        # Concurrent attempts may have filled the windows while this one was hashing.
        refuse_when_limited(db, item, transition, subjects)
        # Decide on the row as it is now, but only for the very account that was verified.
        member = find_member(db, key)
        if not verified or not member:
            fail(
                db,
                item,
                transition,
                AuthError("INVALID_CREDENTIALS", 401),
                events=subjects,
            )
        if not unchanged(member, snapshot):
            # Approval or credential changed mid-hash: never sign in on the past state.
            fail(db, item, transition, AuthError("AUTH_STATE_CHANGED"))
        if member["approval_status"] != "approved":
            initial = (
                member["approval_status"] == "pending"
                and member["first_approved_at"] is None
            )
            expiry = after(member["created_at"], 90 * 86400)
            if initial and expiry <= timestamp:
                fail(
                    db,
                    item,
                    transition,
                    AuthError("INVALID_CREDENTIALS", 401),
                    events=subjects,
                )
            message = "이전에 받은 승인이 해제된 계정입니다. 운영자에게 문의해 주세요."
            if initial:
                kst = datetime.fromisoformat(expiry).astimezone(
                    timezone(timedelta(hours=9))
                )
                display = (
                    f"{kst.year}년 {kst.month}월 {kst.day}일 "
                    f"{'오전' if kst.hour < 12 else '오후'} {kst.hour % 12 or 12}:{kst.minute:02d} (KST)"
                )
                message = f"승인 대기 중인 계정입니다. 최초 승인 대기는 가입일부터 90일이며 {display}에 만료됩니다. 관리자 승인 후 로그인해 주세요."
            fail(
                db,
                item,
                transition,
                AuthError("ACCOUNT_NOT_APPROVED", 403, message=message),
            )
        if member["must_change_password"] and not temporary_valid(member, timestamp):
            fail(db, item, transition, AuthError("TEMP_PASSWORD_EXPIRED", 403))
        return issue_member_session(
            db, request, item, session, transition, member, recent_auth=True
        )


def member_session(db, request, *, flow_id=None):
    """Current full or change_only member session, checked against the member row.

    Protected operations must additionally require kind == 'full'; change_only
    grants only restricted Self, logout and the member's own password change.
    Admission supplies its validated body flow ID; execution uses the flow header.
    """
    item = flow(db, flow_id or request.headers.get("X-EduVibe-Flow-Id"))
    session = credential(db, request, item, "session")
    if session["member_id"] is None:
        raise AuthError("AUTH_REQUIRED", 401)
    member = (
        db.execute(
            text("SELECT * FROM members WHERE id=:id"), {"id": session["member_id"]}
        )
        .mappings()
        .first()
    )
    if not member or member["approval_status"] != "approved":
        raise AuthError("AUTH_REQUIRED", 401)
    if session["kind"] == "change_only" and (
        not member["must_change_password"] or not temporary_valid(member, now())
    ):
        raise AuthError("AUTH_REQUIRED", 401)
    return item, session, member


@router.get("/me")
def me(request: Request, db=Unlocked):
    names = ("X-EduVibe-Auth-Revision", "X-EduVibe-Session-Generation")
    if any(request.headers.get(name) is None for name in names):
        raise AuthError("VALIDATION_ERROR", 422)
    item, session, member = member_session(db, request)
    check_revision(
        request, item, request.headers["X-EduVibe-Auth-Revision"], session["issued_seq"]
    )
    # A read: neither the session nor the flow is extended.
    return response(
        db, request, self_body(member, session), metadata=item, private=True
    )


@router.post("/logout")
def logout(request: Request, db=Db):
    live = [
        entry
        for entry in proof_context(db, request)
        if credential(
            db, request, flow(db, entry["flow_id"]), "session", required=False
        )
    ]
    if not live:
        # The no-S exception neither issues credentials nor settles another transition.
        db.commit()
        return response(db, request, None, status=204)
    item, session, transition = execution_context(db, request, "logout", "admitted")
    refuse_expired_permit(db, item, transition)
    timestamp = now()
    db.execute(
        text("UPDATE sessions SET revoked_at=:now WHERE token_hash=:hash"),
        {"now": timestamp, "hash": session["token_hash"]},
    )
    item["current_session_generation"] = None
    item["last_identity_change_revision"] = increment(item["revision"])
    advance(db, item, activity=True)
    db.execute(
        text(
            "UPDATE auth_transitions SET state='succeeded', terminal_at=:now WHERE transition_id=:id"
        ),
        {"now": timestamp, "id": transition["transition_id"]},
    )
    return response(db, request, None, status=204)
