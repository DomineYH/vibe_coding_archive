"""Explicit health revocation and reset-key rotation; never start or stop services."""

import ctypes
import fcntl
import hashlib
import json
import os
import secrets
import subprocess
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

from app.backup import _directory, _file
from app.database import current_head, current_revision, make_session_factory
from app.health_store_worker import cancel_all
from app.password_reset_secret import (
    invalidate_reset_operations,
    load_secret,
    unique_object,
)


@contextmanager
def writer(settings):
    parent = _directory(settings.database_path.parent, test=settings.app_env == "test")
    try:
        fd = _file(parent, settings.database_path.name)
        os.close(fd)
        for suffix in ("-wal", "-shm"):
            try:
                fd = _file(parent, settings.database_path.name + suffix)
            except FileNotFoundError:
                continue
            os.close(fd)
        engine = create_engine(
            URL.create(
                "sqlite",
                database=f"file:/proc/self/fd/{parent}/{quote(settings.database_path.name, safe='')}",
                query={"mode": "rw", "uri": "true"},
            ),
            connect_args={"timeout": 5},
            hide_parameters=True,
        )
        try:
            if current_revision(engine) != current_head():
                raise RuntimeError()
            yield make_session_factory(engine)
        finally:
            engine.dispose()
    finally:
        os.close(parent)


def revoke(path, *, test):
    if path is None:
        return
    path = Path(path)
    parent = _directory(path.parent, test=test)
    try:
        try:
            fd = _file(parent, path.name)
        except FileNotFoundError:
            return
        with os.fdopen(fd, "rb") as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            raise ValueError()
        value = json.loads(raw, object_pairs_hook=unique_object)
        if (
            not isinstance(value, dict)
            or type(value.get("version")) is not int
            or value["version"] != 1
        ):
            raise ValueError()
        evidence = path.name + ".revoked-" + str(uuid4())
        # Linux RENAME_NOREPLACE preserves atomic revocation without overwriting evidence.
        rename = ctypes.CDLL(None, use_errno=True).renameat2
        rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        rename.restype = ctypes.c_int
        if rename(parent, os.fsencode(path.name), parent, os.fsencode(evidence), 1):
            raise OSError(ctypes.get_errno(), "HEALTH_REVOKE_FAILED")
        os.fsync(parent)
    finally:
        os.close(parent)


def worker_held(path, *, test):
    parent = _directory(path.parent, test=test)
    try:
        try:
            fd = _file(parent, path.name)
        except FileNotFoundError:
            return False
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            return False
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def disable_health(settings):
    revoke(settings.health_activation_path, test=settings.app_env == "test")
    with writer(settings) as factory, factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        cancel_all(db, datetime.now(UTC), reason="FEATURE_DISABLED")
        db.commit()
    held = worker_held(
        settings.health_worker_lock_path, test=settings.app_env == "test"
    )
    print("HEALTH_STOP_REQUIRED" if held else "HEALTH_DISABLED")
    return 3 if held else 0


def process_states():
    states = []
    for unit in ("eduvibe-api.service", "eduvibe-health-worker.service"):
        result = subprocess.run(
            ["/usr/bin/systemctl", "show", "-p", "ActiveState,MainPID", unit],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode:
            return None
        values = dict(line.split("=", 1) for line in result.stdout.splitlines())
        states.append(values)
    return states


def rotate_reset_key(settings, *, generate, process_state=None):
    if process_state is not None and settings.app_env != "test":
        raise ValueError()
    reader = process_state if settings.app_env == "test" else process_states
    try:
        states = reader() if reader is not None else None
        stopped = (
            isinstance(states, list)
            and len(states) == 2
            and all(
                s.get("ActiveState") in ("inactive", "failed")
                and s.get("MainPID") == "0"
                for s in states
            )
        )
    except (OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError):
        stopped = False
    if not stopped:
        print("RESET_STOP_REQUIRED")
        return 3
    path = settings.password_reset_hmac_path
    if path is None:
        raise ValueError()
    parent = _directory(path.parent, test=settings.app_env == "test")
    temporary = "." + path.name + ".rotation"
    owned = False
    try:
        try:
            fd = _file(parent, path.name)
            os.close(fd)
        except FileNotFoundError:
            pass
        fd = _file(parent, temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        owned = True
        with os.fdopen(fd, "wb") as target:
            if generate:
                secret = secrets.token_bytes(32)
                target.write(
                    json.dumps(
                        {
                            "secret_hex": secret.hex(),
                            "key_id": hashlib.sha256(secret).hexdigest(),
                        }
                    ).encode()
                )
            target.flush()
            os.fsync(target.fileno())
        with writer(settings) as factory:
            count = invalidate_reset_operations(factory)
            if type(count) is not int or count < 0:
                raise RuntimeError()
            with factory() as db:
                if db.execute(
                    text(
                        "SELECT 1 FROM write_operations WHERE kind='user_password_reset' AND state='unresolved' LIMIT 1"
                    )
                ).first():
                    raise RuntimeError()
        if generate:
            os.replace(temporary, path.name, src_dir_fd=parent, dst_dir_fd=parent)
            owned = False
            os.fsync(parent)
            if load_secret(path) != (secret, hashlib.sha256(secret).hexdigest()):
                raise RuntimeError()
        else:
            os.unlink(temporary, dir_fd=parent)
            owned = False
            os.fsync(parent)
        print("RESET_KEY_ROTATED" if generate else "RESET_OPERATIONS_INVALIDATED")
        return 0
    finally:
        try:
            if owned:
                os.unlink(temporary, dir_fd=parent)
                os.fsync(parent)
        finally:
            os.close(parent)
