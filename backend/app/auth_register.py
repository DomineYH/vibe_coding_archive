"""Registration keeps the current anonymous S; it is not an identity transition."""

import re
import unicodedata
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Body, Request
from sqlalchemy import text

from app.auth import Unlocked
from app.auth_boundary import (
    AuthError,
    after,
    check_revision,
    client_subject,
    credential,
    flow,
    normalized_login_id,
    now,
    pending,
    rate_limit_window,
    response,
)
from app.auth_login import HASHER, nfc
from app.password_policy import new_password

router = APIRouter(prefix="/auth")


def registration_context(db, request):
    item = flow(db, request.headers.get("X-EduVibe-Flow-Id"))
    session = credential(db, request, item, "session", csrf=True)
    if session["kind"] != "anonymous":
        raise AuthError("ALREADY_AUTHENTICATED")
    if any(
        request.headers.get(key) is None
        for key in ("X-EduVibe-Auth-Revision", "X-EduVibe-Session-Generation")
    ):
        raise AuthError("VALIDATION_ERROR", 422)
    check_revision(
        request, item, request.headers["X-EduVibe-Auth-Revision"], session["issued_seq"]
    )
    if pending(db, item):
        raise AuthError("AUTH_TRANSITION_PENDING")
    if not item["recovery_ready"]:
        raise AuthError("AUTH_STATE_CHANGED")
    return item


def registration_values(body, blocklist):
    if not isinstance(body, dict):
        raise AuthError("VALIDATION_ERROR", 422)
    errors = {
        key: "허용되지 않는 필드입니다."
        for key in body.keys() - {"login_id", "nickname", "password", "email", "phone"}
    }
    for key in ("login_id", "nickname", "password"):
        if not isinstance(body.get(key), str):
            errors[key] = "문자열을 입력해 주세요."
    login = nfc(body.get("login_id"))
    nickname = nfc(body.get("nickname"))
    if "login_id" not in errors and (
        not 2 <= len(login) <= 32 or not re.fullmatch(r"[가-힣A-Za-z0-9_.-]+", login)
    ):
        errors["login_id"] = "로그인 아이디는 허용된 문자로 2~32자 입력해 주세요."
    if "nickname" not in errors and (
        not 2 <= len(nickname) <= 20
        or any(
            unicodedata.category(char) in ("Cc", "Cs", "Zl", "Zp")
            or char
            in "\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
            for char in body["nickname"]
        )
        or not any(unicodedata.category(char)[0] not in "CZM" for char in nickname)
    ):
        errors["nickname"] = "별명은 제어문자 없이 보이는 문자로 2~20자 입력해 주세요."
    password = body.get("password")
    if "password" not in errors:
        if any(unicodedata.category(char) == "Cs" for char in password):
            errors["password"] = "유효한 Unicode 문자를 입력해 주세요."
        else:
            try:
                password = new_password(password, blocklist)
            except AuthError as error:
                errors.update(error.fields)
    for key in ("email", "phone"):
        value = body.get(key)
        if value is not None and (not isinstance(value, str) or nfc(value)):
            errors[key] = "현재 선택 정보는 수집하지 않습니다. 비워 주세요."
    if errors:
        raise AuthError("VALIDATION_ERROR", 422, fields=errors)
    return login, nickname, password


@router.post("/register")
def register(request: Request, body: Annotated[Any, Body()], db=Unlocked):
    db.execute(text("BEGIN IMMEDIATE"))
    registration_context(db, request)
    # Reserve a counted attempt while serialized, before validation/hash. No final
    # recount is needed: even simultaneous requests cannot reserve the 101st slot.
    subject = client_subject(request)
    if retry := rate_limit_window(db, "register", subject, 100, 3600):
        raise AuthError("RATE_LIMITED", 429, retry_at=retry)
    stamp = now()
    db.execute(
        text(
            "INSERT INTO rate_limit_events(purpose,subject_hash,occurred_at,expires_at) VALUES ('register',:subject,:now,:expiry)"
        ),
        {"subject": subject, "now": stamp, "expiry": after(stamp, 3600)},
    )
    db.commit()
    login, nickname, password = registration_values(
        body, request.app.state.password_blocklist
    )
    with request.app.state.hash_gate:
        hashed = HASHER.hash(password)
    db.execute(text("BEGIN IMMEDIATE"))
    item = registration_context(db, request)
    key = normalized_login_id(login)
    if db.execute(
        text("SELECT 1 FROM members WHERE login_id_key=:key"), {"key": key}
    ).first():
        raise AuthError(
            "LOGIN_ID_TAKEN", fields={"login_id": "이미 사용 중인 로그인 아이디입니다."}
        )
    stamp = now()
    values = {
        "id": str(uuid4()),
        "login": login,
        "nickname": nickname,
        "key": key,
        "hash": hashed,
        "now": stamp,
    }
    db.execute(
        text(
            "INSERT INTO members(id,login_id,login_id_key,nickname,password_hash,is_admin,approval_status,account_version,created_at,updated_at,must_change_password) VALUES (:id,:login,:key,:nickname,:hash,0,'pending',1,:now,:now,0)"
        ),
        values,
    )
    return response(
        db,
        request,
        {
            "id": values["id"],
            "login_id": login,
            "nickname": nickname,
            "approved": False,
            "pending_expires_at": after(stamp, 90 * 86400),
        },
        status=201,
        metadata=item,
    )
