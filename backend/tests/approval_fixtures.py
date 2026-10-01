"""Synthetic members owned solely by the API E2E runner."""

import sqlite3

from tests.support import _auth_hash


def populate_approval_members(path):
    stamp = "2026-09-29T00:00:00.000000Z"
    rows = [("00000000-0000-4000-8000-000000000110", "approval-admin", "승인 담당", 1)]
    rows += [
        (
            f"00000000-0000-4000-8000-{200 + i:012d}",
            f"approval-{i:02d}",
            f"승인 교사 {i:02d}",
            0,
        )
        for i in range(26)
    ]
    with sqlite3.connect(path) as db:
        db.executemany(
            "INSERT INTO members(id,login_id,login_id_key,nickname,is_admin,approval_status,password_hash,created_at,updated_at,first_approved_at) VALUES (?,?,?,?,?,'approved',?,?,?,?)",
            [
                (id_, login, login, nickname, admin, _auth_hash(), stamp, stamp, stamp)
                for id_, login, nickname, admin in rows
            ],
        )
