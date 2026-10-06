"""Test-owned members; never alter production bootstrap or another spec's accounts."""

import json
import os
import sqlite3
import sys
from uuid import uuid4

from app.auth_boundary import after, now
from app.auth_login import HASHER


def main():
    password, prefix = json.load(sys.stdin)
    stamp = now()
    hashed = HASHER.hash(password)
    members = {}
    with sqlite3.connect(os.environ["DATABASE_PATH"]) as db:
        for kind in ("admin", "member", "pending", "revoked", "temporary"):
            id_ = str(uuid4())
            login = f"{prefix}-{kind}"
            status = kind if kind in ("pending", "revoked") else "approved"
            db.execute(
                "INSERT INTO members(id,login_id,login_id_key,nickname,is_admin,approval_status,password_hash,created_at,updated_at,first_approved_at,must_change_password,temporary_password_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    id_,
                    login,
                    login,
                    login,
                    int(kind == "admin"),
                    status,
                    hashed,
                    stamp,
                    stamp,
                    None if kind == "pending" else stamp,
                    int(kind == "temporary"),
                    after(stamp, 86400) if kind == "temporary" else None,
                ),
            )
            members[kind] = {"id": id_, "login": login}
    print(json.dumps(members))


if __name__ == "__main__":
    main()
