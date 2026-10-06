"""Complete account event groups in the existing independent deletion ledger."""

import hashlib
import json
import os
import re
import sqlite3
import time
from contextlib import closing
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import text

from app.app_deletion_ledger import _operational, _remaining
from app.auth_boundary import now
from app.member_deletion import delete_member
from app.pending_retention import ledger_path

TABLE = "completed_user_delete_events"
FIELDS = (
    "event_id",
    "group_id",
    "member_id",
    "kind",
    "target_id",
    "app_count",
    "manifest_hash",
    "source",
    "db_applied_at",
)
SCHEMA = (
    f"CREATE TABLE {TABLE}(event_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, member_id TEXT NOT NULL, "
    "kind TEXT NOT NULL CHECK(kind IN ('member','app')), target_id TEXT NOT NULL, "
    "app_count INTEGER NOT NULL CHECK(typeof(app_count)='integer' AND app_count BETWEEN 0 AND 9007199254740991), "
    "manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'), "
    "source TEXT NOT NULL CHECK(source='interactive_user_delete'), db_applied_at TEXT NOT NULL, "
    "UNIQUE(kind,target_id), CHECK(kind<>'member' OR (target_id=member_id AND event_id=group_id)))"
)
INDEXES = (
    f"CREATE UNIQUE INDEX uq_completed_user_member ON {TABLE}(group_id) WHERE kind='member'",
    f"CREATE INDEX ix_completed_user_group ON {TABLE}(group_id)",
)


def manifest(rows):
    first = rows[0]
    value = {
        "version": 1,
        "group_id": first["group_id"],
        "member_id": first["member_id"],
        "db_applied_at": first["db_applied_at"],
        "source": first["source"],
        "events": sorted((r["event_id"], r["kind"], r["target_id"]) for r in rows),
    }
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def new_group(member_id, app_ids, stamp):
    group = str(uuid4())
    rows = [{"event_id": group, "kind": "member", "target_id": member_id}]
    rows += [
        {"event_id": str(uuid4()), "kind": "app", "target_id": id_}
        for id_ in sorted(app_ids)
    ]
    for row in rows:
        row.update(
            group_id=group,
            member_id=member_id,
            app_count=len(app_ids),
            source="interactive_user_delete",
            db_applied_at=stamp,
        )
    value = manifest(rows)
    for row in rows:
        row["manifest_hash"] = value
    return rows


def groups(rows, *, complete=True):
    result = {}
    targets, ids = set(), set()
    for raw in rows:
        row = dict(raw)
        try:
            for field in ("event_id", "group_id", "member_id", "target_id"):
                if str(UUID(row[field])) != row[field]:
                    raise ValueError()
            stamp = datetime.fromisoformat(row["db_applied_at"])
            if stamp.utcoffset() is None or stamp.utcoffset().total_seconds() != 0:
                raise ValueError()
            if (
                row["kind"] not in ("member", "app")
                or row["source"] != "interactive_user_delete"
                or type(row["app_count"]) is not int
                or not 0 <= row["app_count"] <= 9007199254740991
                or not re.fullmatch("[0-9a-f]{64}", row["manifest_hash"])
            ):
                raise ValueError()
            if row["kind"] == "member" and (
                row["event_id"] != row["group_id"]
                or row["target_id"] != row["member_id"]
            ):
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise RuntimeError(
                "Independent account deletion payload is invalid."
            ) from None
        target = (row["kind"], row["target_id"])
        if target in targets or row["event_id"] in ids:
            raise RuntimeError("Independent account deletion events are duplicated.")
        targets.add(target)
        ids.add(row["event_id"])
        result.setdefault(row["group_id"], []).append(row)
    for children in result.values():
        first = children[0]
        if any(
            any(
                row[f] != first[f]
                for f in (
                    "member_id",
                    "app_count",
                    "manifest_hash",
                    "source",
                    "db_applied_at",
                )
            )
            for row in children
        ):
            raise RuntimeError("Account deletion group metadata disagrees.")
        if complete and (
            len(children) != first["app_count"] + 1
            or sum(r["kind"] == "member" for r in children) != 1
            or manifest(children) != first["manifest_hash"]
        ):
            raise RuntimeError("Independent account deletion group is incomplete.")
    return result


def _events(ledger):
    # Compare the schema's semantic shape against the exact supported schema.
    with closing(sqlite3.connect(":memory:")) as reference:
        reference.execute(SCHEMA)
        for ddl in INDEXES:
            reference.execute(ddl)

        def shape(db):
            columns = db.execute(f"PRAGMA table_info({TABLE})").fetchall()
            indexes = sorted(
                (
                    bool(r[2]),
                    tuple(c[2] for c in db.execute(f"PRAGMA index_info('{r[1]}')")),
                    bool(r[4]),
                )
                for r in db.execute(f"PRAGMA index_list({TABLE})")
            )
            ddl = db.execute(
                "SELECT sql FROM sqlite_master WHERE name=?", (TABLE,)
            ).fetchone()
            checks = re.findall(r"CHECK\((.*?)\)(?=,|\))", ddl[0] if ddl else "")
            partial = sorted(
                re.sub(r"\s+", "", r[0].split("WHERE", 1)[1]).lower()
                for r in db.execute(
                    "SELECT sql FROM sqlite_master WHERE tbl_name=? AND type='index' AND sql LIKE '%WHERE%'",
                    (TABLE,),
                )
            )
            foreign_keys = db.execute(f"PRAGMA foreign_key_list({TABLE})").fetchall()
            return columns, indexes, checks, partial, foreign_keys

        if shape(ledger) != shape(reference):
            raise RuntimeError("Independent account deletion schema is incomplete.")
    ledger.row_factory = sqlite3.Row
    rows = ledger.execute(f"SELECT {','.join(FIELDS)} FROM {TABLE}").fetchall()
    groups(rows, complete=False)
    return {row["event_id"]: dict(row) for row in rows}


def prepare(factory, *, restored=False, deadline=None):
    deadline = time.monotonic() + 5 if deadline is None else deadline
    rows = []
    try:
        with closing(_operational(factory, deadline)) as db:
            rows = db.execute("SELECT * FROM user_delete_outbox").fetchall()
        groups(rows)
        path = ledger_path(factory)
        acknowledged = any(row["delivered_at"] is not None for row in rows)
        if not path.is_file() and (restored or acknowledged):
            raise RuntimeError(
                "Current independent account deletion ledger is required."
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
                "SELECT 1 FROM sqlite_master WHERE name=? AND type='table'", (TABLE,)
            ).fetchone()
            if not exists:
                if restored or acknowledged:
                    raise RuntimeError(
                        "Independent account deletion schema is incomplete."
                    )
                ledger.execute("PRAGMA synchronous=FULL")
                ledger.execute("BEGIN IMMEDIATE")
                ledger.execute(
                    SCHEMA.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1)
                )
                for ddl in INDEXES:
                    ledger.execute(ddl.replace("INDEX ", "INDEX IF NOT EXISTS ", 1))
                ledger.commit()
            # A fixed ledger read followed by the committed mirror read observes
            # every outbox that could have produced this independent snapshot.
            ledger.execute("BEGIN")
            events = _events(ledger)
            with closing(_operational(factory, deadline)) as db:
                rows = db.execute("SELECT * FROM user_delete_outbox").fetchall()
            operational_groups = groups(rows)
            by_target = {(r["kind"], r["target_id"]): r for r in events.values()}
            for row in rows:
                expected = {f: row[f] for f in FIELDS}
                actual = events.get(row["event_id"])
                if (
                    actual is not None
                    and actual != expected
                    or (row["kind"], row["target_id"]) in by_target
                    and by_target[(row["kind"], row["target_id"])] != expected
                ):
                    raise RuntimeError(
                        "Independent account deletion evidence disagrees with outbox."
                    )
                if actual is None and (restored or row["delivered_at"] is not None):
                    raise RuntimeError(
                        "Independent account deletion evidence is incomplete."
                    )
            for group_id, children in groups(events.values(), complete=False).items():
                try:
                    groups(children)
                except RuntimeError:
                    if restored or group_id not in operational_groups:
                        raise
                    known = {
                        r["event_id"]: {f: r[f] for f in FIELDS}
                        for r in operational_groups[group_id]
                    }
                    if any(known.get(r["event_id"]) != r for r in children):
                        raise RuntimeError(
                            "Independent account deletion subset disagrees."
                        ) from None
            return events
    except (sqlite3.Error, OSError, TimeoutError):
        if restored or any(row["delivered_at"] is not None for row in rows):
            raise RuntimeError(
                "Independent account deletion verification failed."
            ) from None
        return None


def confirm(factory, group_id, *, deadline=None):
    deadline = time.monotonic() + 5 if deadline is None else deadline
    try:
        with closing(_operational(factory, deadline)) as db:
            rows = db.execute(
                "SELECT * FROM user_delete_outbox WHERE group_id=? ORDER BY delivered_at IS NOT NULL,event_id",
                (group_id,),
            ).fetchall()
        if not rows:
            raise RuntimeError("Account deletion outbox group is missing.")
        groups(rows)
        for row in rows:
            if row["delivered_at"] is not None:
                continue
            payload = tuple(row[f] for f in FIELDS)
            with closing(
                sqlite3.connect(ledger_path(factory), timeout=_remaining(deadline))
            ) as ledger:
                ledger.execute("PRAGMA synchronous=FULL")
                ledger.execute("BEGIN IMMEDIATE")
                ledger.execute(
                    f"INSERT OR IGNORE INTO {TABLE} VALUES ({','.join('?' for _ in FIELDS)})",
                    payload,
                )
                actual = ledger.execute(
                    f"SELECT {','.join(FIELDS)} FROM {TABLE} WHERE event_id=? OR (kind=? AND target_id=?)",
                    (row["event_id"], row["kind"], row["target_id"]),
                ).fetchall()
                if actual != [payload]:
                    raise RuntimeError(
                        "Independent account deletion payload collision."
                    )
                ledger.execute(
                    f"PRAGMA busy_timeout={max(1, int(_remaining(deadline) * 1000))}"
                )
                ledger.commit()
                _remaining(deadline)
            with closing(_operational(factory, deadline)) as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute(
                    "UPDATE user_delete_outbox SET delivered_at=COALESCE(delivered_at,?) WHERE event_id=?",
                    (now(), row["event_id"]),
                )
                _remaining(deadline)
                db.commit()
                _remaining(deadline)
        with closing(
            sqlite3.connect(
                f"{ledger_path(factory).resolve().as_uri()}?mode=ro",
                uri=True,
                timeout=_remaining(deadline),
            )
        ) as ledger:
            ledger.row_factory = sqlite3.Row
            complete = ledger.execute(
                f"SELECT * FROM {TABLE} WHERE group_id=?", (group_id,)
            ).fetchall()
            groups(complete)
            if {tuple(r[f] for f in FIELDS) for r in rows} != {
                tuple(r[f] for f in FIELDS) for r in complete
            }:
                raise RuntimeError("Independent account deletion group disagrees.")
        with closing(_operational(factory, deadline)) as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute(
                "SELECT count(*) FROM user_delete_outbox WHERE group_id=? AND delivered_at IS NULL",
                (group_id,),
            ).fetchone()[0]:
                return False
            member = next(r for r in rows if r["kind"] == "member")
            db.execute(
                "UPDATE write_operations SET state='succeeded',applied_at=? WHERE key=? AND kind='user_delete' AND target_id=? AND state='confirming_deletion' AND db_applied_at=?",
                (
                    now(),
                    member["operation_key"],
                    member["member_id"],
                    member["db_applied_at"],
                ),
            )
            _remaining(deadline)
            db.commit()
        return True
    except (sqlite3.Error, OSError, TimeoutError):
        return False


def retry_delivery(factory, *, deadline=None):
    deadline = time.monotonic() + 5 if deadline is None else deadline
    with closing(_operational(factory, deadline)) as db:
        pending = db.execute(
            "SELECT DISTINCT group_id FROM user_delete_outbox WHERE delivered_at IS NULL OR operation_key IN (SELECT key FROM write_operations WHERE kind='user_delete' AND state='confirming_deletion') ORDER BY db_applied_at LIMIT 100"
        ).fetchall()
    for row in pending:
        if time.monotonic() >= deadline or not confirm(
            factory, row[0], deadline=deadline
        ):
            break


def replay(factory, events):
    verified = groups(events.values())
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        for children in verified.values():
            member = next(r for r in children if r["kind"] == "member")
            delete_member(
                db,
                member["member_id"],
                member["db_applied_at"],
                app_ids=[r["target_id"] for r in children if r["kind"] == "app"],
            )
            for row in children:
                db.execute(
                    text(
                        f"INSERT OR IGNORE INTO user_delete_outbox({','.join(FIELDS)},delivered_at) VALUES ({','.join(':' + f for f in FIELDS)},:delivered)"
                    ),
                    dict(row, delivered=now()),
                )
                db.execute(
                    text(
                        "UPDATE user_delete_outbox SET delivered_at=COALESCE(delivered_at,:stamp) WHERE event_id=:event"
                    ),
                    {"stamp": now(), "event": row["event_id"]},
                )
        db.commit()
