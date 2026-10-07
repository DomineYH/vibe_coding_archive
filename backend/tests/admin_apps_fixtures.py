"""Synthetic apps with forbidden-field sentinels for the administrator app list."""

import sqlite3

from tests.support import AUTH_MEMBERS, CATALOG

SENTINELS = (
    "prompt-sentinel-9f2",
    "description-sentinel-9f2",
    "stack-sentinel-9f2",
    "email-sentinel-9f2@example.test",
    "phone-sentinel-9f2",
)
ADMIN_ID = AUTH_MEMBERS["admin"][0]
APPROVED_ID = AUTH_MEMBERS["approved"][0]
PENDING_ID = AUTH_MEMBERS["pending"][0]
STAMP = "2026-09-28T12:00:00.000000Z"


def app_id(number):
    return f"00000000-0000-4000-8000-{number:012d}"


def seed_apps(path, rows):
    """rows: (number, owner_id, is_public, created_at[, health]) in any order."""
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET email=?,phone=?",
            (SENTINELS[3], SENTINELS[4]),
        )
        for number, owner, public, created, *health in rows:
            id_ = app_id(number)
            db.execute(
                "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,"
                "theme_id,stack_db,stack_backend,stack_frontend,stack_hosting,version,url_version,"
                "created_at,updated_at) VALUES (?,?,?,?,?,?,'수학',?,?,?,?,?,?,3,2,?,?)",
                (
                    id_,
                    owner,
                    f"앱 {number}",
                    f"https://example.test/{number}",
                    SENTINELS[0],
                    SENTINELS[1],
                    int(public),
                    CATALOG["themes"][0]["id"],
                    SENTINELS[2],
                    SENTINELS[2],
                    SENTINELS[2],
                    SENTINELS[2],
                    created,
                    created,
                ),
            )
            db.execute("INSERT INTO app_grades(app_id,grade) VALUES (?,'초2')", (id_,))
            state, checked, fresh = health[0] if health else ("unchecked", None, None)
            db.execute(
                "INSERT INTO health_results(app_id,state,checked_at,fresh_until) VALUES (?,?,?,?)",
                (id_, state, checked, fresh),
            )
