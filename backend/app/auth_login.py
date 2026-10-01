"""Member login, logout and session restore on the T01 flow boundary.

The sequence is permit (POST /auth/transitions) → execute. Login verifies the
password outside any write transaction, then re-validates the flow, S, permit
and member row in the committing transaction so no past state can sign in.
"""

import secrets
import threading
import unicodedata
from functools import cache
from typing import Annotated

from argon2.exceptions import InvalidHashError
from fastapi import APIRouter, Request
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError
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
FULL_ABSOLUTE, FULL_IDLE, RECENT_AUTH = 8 * 3600, 30 * 60, 15 * 60


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


def check_password(password, stored):
    """Verify against the stored hash, or a real dummy hash so a miss costs the same."""
    password = unicodedata.normalize("NFC", password)
    usable = bool(stored) and stored.startswith("$argon2id$")
    try:
        ok = HASHER.verify(password, stored if usable else dummy_hash())
    except (UnknownHashError, InvalidHashError):
        HASHER.verify(password, dummy_hash())
        return False
    return ok and usable


def execution_context(db, request, kind, state):
    """Prove flow, current S, CSRF, headers and the admitted transition."""
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"))
    session = credential(db, request, item, "session", csrf=True)
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


def find_member(db, key):
    return (
        db.execute(text("SELECT * FROM members WHERE login_id_key=:key"), {"key": key})
        .mappings()
        .first()
    )


def self_body(member, session):
    return {
        "id": member["id"],
        "login_id": member["login_id"],
        "nickname": member["nickname"],
        "role": "admin" if member["is_admin"] else "user",
        "approved": True,
        "must_change_password": False,
        "session_kind": "full",
        "expires_at": min(session["expires_at"], session["absolute_expires_at"]),
        "email": member["email"],
        "phone": member["phone"],
        # Recent authentication gates admin-only sensitive actions (Phase 5).
        "recent_auth_until": after(session["authenticated_at"], RECENT_AUTH)
        if member["is_admin"]
        else None,
    }


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
        for (purpose, subject), limit in zip(
            subjects, (ACCOUNT_FAILURES, IP_FAILURES), strict=True
        ):
            if retry_at := rate_limit_window(db, purpose, subject, limit, WINDOW):
                fail(
                    db,
                    item,
                    transition,
                    AuthError("RATE_LIMITED", 429, retry_at=retry_at),
                )
        seq = increment(item["issued_seq"])
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
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
        timestamp = now()
        if transition["permit_expires_at"] <= timestamp:
            db.execute(
                text(
                    "UPDATE auth_transitions SET state='expired', terminal_at=:now WHERE transition_id=:id"
                ),
                {"now": timestamp, "id": transition["transition_id"]},
            )
            advance(db, item, activity=True)
            db.commit()
            raise AuthError("AUTH_STATE_CHANGED")
        # Decide on the row as it is now, never on the pre-hash snapshot.
        member = find_member(db, key)
        if (
            not verified
            or not member
            or member["password_hash"] != snapshot["password_hash"]
        ):
            fail(
                db,
                item,
                transition,
                AuthError("INVALID_CREDENTIALS", 401),
                events=subjects,
            )
        if member["approval_status"] != "approved":
            fail(db, item, transition, AuthError("ACCOUNT_NOT_APPROVED", 403))
        if member["must_change_password"]:
            expired = (
                member["temporary_password_expires_at"] is None
                or member["temporary_password_expires_at"] <= timestamp
            )
            # Change-only sessions arrive with the first-change flow (T03).
            code = (
                ("TEMP_PASSWORD_EXPIRED", 403)
                if expired
                else ("FEATURE_UNAVAILABLE", 503)
            )
            fail(db, item, transition, AuthError(*code))
        db.execute(
            text("UPDATE sessions SET revoked_at=:now WHERE token_hash=:hash"),
            {"now": timestamp, "hash": session["token_hash"]},
        )
        row = {
            "hash": digest(token),
            "flow": item["id"],
            "seq": seq,
            "member": member["id"],
            "csrf": csrf,
            "now": timestamp,
            "expires_at": after(timestamp, FULL_IDLE),
            "absolute_expires_at": after(timestamp, FULL_ABSOLUTE),
            "authenticated_at": timestamp,
        }
        db.execute(
            text(
                "INSERT INTO sessions(token_hash,flow_id,issued_seq,member_id,kind,csrf_token,created_at,authenticated_at,last_activity_at,absolute_expires_at,expires_at) VALUES (:hash,:flow,:seq,:member,'full',:csrf,:now,:now,:now,:absolute_expires_at,:expires_at)"
            ),
            row,
        )
        item.update(issued_seq=seq, current_session_generation=seq)
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
            {
                "user": self_body(member, row),
                "csrf_token": csrf,
            },
            cookie=(name, token),
            metadata=item,
            private=True,
        )


def member_session(db, request):
    """The current full member session, re-checked against the member row."""
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"))
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
    if session["kind"] != "full":
        raise AuthError("FEATURE_UNAVAILABLE", 503)
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
