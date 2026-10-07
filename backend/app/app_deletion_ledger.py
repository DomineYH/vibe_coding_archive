"""DB-first interactive tombstones, independently confirmed and replayed on restore."""

import os
import sqlite3
import time
from contextlib import closing

from app.auth_boundary import now
from app.pending_retention import ledger_path

FIELDS = ("event_id", "app_id", "source", "db_applied_at")
TABLE = "completed_app_delete_events"
SCHEMA = (
    f"CREATE TABLE {TABLE}(event_id TEXT PRIMARY KEY, app_id TEXT NOT NULL UNIQUE, "
    "source TEXT NOT NULL CHECK(source='interactive_app_delete'), db_applied_at TEXT NOT NULL)"
)


def _remaining(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("Deletion confirmation deadline elapsed.")
    return remaining


def _operational(factory, deadline):
    db = sqlite3.connect(factory.kw["bind"].url.database, timeout=_remaining(deadline))
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def _events(ledger):
    columns = ledger.execute(f"PRAGMA table_info({TABLE})").fetchall()
    unique_app = any(
        row[2]
        and [c[2] for c in ledger.execute(f"PRAGMA index_info('{row[1]}')")]
        == ["app_id"]
        for row in ledger.execute(f"PRAGMA index_list({TABLE})")
    )
    ddl = ledger.execute(
        "SELECT sql FROM sqlite_master WHERE name=?", (TABLE,)
    ).fetchone()
    if (
        [r[1] for r in columns] != list(FIELDS)
        or not columns[0][5]
        or not all(r[3] for r in columns[1:])
        or not unique_app
        or not ddl
        or "CHECK(source='interactive_app_delete')" not in ddl[0]
    ):
        raise RuntimeError("The independent app deletion schema is incomplete.")
    events = ledger.execute(f"SELECT {','.join(FIELDS)} FROM {TABLE}").fetchall()
    if any(
        any(v is None for v in row) or row[2] != "interactive_app_delete"
        for row in events
    ):
        raise RuntimeError("The independent app deletion payload is invalid.")
    if len({r[0] for r in events}) != len(events) or len({r[1] for r in events}) != len(
        events
    ):
        raise RuntimeError("The independent app deletion events are duplicated.")
    return {r[0]: tuple(r) for r in events}


def _verify(rows, events, *, restored=False):
    for row in rows:
        expected = tuple(row[f] for f in FIELDS)
        existing = events.get(row["event_id"])
        if existing is not None and existing != expected:
            raise RuntimeError(
                "Independent app deletion evidence disagrees with the outbox."
            )
        if existing is None and (restored or row["delivered_at"] is not None):
            raise RuntimeError("The independent app deletion ledger is incomplete.")
        if any(e[1] == row["app_id"] and e != expected for e in events.values()):
            raise RuntimeError("Independent app deletion target evidence disagrees.")


def prepare(factory, *, restored=False, deadline=None):
    """Verify before normal initialization; restore never writes independent evidence."""
    path = ledger_path(factory)
    deadline = time.monotonic() + 5 if deadline is None else deadline
    try:
        with closing(_operational(factory, deadline)) as db:
            rows = db.execute("SELECT * FROM app_delete_outbox").fetchall()
            legacy = (
                {
                    table: db.execute(f"SELECT * FROM {table}").fetchall()
                    for table in ("member_deletions", "app_deletions")
                }
                if restored
                else {}
            )
        if not path.is_file() and (restored or any(r["delivered_at"] for r in rows)):
            raise RuntimeError(
                "The current independent deletion ledger is required before restore."
            )
        if restored:
            connection = sqlite3.connect(
                f"{path.resolve().as_uri()}?mode=ro",
                uri=True,
                timeout=_remaining(deadline),
            )
        else:
            descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
            os.close(descriptor)
            connection = sqlite3.connect(path, timeout=_remaining(deadline))
        with closing(connection) as ledger:
            exists = ledger.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)
            ).fetchone()
            if not exists:
                if restored or any(r["delivered_at"] for r in rows):
                    raise RuntimeError(
                        "The independent app deletion schema is incomplete."
                    )
                ledger.execute("PRAGMA synchronous=FULL")
                ledger.execute("BEGIN IMMEDIATE")
                # Another live initializer may have completed while we waited.
                ledger.execute(
                    SCHEMA.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1)
                )
                ledger.commit()
            events = _events(ledger)
            _verify(rows, events, restored=restored)
            if restored:
                for table, column in (
                    ("member_deletions", "member_id"),
                    ("app_deletions", "app_id"),
                ):
                    known = dict(
                        ledger.execute(f"SELECT {column},deleted_at FROM {table}")
                    )
                    if any(r[column] not in known for r in legacy[table]):
                        raise RuntimeError(
                            "The independent deletion ledger is incomplete."
                        )
            return events
    except (sqlite3.Error, OSError, TimeoutError):
        if restored or any(r["delivered_at"] for r in locals().get("rows", [])):
            raise RuntimeError(
                "Independent deletion ledger verification failed."
            ) from None
        # Unavailable delivery is transient when no delivered evidence is missing.
        return None


def confirm(factory, event_id, *, deadline=None):
    """One aggregate deadline covers independent commit and operational acknowledgement."""
    deadline = time.monotonic() + 5 if deadline is None else deadline
    try:
        with closing(_operational(factory, deadline)) as db:
            row = db.execute(
                "SELECT * FROM app_delete_outbox WHERE event_id=?", (event_id,)
            ).fetchone()
        if row is None:
            raise RuntimeError("Deletion outbox event is missing.")
        payload = tuple(row[f] for f in FIELDS)
        with closing(
            sqlite3.connect(ledger_path(factory), timeout=_remaining(deadline))
        ) as ledger:
            ledger.execute("PRAGMA synchronous=FULL")
            ledger.execute("BEGIN IMMEDIATE")
            ledger.execute(f"INSERT OR IGNORE INTO {TABLE} VALUES (?,?,?,?)", payload)
            existing = ledger.execute(
                f"SELECT {','.join(FIELDS)} FROM {TABLE} WHERE event_id=? OR app_id=?",
                (row["event_id"], row["app_id"]),
            ).fetchall()
            if existing != [payload]:
                raise RuntimeError("Independent deletion event payload collision.")
            ledger.execute(
                f"PRAGMA busy_timeout={max(1, int(_remaining(deadline) * 1000))}"
            )
            ledger.commit()
        with closing(_operational(factory, deadline)) as db:
            db.execute("BEGIN IMMEDIATE")
            stamp = now()
            db.execute(
                "UPDATE app_delete_outbox SET delivered_at=COALESCE(delivered_at,?) WHERE event_id=?",
                (stamp, event_id),
            )
            db.execute(
                "UPDATE write_operations SET state='succeeded',applied_at=? WHERE key=? AND kind='app_delete' AND target_id=? AND state='confirming_deletion' AND db_applied_at=?",
                (stamp, row["operation_key"], row["app_id"], row["db_applied_at"]),
            )
            db.execute(
                f"PRAGMA busy_timeout={max(1, int(_remaining(deadline) * 1000))}"
            )
            db.commit()
        return True
    except (sqlite3.Error, OSError, TimeoutError):
        return False


def retry_delivery(factory, *, deadline=None, verified=False):
    if not verified and prepare(factory, deadline=deadline) is None:
        return
    deadline = time.monotonic() + 5 if deadline is None else deadline
    with closing(_operational(factory, deadline)) as db:
        pending = db.execute(
            "SELECT event_id FROM app_delete_outbox WHERE delivered_at IS NULL ORDER BY db_applied_at LIMIT 100"
        ).fetchall()
    for row in pending:
        if time.monotonic() >= deadline:
            break
        if not confirm(factory, row[0], deadline=deadline):
            break


def replay(factory, events):
    deadline = time.monotonic() + 5
    with closing(_operational(factory, deadline)) as db:
        db.execute("BEGIN IMMEDIATE")
        for payload in events.values():
            app_id = payload[1]
            db.execute("DELETE FROM apps WHERE id=?", (app_id,))
            db.execute(
                "INSERT OR IGNORE INTO app_delete_outbox(event_id,app_id,source,db_applied_at,delivered_at) VALUES (?,?,?,?,?)",
                (*payload, now()),
            )
            db.execute(
                "UPDATE app_delete_outbox SET delivered_at=COALESCE(delivered_at,?) WHERE event_id=?",
                (now(), payload[0]),
            )
        db.commit()
