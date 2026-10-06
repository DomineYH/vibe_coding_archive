"""Stdin-driven fixture creation and exact owned-row teardown in API runner databases."""

import json
import os
import sqlite3
import sys
from uuid import uuid4

from app.auth_boundary import after, digest, now
from app.auth_login import HASHER
from app.catalog import CATALOG


def create(value):
    password, prefix = value
    stamp = now()
    members = {}
    hashed = HASHER.hash(password)
    app_ids = []
    with sqlite3.connect(os.environ["DATABASE_PATH"]) as db:
        db.execute("PRAGMA foreign_keys=ON")
        rates = db.execute("SELECT * FROM rate_limit_events").fetchall()
        for kind in ("admin", "member", "zero", "pending", "revoked", "temporary"):
            id_ = str(uuid4())
            login = f"{prefix}-{kind}"
            db.execute(
                "INSERT INTO members(id,login_id,login_id_key,nickname,is_admin,approval_status,password_hash,created_at,updated_at,first_approved_at,must_change_password,temporary_password_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    id_,
                    login,
                    login,
                    login,
                    int(kind == "admin"),
                    kind if kind in ("pending", "revoked") else "approved",
                    hashed,
                    stamp,
                    stamp,
                    None if kind == "pending" else stamp,
                    int(kind == "temporary"),
                    after(stamp, 86400) if kind == "temporary" else None,
                ),
            )
            members[kind] = {"id": id_, "login": login}
        for public in (True, False):
            id_ = str(uuid4())
            app_ids.append(id_)
            db.execute(
                "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,version,url_version,created_at,updated_at) VALUES (?,?,?,'https://www.naver.com','synthetic prompt','synthetic description',?,?,?,1,1,?,?)",
                (
                    id_,
                    members["member"]["id"],
                    f"{prefix}-app-{int(public)}",
                    CATALOG["subjects"][0],
                    int(public),
                    CATALOG["themes"][0]["id"],
                    stamp,
                    stamp,
                ),
            )
            db.execute(
                "INSERT INTO app_grades VALUES (?,?)", (id_, CATALOG["grades"][0])
            )
            db.execute(
                "INSERT INTO health_results VALUES (?,'healthy',?,?)",
                (id_, stamp, after(stamp, 3600)),
            )
    return {"members": members, "apps": app_ids, "rates": rates}


def cleanup(value):
    path = os.environ["DATABASE_PATH"]
    from pathlib import Path

    ids = [m["id"] for m in value["members"].values()]
    marks = ",".join("?" for _ in ids)
    flows = set(value["flows"])
    apps = set(value["apps"])
    with (
        sqlite3.connect(Path(path).with_suffix(".deletions.sqlite3")) as ledger,
        sqlite3.connect(path) as db,
    ):
        ledger.execute("BEGIN IMMEDIATE")
        db.execute("PRAGMA foreign_keys=ON")
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
        db.execute(f"DELETE FROM user_delete_outbox WHERE member_id IN ({marks})", ids)
        for id_ in apps:
            db.execute("DELETE FROM app_delete_outbox WHERE app_id=?", (id_,))
            db.execute("DELETE FROM apps WHERE id=?", (id_,))
        db.execute(f"DELETE FROM members WHERE id IN ({marks})", ids)
        old = {tuple(row) for row in value["rates"]}
        for row in db.execute("SELECT * FROM rate_limit_events").fetchall():
            if tuple(row) not in old:
                db.execute("DELETE FROM rate_limit_events WHERE id=?", (row[0],))
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        db.commit()  # Retire operational mirrors before their isolated independent entries.
        ledger.execute(
            f"DELETE FROM completed_user_delete_events WHERE member_id IN ({marks})",
            ids,
        )
        for id_ in apps:
            ledger.execute(
                "DELETE FROM completed_app_delete_events WHERE app_id=?", (id_,)
            )
        ledger.commit()
        leftovers = {
            "members": db.execute(
                f"SELECT count(*) FROM members WHERE id IN ({marks})", ids
            ).fetchone()[0],
            "operations": db.execute(
                f"SELECT count(*) FROM write_operations WHERE actor_id IN ({marks}) OR target_id IN ({marks})",
                ids + ids,
            ).fetchone()[0],
            "audit": db.execute(
                f"SELECT count(*) FROM audit_logs WHERE actor_id IN ({marks}) OR target_id IN ({marks})",
                ids + ids,
            ).fetchone()[0],
            "outbox": db.execute(
                f"SELECT count(*) FROM user_delete_outbox WHERE member_id IN ({marks})",
                ids,
            ).fetchone()[0],
            "ledger": ledger.execute(
                f"SELECT count(*) FROM completed_user_delete_events WHERE member_id IN ({marks})",
                ids,
            ).fetchone()[0],
        }
        for flow_id in flows:
            for table in (
                "auth_flows",
                "sessions",
                "recovery_credentials",
                "auth_transitions",
                "auth_retired_credentials",
            ):
                column = "id" if table == "auth_flows" else "flow_id"
                assert db.execute(
                    f"SELECT count(*) FROM {table} WHERE {column}=?", (flow_id,)
                ).fetchone() == (0,)
        for id_ in apps:
            for table, column in (
                ("apps", "id"),
                ("app_grades", "app_id"),
                ("health_results", "app_id"),
                ("app_delete_outbox", "app_id"),
            ):
                assert db.execute(
                    f"SELECT count(*) FROM {table} WHERE {column}=?", (id_,)
                ).fetchone() == (0,)
            assert ledger.execute(
                "SELECT count(*) FROM completed_app_delete_events WHERE app_id=?",
                (id_,),
            ).fetchone() == (0,)
        assert not any(leftovers.values()), leftovers
    return leftovers


if __name__ == "__main__":
    action, value = json.load(sys.stdin)
    print(json.dumps(create(value) if action == "create" else cleanup(value)))
