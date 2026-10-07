"""Real HTTP account deletion over isolated migrated databases."""

import sqlite3

from tests.password_reset_client import BASE, TARGET, headers, result


def issue(browser, target=TARGET, count=0):
    return browser.client.post(
        f"{BASE}/write-operations",
        json={"kind": "user_delete", "target_id": target, "expected_app_count": count},
        headers=headers(browser),
    )


def execute(browser, key, target=TARGET, count=0):
    return browser.client.request(
        "DELETE",
        f"{BASE}/admin/users/{target}",
        json={"expected_app_count": count},
        headers=headers(browser, key),
    )


def snapshot(path):
    with sqlite3.connect(path) as db:
        tables = [
            r[0]
            for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {
            t: db.execute(f'SELECT * FROM "{t}" ORDER BY 1').fetchall() for t in tables
        }


__all__ = ["BASE", "TARGET", "execute", "headers", "issue", "result", "snapshot"]
