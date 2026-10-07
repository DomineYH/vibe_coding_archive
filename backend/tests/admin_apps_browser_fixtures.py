"""Stdin-driven owned fixtures for the admin app list API E2E; exact-row teardown."""

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from uuid import uuid4

from app.auth_boundary import digest, now
from app.auth_login import HASHER
from app.catalog import CATALOG

KINDS = ("admin", "admin2", "member", "member2")
SENTINEL = "e162-forbidden-sentinel"


def connect():
    db = sqlite3.connect(os.environ["DATABASE_PATH"])
    db.execute("PRAGMA foreign_keys=ON")
    return db


def stamp_after(base, seconds):
    value = datetime.fromisoformat(base) + timedelta(seconds=seconds)
    return value.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def insert_app(db, id_, owner, name, public, created, health):
    db.execute(
        "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,"
        "stack_db,version,url_version,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,1,1,?,?)",
        (
            id_,
            owner,
            name,
            "https://www.naver.com",
            SENTINEL,
            SENTINEL,
            CATALOG["subjects"][0],
            int(public),
            CATALOG["themes"][0]["id"],
            SENTINEL,
            created,
            created,
        ),
    )
    db.execute("INSERT INTO app_grades VALUES (?,?)", (id_, CATALOG["grades"][0]))
    state = health or "unchecked"
    checked = None if state == "unchecked" else created
    fresh = None if checked is None else stamp_after(checked, 900)
    db.execute(
        "INSERT INTO health_results VALUES (?,?,?,?)", (id_, state, checked, fresh)
    )


def create(value):
    password, prefix, count = value
    stamp = now()
    hashed = HASHER.hash(password)
    members, apps = {}, []
    with connect() as db:
        baseline = db.execute("SELECT count(*) FROM apps").fetchone()[0]
        rates = db.execute("SELECT * FROM rate_limit_events").fetchall()
        for kind in KINDS:
            id_ = str(uuid4())
            login = f"{prefix}-{kind}"
            db.execute(
                "INSERT INTO members(id,login_id,login_id_key,nickname,is_admin,approval_status,"
                "password_hash,created_at,updated_at,first_approved_at,email,phone) "
                "VALUES (?,?,?,?,?,'approved',?,?,?,?,?,?)",
                (
                    id_,
                    login,
                    login,
                    login,
                    int(kind.startswith("admin")),
                    hashed,
                    stamp,
                    stamp,
                    stamp,
                    f"{SENTINEL}@example.test",
                    SENTINEL,
                ),
            )
            members[kind] = {"id": id_, "login": login, "nickname": login}
        owners = ("member", "member2", "admin")
        states = ("healthy", None, "http_error")
        for index in range(count):
            id_ = str(uuid4())
            name = f"{prefix}-app-{index:02d}"
            created = stamp_after(stamp, index)
            insert_app(
                db,
                id_,
                members[owners[index % 3]]["id"],
                name,
                index % 2 == 0,
                created,
                states[index % 3],
            )
            apps.append({"id": id_, "name": name, "public": index % 2 == 0})
    return {"members": members, "apps": apps, "rates": rates, "baseline": baseline}


def add_app(value):
    owner_id, name, public = value
    id_ = str(uuid4())
    with connect() as db:
        insert_app(db, id_, owner_id, name, public, stamp_after(now(), 3600), None)
    return {"id": id_, "name": name}


def delete_apps(ids):
    with connect() as db:
        for id_ in ids:
            db.execute("DELETE FROM apps WHERE id=?", (id_,))
    return {"deleted": len(ids)}


def count(_):
    with connect() as db:
        return {"apps": db.execute("SELECT count(*) FROM apps").fetchone()[0]}


def mutate(value):
    sql, args = value
    with connect() as db:
        db.execute(sql, args)
    return {}


def cleanup(value):
    ids = [m["id"] for m in value["members"].values()]
    marks = ",".join("?" for _ in ids)
    flows = set(value["flows"])
    apps = {a["id"] for a in value["apps"]}
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        flows.update(
            r[0]
            for r in db.execute(
                f"SELECT flow_id FROM sessions WHERE member_id IN ({marks})", ids
            )
        )
        apps.update(
            r[0]
            for r in db.execute(f"SELECT id FROM apps WHERE owner_id IN ({marks})", ids)
        )
        for flow_id in flows:
            for table in (
                "auth_transitions",
                "recovery_credentials",
                "auth_retired_credentials",
                "sessions",
            ):
                db.execute(f"DELETE FROM {table} WHERE flow_id=?", (flow_id,))
            db.execute("DELETE FROM auth_flows WHERE id=?", (flow_id,))
            db.execute(
                "DELETE FROM auth_retired_flow_ids WHERE id_hash=?", (digest(flow_id),)
            )
        db.execute(
            f"DELETE FROM write_operations WHERE actor_id IN ({marks}) OR target_id IN ({marks})",
            ids + ids,
        )
        db.execute(
            f"DELETE FROM audit_logs WHERE actor_id IN ({marks}) OR target_id IN ({marks})",
            ids + ids,
        )
        for id_ in apps:
            db.execute("DELETE FROM apps WHERE id=?", (id_,))
        db.execute(f"DELETE FROM members WHERE id IN ({marks})", ids)
        old = {tuple(row) for row in value["rates"]}
        for row in db.execute("SELECT * FROM rate_limit_events").fetchall():
            if tuple(row) not in old:
                db.execute("DELETE FROM rate_limit_events WHERE id=?", (row[0],))
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        assert not violations, violations
        db.commit()
        leftovers = {
            "members": db.execute(
                f"SELECT count(*) FROM members WHERE id IN ({marks})", ids
            ).fetchone()[0],
            "apps": db.execute("SELECT count(*) FROM apps").fetchone()[0]
            - value["baseline"],
            "operations": db.execute(
                f"SELECT count(*) FROM write_operations WHERE actor_id IN ({marks}) OR target_id IN ({marks})",
                ids + ids,
            ).fetchone()[0],
            "audit": db.execute(
                f"SELECT count(*) FROM audit_logs WHERE actor_id IN ({marks}) OR target_id IN ({marks})",
                ids + ids,
            ).fetchone()[0],
            "flows": sum(
                db.execute(
                    f"SELECT count(*) FROM {table} WHERE {column}=?", (flow_id,)
                ).fetchone()[0]
                for flow_id in flows
                for table, column in (
                    ("auth_flows", "id"),
                    ("sessions", "flow_id"),
                    ("recovery_credentials", "flow_id"),
                    ("auth_transitions", "flow_id"),
                    ("auth_retired_credentials", "flow_id"),
                )
            ),
            "grades_health": db.execute(
                "SELECT (SELECT count(*) FROM app_grades WHERE app_id NOT IN (SELECT id FROM apps))"
                "+(SELECT count(*) FROM health_results WHERE app_id NOT IN (SELECT id FROM apps))"
            ).fetchone()[0],
        }
    return leftovers


ACTIONS = {
    "create": create,
    "add_app": add_app,
    "delete_apps": delete_apps,
    "count": count,
    "mutate": mutate,
    "cleanup": cleanup,
}

if __name__ == "__main__":
    action, value = json.load(sys.stdin)
    print(json.dumps(ACTIONS[action](value)))
