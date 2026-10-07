"""The API E2E owned-fixture teardown must leave exactly the original rows."""

import sqlite3

from fastapi.testclient import TestClient

from app.auth_boundary import digest
from tests import admin_apps_browser_fixtures as fixtures
from tests.auth_client import signed_in
from tests.contracts.test_admin_apps import database_dump


def test_create_and_cleanup_leave_no_owned_row(member_app, monkeypatch):
    app, path = member_app()
    monkeypatch.setenv("DATABASE_PATH", str(path))
    before = database_dump(path)
    owned = fixtures.create(["Synthetic fixture password 162!", "t162", 5])
    assert len(owned["apps"]) == 5
    extra = fixtures.add_app([owned["members"]["member"]["id"], "extra", False])
    assert fixtures.count(None)["apps"] == owned["baseline"] + 6
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        flows = {browser.flow}
    assert fixtures.delete_apps([extra["id"]]) == {"deleted": 1}
    leftovers = fixtures.cleanup({**owned, "flows": sorted(flows)})
    assert not any(leftovers.values()), leftovers
    after = database_dump(path)
    for table in ("members", "apps", "app_grades", "health_results"):
        assert after[table] == before[table]


def add_rate_event(path, purpose, subject, occurred_at="2099-01-01T00:00:00.000000Z"):
    with sqlite3.connect(path) as db:
        return db.execute(
            "INSERT INTO rate_limit_events(purpose,subject_hash,occurred_at,expires_at) VALUES (?,?,?,?)",
            (purpose, subject, occurred_at, "2099-01-02T00:00:00.000000Z"),
        ).lastrowid


def rate_event_ids(path):
    with sqlite3.connect(path) as db:
        return {row[0] for row in db.execute("SELECT id FROM rate_limit_events")}


def test_cleanup_deletes_only_the_rate_events_the_fixture_owns(member_app, monkeypatch):
    _app, path = member_app()
    monkeypatch.setenv("DATABASE_PATH", str(path))
    peer = digest("127.0.0.1")
    earlier = add_rate_event(path, "login_ip", peer)
    owned = fixtures.create(["Synthetic fixture password 162!", "t162", 0])
    login = owned["members"]["member"]["login"]
    mine = [
        add_rate_event(path, "login_ip", peer),
        add_rate_event(path, "prepare", peer),
        add_rate_event(path, "login_account", digest(f"{login}\n{peer}")),
    ]
    unrelated = [
        add_rate_event(path, "login_account", "unowned-subject"),
        add_rate_event(path, "login_account", digest(f"someone-else\n{peer}")),
        add_rate_event(path, "prepare", digest("203.0.113.9")),
    ]
    leftovers = fixtures.cleanup({**owned, "flows": []})
    assert not any(leftovers.values()), leftovers
    remaining = rate_event_ids(path)
    assert not remaining & set(mine)
    assert {earlier, *unrelated} <= remaining
