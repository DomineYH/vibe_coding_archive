"""Verified external reset secret, latched runtime disable, and keyed input binding."""

import hashlib
import hmac
import json
import os
import re
import stat
import threading
from unicodedata import normalize

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth_boundary import AuthError, now
from app.settings import ROOT


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate secret property")
        value[key] = item
    return value


def load_secret(path):
    try:
        if path is None:
            return None
        path = path.expanduser().resolve(strict=True)
        if path.is_relative_to(ROOT):
            return None
        if not stat.S_ISREG(path.stat().st_mode):
            return None
        descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as file:
            info = os.fstat(file.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
                return None
            raw = file.read(1025)
        if len(raw) > 1024:
            return None
        # Duplicate properties are invalid supply, even if the last value looks valid.
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
        if not isinstance(value, dict):
            return None
        if set(value) != {"secret_hex", "key_id"} or any(
            not isinstance(v, str) or not re.fullmatch("[0-9a-f]{64}", v)
            for v in value.values()
        ):
            return None
        secret = bytes.fromhex(value["secret_hex"])
        key_id = hashlib.sha256(secret).hexdigest()
        if not hmac.compare_digest(key_id, value["key_id"]):
            return None
        return secret, key_id
    except (OSError, ValueError, TypeError, UnicodeError, RuntimeError):
        return None


def fingerprint(secret, key, actor_id, target_id, version, password):
    payload = {
        "version": 1,
        "key": key,
        "actor_id": actor_id,
        "kind": "user_password_reset",
        "target_id": target_id,
        "expected_account_version": version,
        "new_password": normalize("NFC", password),
    }
    raw = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hmac.new(secret, raw, hashlib.sha256).hexdigest()


def invalidate_reset_operations(session_factory, key_id=None):
    """Commit the existing reset invalidation transaction; propagate every failure."""
    with session_factory() as db:
        query = text(
            "SELECT key,actor_id,target_id FROM write_operations WHERE kind='user_password_reset' AND state='unresolved' AND (:id IS NULL OR reset_key_id<>:id)"
        )
        # Disabled reset must not add a writer wait to unrelated auth maintenance.
        pending = db.execute(query, {"id": key_id}).first() is not None
        db.rollback()
        if not pending:
            return 0
        db.execute(text("BEGIN IMMEDIATE"))
        rows = db.execute(query, {"id": key_id}).mappings().all()
        stamp = now()
        for row in rows:
            db.execute(
                text(
                    "UPDATE write_operations SET state='rejected',failure_code='OPERATION_INVALIDATED',applied_at=:stamp WHERE key=:key"
                ),
                {"stamp": stamp, "key": row["key"]},
            )
            db.execute(
                text(
                    "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES ('invalidate_user_password_reset',:actor_id,:target_id,:stamp,'rejected')"
                ),
                {**row, "stamp": stamp},
            )
        db.commit()
        return len(rows)


class ResetSecretGate:
    """Always acquire this gate before a SQLite writer; never hold it while hashing."""

    def __init__(self, path, session_factory, enabled):
        self.path = path
        self.session_factory = session_factory
        self.lock = threading.RLock()
        self.secret = load_secret(path) if enabled else None
        self.ready = False
        self.latched = not enabled or self.secret is None
        self.startup()

    def invalidate(self, key_id):
        return invalidate_reset_operations(self.session_factory, key_id)

    def startup(self):
        with self.lock:
            try:
                self.invalidate(self.secret[1] if self.secret else None)
                self.ready = not self.latched
            except SQLAlchemyError:
                self.ready = False
                self.latched = True

    def verify(self):
        supplied = load_secret(self.path)
        if (
            self.latched
            or supplied is None
            or self.secret is None
            or not hmac.compare_digest(supplied[1], self.secret[1])
        ):
            self.latched = True
            self.ready = False
            raise AuthError("SERVICE_UNAVAILABLE", 503)
        return self.secret

    def maintain(self):
        with self.lock:
            try:
                self.verify()
            except AuthError:
                try:
                    self.invalidate(None)
                except SQLAlchemyError:
                    pass  # Remain closed and retry on the next request/maintenance cycle.
