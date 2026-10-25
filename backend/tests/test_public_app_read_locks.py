"""Authenticated gallery reads against a SQLite write reservation held elsewhere."""

import sqlite3

from fastapi.testclient import TestClient

from tests.app_create_client import error
from tests.auth_client import signed_in
from tests.support import populate_public_and_private_apps

PUBLIC_APP = "/api/v1/apps/00000000-0000-4000-8000-000000000002"


def _gallery(member_app):
    app, path = member_app()
    populate_public_and_private_apps(path)
    return app, path


def _context(browser):
    return {
        **browser.session_headers(),
        "X-EduVibe-Auth-Revision": browser.revision,
    }


def test_authenticated_list_reads_while_write_lock_is_held(member_app):
    app, path = _gallery(member_app)
    with TestClient(app) as client:
        browser = signed_in(client, "hangul")
        blocker = sqlite3.connect(path)
        try:
            blocker.execute("BEGIN IMMEDIATE")
            listed = client.get("/api/v1/apps", headers=_context(browser))
        finally:
            blocker.rollback()
            blocker.close()

    assert listed.status_code == 200, listed.text
    assert listed.json()["pagination"]["total"] == 2


def test_authenticated_detail_keeps_write_reservation(member_app):
    app, path = _gallery(member_app)
    with TestClient(app) as client:
        browser = signed_in(client, "hangul")
        blocker = sqlite3.connect(path)
        try:
            blocker.execute("BEGIN IMMEDIATE")
            # Detail refreshes session activity, so it waits out the busy timeout.
            busy = client.get(PUBLIC_APP, headers=_context(browser))
        finally:
            blocker.rollback()
            blocker.close()
        released = client.get(PUBLIC_APP, headers=_context(browser))

    error(busy, 503, "DB_BUSY")
    assert busy.headers["Retry-After"] == "1"
    assert released.status_code == 200, released.text
