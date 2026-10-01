"""Current-flow proof, sequence and cookie rules shared by auth endpoints."""

import hashlib
import ipaddress
import re
import secrets
from datetime import UTC, datetime, timedelta
from unicodedata import normalize
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from sqlalchemy import text
from starlette.responses import JSONResponse, Response

PENDING = ("admitted", "executing")
SEQUENCE = re.compile(r"^(0|[1-9][0-9]*)$")
COOKIE = re.compile(
    r"^(?:__Host-eduvibe_(session|recovery)_|eduvibe_(session|recovery)_dev_)([0-9a-f-]{36})_(0|[1-9][0-9]*)$"
)


def now():
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def after(value, seconds):
    return (
        (datetime.fromisoformat(value) + timedelta(seconds=seconds))
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def increment(value):
    # Python integers do not overflow; bounded chunks avoid decimal conversion limits.
    number = 0
    for index in range(0, len(value), 9):
        chunk = value[index : index + 9]
        number = number * 10 ** len(chunk) + int(chunk)
    number += 1
    chunks = []
    while number:
        number, remainder = divmod(number, 1_000_000_000)
        chunks.append(remainder)
    return str(chunks[-1]) + "".join(f"{chunk:09d}" for chunk in reversed(chunks[:-1]))


def older(left, right):
    return (len(left), left) < (len(right), right)


def normalized_login_id(value):
    """The one login_id_key rule shared by seed, login and admin tooling."""
    return normalize("NFC", value.strip()).lower()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class AuthError(Exception):
    def __init__(self, code, status=409, *, retry_at=None, fields=None):
        self.code = code
        self.status = status
        self.retry_at = retry_at
        self.fields = fields


def error_response(error):
    return JSONResponse(
        {
            "error": {
                "code": error.code,
                "message": {
                    "FEATURE_UNAVAILABLE": "인증 기능을 아직 사용할 수 없어요.",
                    "AUTH_REQUIRED": "인증 흐름의 유효한 증명이 필요해요.",
                    "RECOVERY_REQUIRED": "인증 흐름의 복구 증명이 필요해요.",
                    "BAD_REQUEST": "요청 본문 형식을 확인해 주세요.",
                    "PAYLOAD_TOO_LARGE": "요청 본문은 16KiB 이하여야 해요.",
                    "CSRF_INVALID": "요청 권한을 다시 확인해 주세요.",
                    "ORIGIN_REJECTED": "요청 출처를 확인할 수 없어요.",
                    "AUTH_STATE_CHANGED": "인증 상태가 바뀌었어요. 다시 확인해 주세요.",
                    "AUTH_TRANSITION_PENDING": "이전 인증 요청의 결과를 먼저 확인해 주세요.",
                    "AUTH_COOKIE_BUDGET_EXCEEDED": "쿠키 공간을 확보한 뒤 다시 확인해 주세요.",
                    "RATE_LIMITED": "요청이 많아요. 잠시 후 다시 확인해 주세요.",
                    "VALIDATION_ERROR": "요청 형식을 확인해 주세요.",
                    "INVALID_CREDENTIALS": "아이디 또는 비밀번호를 확인해 주세요.",
                    "ACCOUNT_NOT_APPROVED": "승인 대기 중인 계정입니다. 관리자 승인 후 로그인해 주세요.",
                    "TEMP_PASSWORD_EXPIRED": "임시 비밀번호가 만료되었어요. 관리자에게 다시 요청해 주세요.",
                    "ALREADY_AUTHENTICATED": "다른 계정으로 로그인하려면 먼저 로그아웃해 주세요.",
                    "AUTH_BUSY": "요청이 몰려 있어요. 잠시 뒤에 다시 시도해 주세요.",
                    "DB_BUSY": "서버가 바빠요. 잠시 뒤에 다시 시도해 주세요.",
                }.get(error.code, "인증 준비를 완료할 수 없어요. 다시 확인해 주세요."),
                "request_id": str(uuid4()),
                **({"fields": error.fields} if error.fields else {}),
                **(
                    {"retry_at": error.retry_at, "server_time": now()}
                    if error.retry_at is not None
                    else {}
                ),
            }
        },
        status_code=error.status,
        headers={
            "Cache-Control": "no-store",
            **({"Retry-After": "1"} if error.code == "AUTH_BUSY" else {}),
        },
    )


def origin(request):
    expected = request.app.state.settings.public_origin
    supplied = request.headers.get("origin")
    if supplied is not None:
        valid = supplied == expected
    else:
        referer = request.headers.get("referer", "")
        try:
            parsed = urlsplit(referer)
            valid = (
                not parsed.username
                and not parsed.password
                and f"{parsed.scheme}://{parsed.netloc}" == expected
            )
        except ValueError:
            valid = False
    if not valid:
        raise AuthError("ORIGIN_REJECTED", 403)


def flow(db, flow_id, *, live=True, proof_kind=None):
    try:
        if str(UUID(flow_id)) != flow_id:
            raise ValueError()
    except (ValueError, TypeError):
        raise AuthError("VALIDATION_ERROR", 422) from None
    result = (
        db.execute(text("SELECT * FROM auth_flows WHERE id=:id"), {"id": flow_id})
        .mappings()
        .first()
    )
    if result is None or (live and not valid(result)):
        raise AuthError(
            "RECOVERY_REQUIRED" if proof_kind == "recovery" else "AUTH_REQUIRED", 401
        )
    return dict(result)


def valid(row):
    return row is not None and row["revoked_at"] is None and row["expires_at"] > now()


def save_flow(db, item):
    columns = [key for key in item if key != "id"]
    db.execute(
        text(
            "UPDATE auth_flows SET "
            + ",".join(f"{key}=:{key}" for key in columns)
            + " WHERE id=:id"
        ),
        item,
    )


def advance(db, item, *, activity=False):
    item["revision"] = increment(item["revision"])
    if activity:
        item["last_activity_at"] = now()
        item["expires_at"] = after(item["last_activity_at"], 1800)
        db.execute(
            text(
                "UPDATE recovery_credentials SET expires_at=:expires_at WHERE flow_id=:id AND revoked_at IS NULL"
            ),
            item,
        )
    save_flow(db, item)


def credential(db, request, item, kind, *, required=True, csrf=False):
    seq = item[
        "current_recovery_seq" if kind == "recovery" else "current_session_generation"
    ]
    table = "recovery_credentials" if kind == "recovery" else "sessions"
    row = (
        db.execute(
            text(f"SELECT * FROM {table} WHERE flow_id=:id AND issued_seq=:seq"),
            {"id": item["id"], "seq": seq},
        )
        .mappings()
        .first()
        if seq is not None
        else None
    )
    token = (
        request.cookies.get(cookie_name(request, kind, item["id"], seq))
        if seq
        else None
    )
    if (
        not valid(item)
        or not valid(row)
        or (kind == "session" and row["absolute_expires_at"] <= now())
        or not token
        or not secrets.compare_digest(digest(token), row["token_hash"])
    ):
        if required:
            raise AuthError(
                "RECOVERY_REQUIRED" if kind == "recovery" else "AUTH_REQUIRED", 401
            )
        return None
    if csrf and not secrets.compare_digest(
        request.headers.get("X-CSRF-Token", "").encode(),
        row["recovery_csrf_token" if kind == "recovery" else "csrf_token"].encode(),
    ):
        raise AuthError("CSRF_INVALID", 403)
    return row


def current_session(db, item):
    return (
        db.execute(
            text(
                "SELECT * FROM sessions WHERE flow_id=:id AND issued_seq=:seq AND revoked_at IS NULL AND expires_at>:now AND absolute_expires_at>:now"
            ),
            {"id": item["id"], "seq": item["current_session_generation"], "now": now()},
        )
        .mappings()
        .first()
    )


def check_revision(request, item, revision, generation=None):
    if not isinstance(revision, str) or not SEQUENCE.fullmatch(revision):
        raise AuthError("VALIDATION_ERROR", 422)
    if revision != item["revision"]:
        raise AuthError("AUTH_STATE_CHANGED")
    for name, expected in [
        ("X-EduVibe-Flow-Id", item["id"]),
        ("X-EduVibe-Auth-Revision", revision),
        ("X-EduVibe-Session-Generation", generation),
    ]:
        value = request.headers.get(name)
        if value is not None and value != expected:
            raise AuthError("AUTH_STATE_CHANGED")


def pending(db, item):
    return (
        db.execute(
            text(
                "SELECT * FROM auth_transitions WHERE flow_id=:id AND state IN ('admitted','executing')"
            ),
            item,
        )
        .mappings()
        .first()
    )


def terminalize(db, item, state="cancelled"):
    transition = pending(db, item)
    if transition:
        db.execute(
            text(
                "UPDATE auth_transitions SET state=:state, terminal_at=:now WHERE transition_id=:id"
            ),
            {"state": state, "now": now(), "id": transition["transition_id"]},
        )
    return transition


def eligible(db, item):
    # Expired/revoked flows cannot pass final execution validation, even if a worker remains.
    return not valid(item)


def proof_context(db, request):
    result = []
    ids = {match[3] for name in request.cookies if (match := COOKIE.fullmatch(name))}
    for flow_id in ids:
        item = (
            db.execute(
                text(
                    "SELECT * FROM auth_flows WHERE id=:id AND revoked_at IS NULL AND expires_at>:now"
                ),
                {"id": flow_id, "now": now()},
            )
            .mappings()
            .first()
        )
        if not item:
            continue
        for kind in ("recovery", "session"):
            if credential(db, request, item, kind, required=False):
                result.append(
                    {
                        "flow_id": item["id"],
                        "revision": item["revision"],
                        "proof_kind": kind,
                    }
                )
                break
    return result


def cookie_name(request, kind, flow_id, seq):
    settings = request.app.state.settings
    parsed = urlsplit(settings.public_origin)
    host = parsed.hostname
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host == "localhost" or host.endswith(".localhost")
    dev = settings.app_env != "production" and parsed.scheme == "http" and loopback
    return (
        f"eduvibe_{kind}_dev_{flow_id}_{seq}"
        if dev
        else f"__Host-eduvibe_{kind}_{flow_id}_{seq}"
    )


def invalid_cookie_names(db, request):
    names = []
    for name in request.cookies:
        match = COOKIE.fullmatch(name)
        if not match:
            continue
        kind = match[1] or match[2]
        flow_id, seq = match[3], match[4]
        table = "sessions" if kind == "session" else "recovery_credentials"
        row = (
            db.execute(
                text(f"SELECT * FROM {table} WHERE flow_id=:id AND issued_seq=:seq"),
                {"id": flow_id, "seq": seq},
            )
            .mappings()
            .first()
        )
        retired = db.execute(
            text("SELECT 1 FROM auth_retired_flow_ids WHERE id_hash=:hash"),
            {"hash": digest(flow_id)},
        ).first()
        if row is None and retired:
            names.append(name)
            continue
        # An unknown name or a bad token value proves neither revocation nor non-reuse.
        if row and (
            not valid(row)
            or (kind == "session" and row["absolute_expires_at"] <= now())
        ):
            names.append(name)
    return names


def cookie_budget(request, name, token):
    cookies = [
        (key, value) for key, value in request.cookies.items() if COOKIE.fullmatch(key)
    ] + [(name, token)]
    if (
        len(cookies) > 8
        or len("; ".join(f"{key}={value}" for key, value in cookies).encode()) > 2048
    ):
        raise AuthError("AUTH_COOKIE_BUDGET_EXCEEDED")


def response(
    db, request, body, *, status=200, cookie=None, metadata=None, private=False
):
    invalid = invalid_cookie_names(db, request)
    db.commit()
    headers = {"Cache-Control": "private, no-store" if private else "no-store"}
    result = (
        Response(status_code=204, headers=headers)
        if status == 204
        else JSONResponse(body, status_code=status, headers=headers)
    )
    for name in invalid:
        result.delete_cookie(
            name,
            path="/",
            secure=name.startswith("__Host-"),
            httponly=True,
            samesite="lax",
        )
    if cookie:
        name, token = cookie
        result.set_cookie(
            name,
            token,
            path="/",
            secure=name.startswith("__Host-"),
            httponly=True,
            samesite="lax",
        )
    if metadata:
        result.headers["X-EduVibe-Flow-Id"] = metadata["id"]
        result.headers["X-EduVibe-Auth-Revision"] = metadata["revision"]
        result.headers["X-EduVibe-Session-Generation"] = metadata[
            "current_session_generation"
        ]
    return result


def client_subject(request):
    # Direct peer only. Proxy headers are untrusted until the operating gate configures them.
    return digest(request.client.host if request.client else "unknown-peer")


def rate_limit_window(db, purpose, subject, limit, seconds):
    """retry_at once `limit` events sit in the rolling window, else None."""
    times = (
        db.execute(
            text(
                "SELECT occurred_at FROM rate_limit_events WHERE purpose=:purpose AND subject_hash=:subject AND occurred_at>:since ORDER BY occurred_at"
            ),
            {
                "purpose": purpose,
                "subject": subject,
                "since": after(now(), -seconds),
            },
        )
        .scalars()
        .all()
    )
    return after(times[len(times) - limit], seconds) if len(times) >= limit else None


def rate_limit(db, request, purpose):
    # Count successful prepare operations / new anonymous S issuances; rejected transactions roll back.
    timestamp = now()
    subject = client_subject(request)
    count = (
        db.execute(
            text(
                "SELECT count(*) AS count, min(occurred_at) AS first FROM rate_limit_events WHERE purpose=:purpose AND subject_hash=:subject AND occurred_at>:since"
            ),
            {"purpose": purpose, "subject": subject, "since": after(timestamp, -900)},
        )
        .mappings()
        .one()
    )
    if count["count"] >= 200:
        raise AuthError("RATE_LIMITED", 429, retry_at=after(count["first"], 900))
    db.execute(
        text(
            "INSERT INTO rate_limit_events(purpose,subject_hash,occurred_at,expires_at) VALUES (:purpose,:subject,:now,:expiry)"
        ),
        {
            "purpose": purpose,
            "subject": subject,
            "now": timestamp,
            "expiry": after(timestamp, 900),
        },
    )


def transition_summary(db, item, transition_id):
    if (
        not transition_id
        or not transition_id.startswith(item["id"] + ".")
        or not SEQUENCE.fullmatch(transition_id.split(".", 1)[1])
    ):
        raise AuthError("VALIDATION_ERROR", 422)
    row = (
        db.execute(
            text(
                "SELECT * FROM auth_transitions WHERE transition_id=:id AND flow_id=:flow"
            ),
            {"id": transition_id, "flow": item["id"]},
        )
        .mappings()
        .first()
    )
    if row and (row["terminal_at"] is None or after(row["terminal_at"], 1800) > now()):
        return {
            "transition_id": transition_id,
            "availability": "available",
            "execution_blocked": None,
            **{
                key: row[key]
                for key in (
                    "kind",
                    "state",
                    "permit_expires_at",
                    "result_session_generation",
                    "failure_code",
                )
            },
        }
    return {
        "transition_id": transition_id,
        "availability": "unavailable",
        "execution_blocked": older(transition_id.split(".", 1)[1], item["revision"])
        or not valid(item),
        **dict.fromkeys(
            (
                "kind",
                "state",
                "permit_expires_at",
                "result_session_generation",
                "failure_code",
            )
        ),
    }


class AuthBodyLimit:
    """Bound streamed auth bodies as well as declared Content-Length."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or not scope["path"].startswith("/api/v1/auth/")
            or scope["method"] != "POST"
        ):
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > 16384:
                return await error_response(AuthError("PAYLOAD_TOO_LARGE", 413))(
                    scope, receive, send
                )
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)
