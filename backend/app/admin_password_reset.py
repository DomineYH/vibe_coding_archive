"""Actor-bound reset keys and atomic temporary credentials with session revocation."""

import hmac
from contextlib import contextmanager
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from app.admin_approval import (
    SetPasswordReset,
    administrator,
    check_json,
    operation,
    ordinary_target,
)
from app.app_create import idempotency_key
from app.auth import Unlocked
from app.auth_boundary import AuthError, after, now, response
from app.auth_login import HASHER
from app.auth_reauth import current_admin, require_recent_admin
from app.auth_runtime import auth_available
from app.password_policy import new_password
from app.password_reset_secret import fingerprint

router = APIRouter(dependencies=[Depends(check_json)])


def recent_reset_administrator(db, request):
    if not auth_available(request.app.state):
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    return require_recent_admin(db, request, write=True)


def reset_administrator(db, request, *, write=False):
    if not auth_available(request.app.state):
        raise AuthError("FEATURE_UNAVAILABLE", 503)
    item, actor = administrator(db, request, write=write)
    current_admin(db, request)
    return item, actor


def password_reset_operation_body(row):
    return {
        "key": row["key"],
        "kind": row["kind"],
        "target_id": row["target_id"],
        "issued_at": row["created_at"],
        "expires_at": row["expires_at"],
        "state": row["state"],
        "applied_account_version": row["result_account_version"],
        "temporary_password_expires_at": row["result_temporary_password_expires_at"],
        "finalized_at": row["applied_at"],
        "rejection_code": row["failure_code"],
        "server_time": now(),
    }


def password(request, body):
    try:
        return new_password(body.new_password, request.app.state.password_blocklist)
    except AuthError as error:
        error.fields = {"new_password": error.fields["password"]}
        raise


@contextmanager
def reset_write(db, request):
    gate = request.app.state.password_reset_gate
    with gate.lock:
        try:
            db.execute(text("BEGIN IMMEDIATE"))
            yield gate
        except Exception:
            db.rollback()
            if gate.latched:
                gate.maintain()
            raise


def issue_reset_operation(db, request, body):
    with reset_write(db, request) as gate:
        item, actor = recent_reset_administrator(db, request)
        secret, key_id = gate.verify()
        value = password(request, body)
        member = ordinary_target(db, body.target_id, body.expected_account_version)
        if member["account_version"] == 9007199254740991:
            raise AuthError("SERVICE_UNAVAILABLE", 503)
        stamp, key = now(), str(uuid4())
        db.execute(
            text(
                "INSERT INTO write_operations(key,actor_id,kind,target_id,expected_account_version,reset_key_id,reset_request_hmac,created_at,expires_at,state) VALUES (:key,:actor,'user_password_reset',:target,:version,:key_id,:hmac,:stamp,:expiry,'unresolved')"
            ),
            {
                "key": key,
                "actor": actor["id"],
                "target": str(body.target_id),
                "version": body.expected_account_version,
                "key_id": key_id,
                "hmac": fingerprint(
                    secret,
                    key,
                    actor["id"],
                    str(body.target_id),
                    body.expected_account_version,
                    value,
                ),
                "stamp": stamp,
                "expiry": after(stamp, 86400),
            },
        )
        recent_reset_administrator(db, request)
        gate.verify()
        return response(
            db,
            request,
            password_reset_operation_body(operation(db, key, actor)),
            status=201,
            private=True,
            metadata=item,
        )


def matching(db, request, gate, key, actor, id_, body):
    secret, key_id = gate.verify()
    row = operation(db, key, actor)
    if row["kind"] == "user_password_reset" and not hmac.compare_digest(
        row["reset_key_id"], key_id
    ):
        raise AuthError("SERVICE_UNAVAILABLE", 503)
    if (
        row["kind"] != "user_password_reset"
        or row["target_id"] != str(id_)
        or row["expected_account_version"] != body.expected_account_version
        or not hmac.compare_digest(
            row["reset_request_hmac"],
            fingerprint(
                secret,
                key,
                actor["id"],
                str(id_),
                body.expected_account_version,
                body.new_password,
            ),
        )
    ):
        raise AuthError("OPERATION_KEY_MISMATCH")
    if row["state"] != "unresolved":
        raise AuthError("OPERATION_ALREADY_RESOLVED")
    return row


def audit(db, actor, id_, stamp, outcome):
    db.execute(
        text(
            "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('user_password_reset',:actor,:target,:stamp,:outcome)"
        ),
        {"actor": actor["id"], "target": str(id_), "stamp": stamp, "outcome": outcome},
    )


def finalize(db, request, key, id_, body, hashed):
    with reset_write(db, request) as gate:
        item, actor = recent_reset_administrator(db, request)
        matching(db, request, gate, key, actor, id_, body)
        value = password(request, body)
        try:
            member = ordinary_target(db, id_, body.expected_account_version)
        except AuthError as error:
            stamp = now()
            db.execute(
                text(
                    "UPDATE write_operations SET state='rejected',failure_code=:code,applied_at=:stamp WHERE key=:key"
                ),
                {"code": error.code, "stamp": stamp, "key": key},
            )
            audit(db, actor, id_, stamp, "rejected")
            recent_reset_administrator(db, request)
            gate.verify()
            operation(db, key, actor)
            db.commit()
            raise
        if member["account_version"] == 9007199254740991:
            raise AuthError("SERVICE_UNAVAILABLE", 503)
        if hashed is None:
            db.rollback()
            return None  # A cheap-path refusal became valid; hash before attempting a write.
        del value
        stamp = now()
        expiry = after(stamp, 86400)
        db.execute(
            text(
                "UPDATE members SET password_hash=:hash,must_change_password=1,temporary_password_expires_at=:expiry,account_version=account_version+1,updated_at=:stamp WHERE id=:target"
            ),
            {"hash": hashed, "expiry": expiry, "stamp": stamp, "target": str(id_)},
        )
        db.execute(
            text(
                "UPDATE sessions SET revoked_at=:stamp WHERE member_id=:target AND revoked_at IS NULL"
            ),
            {"stamp": stamp, "target": str(id_)},
        )
        audit(db, actor, id_, stamp, "succeeded")
        db.execute(
            text(
                "UPDATE write_operations SET state='succeeded',result_account_version=:version,result_temporary_password_expires_at=:expiry,applied_at=:stamp WHERE key=:key"
            ),
            {
                "version": member["account_version"] + 1,
                "expiry": expiry,
                "stamp": stamp,
                "key": key,
            },
        )
        recent_reset_administrator(db, request)
        gate.verify()
        operation(
            db, key, actor
        )  # Deadline only; our own writes already finalized the key.
        return response(db, request, None, status=204, metadata=item)


@router.post("/admin/users/{id}/password-reset")
def reset_password(id: UUID, request: Request, body: SetPasswordReset, db=Unlocked):
    key = idempotency_key(request)
    gate = request.app.state.password_reset_gate
    try:
        with gate.lock:
            db.execute(text("BEGIN"))
            _, actor = recent_reset_administrator(db, request)
            matching(db, request, gate, key, actor, id, body)
            value = password(request, body)
            refusal = False
            try:
                member = ordinary_target(db, id, body.expected_account_version)
                if member["account_version"] == 9007199254740991:
                    raise AuthError("SERVICE_UNAVAILABLE", 503)
            except AuthError as error:
                if error.code not in (
                    "USER_NOT_FOUND",
                    "ADMIN_ACCOUNT_PROTECTED",
                    "USER_STATE_CONFLICT",
                ):
                    raise
                refusal = True
            db.rollback()
    except Exception:
        db.rollback()
        if gate.latched:
            gate.maintain()
        raise
    if refusal:
        result = finalize(db, request, key, id, body, None)
        if result is not None:
            return result
    with request.app.state.hash_gate:
        hashed = HASHER.hash(value)
    return finalize(db, request, key, id, body, hashed)
