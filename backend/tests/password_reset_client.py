"""Isolated reset supply and real HTTP helpers."""

import hashlib
import json
import secrets
import sqlite3

from tests.auth_client import signed_in
from tests.support import AUTH_MEMBERS, populate_auth_members

PASSWORD = "Temporary synthetic password 167!"
BASE = "/api/v1"
TARGET = AUTH_MEMBERS["approved"][0]


def supply(path, secret=None):
    secret = secret or secrets.token_bytes(32)
    path.write_text(
        json.dumps(
            {"secret_hex": secret.hex(), "key_id": hashlib.sha256(secret).hexdigest()}
        )
    )
    path.chmod(0o600)
    return path


def reset_app(make_test_app, tmp_path, name="reset.sqlite3"):
    path = tmp_path / name
    secret = supply(tmp_path / (name + ".json"))
    app = make_test_app(path, auth_testing=True, password_reset_hmac_path=secret)
    populate_auth_members(path)
    return app, path, secret


def admin(client):
    return signed_in(client, "admin")


def headers(browser, key=None):
    values = {**browser.session_headers(), "X-EduVibe-Auth-Revision": browser.revision}
    if key:
        values["Idempotency-Key"] = key
    return values


def issue(browser, target=TARGET, version=1, password=PASSWORD):
    return browser.client.post(
        f"{BASE}/write-operations",
        json={
            "kind": "user_password_reset",
            "target_id": target,
            "expected_account_version": version,
            "new_password": password,
        },
        headers=headers(browser),
    )


def execute(browser, key, target=TARGET, version=1, password=PASSWORD):
    return browser.client.post(
        f"{BASE}/admin/users/{target}/password-reset",
        json={"expected_account_version": version, "new_password": password},
        headers=headers(browser, key),
    )


def result(browser, key):
    return browser.client.get(
        f"{BASE}/write-operations/{key}", headers=headers(browser)
    )


def cancel(browser, key):
    return browser.client.post(
        f"{BASE}/write-operations/{key}/cancel", headers=headers(browser)
    )


def snapshot(path):
    with sqlite3.connect(path) as db:
        return {
            table: db.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            for table in ("members", "sessions", "write_operations", "audit_logs")
        }
