"""The API E2E owned-fixture teardown must leave exactly the original rows."""

from fastapi.testclient import TestClient

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
