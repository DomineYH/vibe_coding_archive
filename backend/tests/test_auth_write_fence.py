"""Socket HTTP binds approval writes to the original authentication revision."""

import sqlite3

import pytest

from tests.auth_client import API, signed_in
from tests.contracts.test_admin_approval import PENDING_ID, execute, issue


@pytest.mark.parametrize("kind", ["logout", "reauthenticate"])
def test_pending_then_cancelled_transition_never_replays_an_old_approval(
    process_server,
    kind,
):
    server, database = process_server
    with server.client() as client:
        admin = signed_in(client, "admin")
        key = issue(admin).json()["key"]
        generation = admin.generation
        permit = admin.admit(kind).json()
        for result in (issue(admin), execute(admin, key)):
            assert result.status_code == 409
            assert result.json()["error"]["code"] == "AUTH_TRANSITION_PENDING"
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT approval_status,account_version FROM members WHERE id=?",
                (PENDING_ID,),
            ).fetchone() == ("pending", 1)
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                1,
            )
        settled = client.post(
            f"{API}/transitions/{permit['transition_id']}/settle",
            json={"flow_id": admin.flow, "expected_revision": permit["revision"]},
            headers=admin.recovery_headers(),
        )
        assert settled.status_code == 200
        assert settled.json()["result"]["state"] == "cancelled"
        current = admin.state()
        assert current["session_generation"] == generation
        assert current["revision"] != admin.revision
        late = execute(admin, key)
        assert late.status_code == 409
        assert late.json()["error"]["code"] == "AUTH_STATE_CHANGED"
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("unresolved",)
        # Only this explicit request uses the newly observed revision. No
        # original request adopts current headers or retries itself.
        admin.revision = current["revision"]
        assert execute(admin, key).status_code == 200
        with sqlite3.connect(database) as db:
            assert db.execute(
                "SELECT approval_status,account_version FROM members WHERE id=?",
                (PENDING_ID,),
            ).fetchone() == ("approved", 2)
            assert db.execute(
                "SELECT state FROM write_operations WHERE key=?", (key,)
            ).fetchone() == ("succeeded",)
