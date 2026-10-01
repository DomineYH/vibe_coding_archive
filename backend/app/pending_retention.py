"""Initial pending deletion with a durable intent ledger outside operational backups."""

import os
import sqlite3
from contextlib import closing
from pathlib import Path

from sqlalchemy import text

from app.auth_boundary import after, now


def ledger_path(factory):
    return Path(factory.kw["bind"].url.database).with_suffix(".deletions.sqlite3")


def _sweep_pending(factory, *, restored=False):
    path = ledger_path(factory)
    if restored and not path.is_file():
        raise RuntimeError(
            "The current independent deletion ledger is required before restore."
        )
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(descriptor)
    with closing(sqlite3.connect(path, timeout=5)) as ledger, factory() as db:
        ledger.execute("PRAGMA synchronous=FULL")
        ledger.execute(
            "CREATE TABLE IF NOT EXISTS member_deletions(member_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL)"
        )
        ledger.execute(
            "CREATE TABLE IF NOT EXISTS app_deletions(app_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL)"
        )
        ledger.execute(
            "CREATE TABLE IF NOT EXISTS deletion_cancellations(kind TEXT NOT NULL CHECK(kind IN ('member','app')), target_id TEXT NOT NULL, cancelled_at TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(kind,target_id))"
        )
        ledger.commit()
        db.execute(text("BEGIN IMMEDIATE"))
        # Missing durable intents must never be recreated from a rolled-back backup.
        known = dict(
            ledger.execute("SELECT member_id,deleted_at FROM member_deletions")
        )
        if any(
            row[0] not in known
            for row in db.execute(text("SELECT member_id FROM member_deletions"))
        ):
            raise RuntimeError("The independent deletion ledger is incomplete.")
        known_apps = dict(ledger.execute("SELECT app_id,deleted_at FROM app_deletions"))
        if any(
            row[0] not in known_apps
            for row in db.execute(text("SELECT app_id FROM app_deletions"))
        ):
            raise RuntimeError("The independent deletion ledger is incomplete.")
        stamp = now()
        cancelled = set(
            ledger.execute("SELECT kind,target_id FROM deletion_cancellations")
        )
        candidates = (
            db.execute(
                text(
                    "SELECT id FROM members WHERE approval_status='pending' AND first_approved_at IS NULL AND is_admin=0 AND created_at<=:cutoff"
                ),
                {"cutoff": after(stamp, -90 * 86400)},
            )
            .scalars()
            .all()
        )
        candidates = {id_ for id_ in candidates if ("member", id_) not in cancelled}
        # Durable intent alone is not a completed deletion (R9 Q38/R24 §8).
        # Every replay checks current eligibility under this operational write lock.
        apps = db.execute(
            text(
                "SELECT id,owner_id FROM apps WHERE owner_id IN (SELECT id FROM members WHERE approval_status='pending' AND first_approved_at IS NULL AND is_admin=0 AND created_at<=:cutoff)"
            ),
            {"cutoff": after(stamp, -90 * 86400)},
        ).all()
        with ledger:
            ledger.executemany(
                "INSERT OR IGNORE INTO app_deletions VALUES (?,?)",
                [
                    (id_, stamp)
                    for id_, owner in apps
                    if owner in candidates and ("app", id_) not in cancelled
                ],
            )
            ledger.executemany(
                "INSERT OR IGNORE INTO member_deletions VALUES (?,?)",
                [(id_, stamp) for id_ in candidates],
            )
        intents = ledger.execute(
            "SELECT member_id,deleted_at FROM member_deletions"
        ).fetchall()
        for id_, _ in intents:
            member = db.execute(
                text(
                    "SELECT approval_status,first_approved_at FROM members WHERE id=:id"
                ),
                {"id": id_},
            ).first()
            if member and id_ not in candidates and ("member", id_) not in cancelled:
                reason = (
                    "APPROVAL_COMMITTED"
                    if member.first_approved_at is not None
                    else "NOT_INITIAL_PENDING_EXPIRED"
                )
                with ledger:
                    ledger.execute(
                        "INSERT INTO deletion_cancellations VALUES ('member',?,?,?)",
                        (id_, stamp, reason),
                    )
                cancelled.add(("member", id_))
        for id_, deleted_at in ledger.execute(
            "SELECT app_id,deleted_at FROM app_deletions"
        ):
            if ("app", id_) in cancelled:
                continue
            app = db.execute(
                text("SELECT owner_id FROM apps WHERE id=:id"), {"id": id_}
            ).first()
            if app:
                owner_exists = db.execute(
                    text("SELECT id FROM members WHERE id=:id"), {"id": app.owner_id}
                ).first()
                if owner_exists and app.owner_id not in candidates:
                    with ledger:
                        ledger.execute(
                            "INSERT INTO deletion_cancellations VALUES ('app',?,?,?)",
                            (id_, stamp, "OWNER_NOT_INITIAL_PENDING_EXPIRED"),
                        )
                    cancelled.add(("app", id_))
                    continue
            db.execute(text("DELETE FROM apps WHERE id=:id"), {"id": id_})
            db.execute(
                text("INSERT OR IGNORE INTO app_deletions VALUES (:id,:at)"),
                {"id": id_, "at": deleted_at},
            )
        # ponytail: replay scans retained intents every minute; add an applied cursor
        # only if the operating copy inventory makes this scan measurably expensive.
        for id_, deleted_at in intents:
            if ("member", id_) in cancelled:
                continue
            db.execute(
                text(
                    "UPDATE auth_flows SET current_session_generation=NULL,revoked_at=:at WHERE id IN (SELECT flow_id FROM sessions WHERE member_id=:id)"
                ),
                {"id": id_, "at": deleted_at},
            )
            # Sessions have a restrictive FK: remove authority before the member.
            db.execute(text("DELETE FROM sessions WHERE member_id=:id"), {"id": id_})
            db.execute(
                text("DELETE FROM write_operations WHERE actor_id=:id"), {"id": id_}
            )
            db.execute(text("DELETE FROM members WHERE id=:id"), {"id": id_})
            db.execute(
                text(
                    "INSERT OR IGNORE INTO member_deletions(member_id,deleted_at) VALUES (:id,:at)"
                ),
                {"id": id_, "at": deleted_at},
            )
        # R9: retain minimal intents until a complete copy inventory proves expiry
        # plus seven days. No such operating evidence exists; never guess/prune.
        db.commit()


def sweep_pending(factory, *, restored=False):
    try:
        _sweep_pending(factory, restored=restored)
    except (sqlite3.Error, OSError):
        raise RuntimeError("Pending deletion ledger verification failed.") from None
