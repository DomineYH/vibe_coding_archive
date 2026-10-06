"""Independent account evidence must represent the complete member/app group."""

import sqlite3

from fastapi.testclient import TestClient


def test_account_evidence_is_separate_from_app_events_and_pending_intents(member_app):
    app, path = member_app()
    with TestClient(app), sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as db:
        names = {
            r[0]
            for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "completed_user_delete_events" in names
        assert "completed_app_delete_events" in names


import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from app.auth_maintenance import reconcile, sweep
from tests.auth_client import signed_in
from tests.user_delete_client import TARGET, execute, issue, result, snapshot


def owned_apps(owner):
    from tests.app_create_client import INPUT
    from tests.app_update_client import registered

    return [registered(owner), registered(owner, {**INPUT, "is_public": False})]


def test_preflight_observes_mirrors_of_concurrently_committed_partial_delivery(
    member_app, monkeypatch
):
    from app import user_deletion_ledger as delivery

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        owned_apps(owner)
        key = issue(browser, count=2).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_ack BEFORE UPDATE OF delivered_at ON user_delete_outbox BEGIN SELECT RAISE(ABORT,'partial delivery'); END"
            )
        original = delivery._events

        def concurrent(ledger):
            assert execute(browser, key, count=2).status_code == 503
            return original(ledger)

        with monkeypatch.context() as patch:
            patch.setattr(delivery, "_events", concurrent)
            events = delivery.prepare(app.state.session_factory)
        assert len(events) == 1
        assert result(browser, key).json()["state"] == "confirming_deletion"


def test_partial_commit_and_ack_loss_redeliver_after_key_expiry(member_app):
    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        apps = owned_apps(owner)
        key = issue(browser, count=2).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_ack BEFORE UPDATE OF delivered_at ON user_delete_outbox BEGIN SELECT RAISE(ABORT,'ack failure'); END"
            )
        response = execute(browser, key, count=2)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "DELETION_CONFIRMATION_PENDING"
        original = result(browser, key).json()
        assert (
            original["state"] == "confirming_deletion"
            and original["db_applied_at"]
            and original["finalized_at"] is None
        )
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            first = ledger.execute(
                "SELECT * FROM completed_user_delete_events"
            ).fetchall()
            assert len(first) == 1
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchone()
                is None
            )
            assert (
                db.execute("SELECT id FROM apps WHERE owner_id=?", (TARGET,)).fetchall()
                == []
            )
            db.execute("DROP TRIGGER fail_ack")
            db.execute("DELETE FROM write_operations WHERE key=?", (key,))
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM user_delete_outbox WHERE delivered_at IS NULL"
            ).fetchone() == (0,)
            assert db.execute(
                "SELECT count(*) FROM write_operations WHERE key=?", (key,)
            ).fetchone() == (0,)
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_delete'"
            ).fetchone() == (1,)
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            rows = ledger.execute(
                "SELECT * FROM completed_user_delete_events"
            ).fetchall()
            assert len(rows) == 3
            assert all(row[8] == original["db_applied_at"] for row in rows)
            assert first[0] in rows
            assert {r[4] for r in rows if r[3] == "app"} == {a["id"] for a in apps}


def test_full_group_finalization_failure_remains_pending_then_retries(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        key = issue(browser).json()["key"]
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TRIGGER fail_final BEFORE UPDATE ON write_operations WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'final ack'); END"
            )
        assert execute(browser, key).status_code == 503
        assert result(browser, key).json()["state"] == "confirming_deletion"
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT delivered_at FROM user_delete_outbox").fetchone()[
                0
            ]
            db.execute("DROP TRIGGER fail_final")
        sweep(app.state.session_factory)
        assert result(browser, key).json()["state"] == "succeeded"


def test_ledger_lock_has_one_total_budget_and_no_operational_lock(member_app):
    app, path = member_app()
    with (
        TestClient(app) as client,
        TestClient(app) as owner_client,
        ThreadPoolExecutor() as workers,
    ):
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        owned_apps(owner)
        key = issue(browser, count=2).json()["key"]
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            start = time.monotonic()
            pending = workers.submit(execute, browser, key, count=2)
            # Observe the committed result through a real second connection.
            deadline = start + 3
            while time.monotonic() < deadline:
                with sqlite3.connect(path, timeout=0.1) as db:
                    if db.execute(
                        "SELECT state FROM write_operations WHERE key=?", (key,)
                    ).fetchone() == ("confirming_deletion",):
                        break
            with sqlite3.connect(path, timeout=0.1) as db:
                db.execute("BEGIN IMMEDIATE")
                assert (
                    db.execute(
                        "SELECT id FROM members WHERE id=?", (TARGET,)
                    ).fetchone()
                    is None
                )
            assert pending.result(timeout=8).status_code == 503
            assert 4.5 <= time.monotonic() - start < 6.5
        assert execute(browser, key, count=2).status_code == 204
        assert result(browser, key).json()["state"] == "succeeded"


@pytest.mark.parametrize(
    "damage",
    [
        "missing_event",
        "missing_table",
        "partial_without_mirror",
        "hash",
        "stamp",
        "schema",
    ],
)
def test_restore_rejects_bad_group_before_any_replay_or_independent_write(
    member_app, tmp_path, damage
):
    app, path = member_app()
    backup = tmp_path / "backup.sqlite3"
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        owned_apps(owner)
        key = issue(browser, count=2).json()["key"]
        with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
            src.backup(dst)
        assert execute(browser, key, count=2).status_code == 204
        with sqlite3.connect(backup) as src, sqlite3.connect(path) as dst:
            src.backup(dst)
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            if damage in ("missing_event", "partial_without_mirror"):
                ledger.execute(
                    "DELETE FROM completed_user_delete_events WHERE event_id IN (SELECT event_id FROM completed_user_delete_events WHERE kind='app' LIMIT 1)"
                )
            elif damage == "missing_table":
                ledger.execute("DROP TABLE completed_user_delete_events")
            elif damage == "schema":
                ledger.execute("DROP TABLE completed_user_delete_events")
                ledger.execute(
                    "CREATE TABLE completed_user_delete_events(event_id TEXT)"
                )
            else:
                ledger.execute(
                    "UPDATE completed_user_delete_events SET "
                    + (
                        "manifest_hash='" + "a" * 64 + "'"
                        if damage == "hash"
                        else "db_applied_at='2000-01-01T00:00:00Z'"
                    )
                )
            before_ledger = ledger.execute(
                "SELECT * FROM sqlite_master ORDER BY name"
            ).fetchall()
        before = snapshot(path)
        with pytest.raises(RuntimeError):
            reconcile(app.state.session_factory, restored=True)
        assert snapshot(path) == before
        with sqlite3.connect(ledger_path) as ledger:
            assert (
                ledger.execute("SELECT * FROM sqlite_master ORDER BY name").fetchall()
                == before_ledger
            )


def test_restore_redeletes_member_and_current_owned_apps_and_invalidates_auth(
    member_app, tmp_path
):
    app, path = member_app()
    backup = tmp_path / "backup.sqlite3"
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        apps = owned_apps(owner)
        key = issue(browser, count=2).json()["key"]
        with sqlite3.connect(path) as src, sqlite3.connect(backup) as dst:
            src.backup(dst)
        assert execute(browser, key, count=2).status_code == 204
        with sqlite3.connect(backup) as src, sqlite3.connect(path) as dst:
            src.backup(dst)
        reconcile(app.state.session_factory, restored=True)
        with sqlite3.connect(path) as db:
            assert (
                db.execute("SELECT id FROM members WHERE id=?", (TARGET,)).fetchone()
                is None
            )
            assert (
                db.execute("SELECT id FROM apps WHERE owner_id=?", (TARGET,)).fetchall()
                == []
            )
            assert db.execute("SELECT * FROM write_operations").fetchall() == []
            assert (
                db.execute("SELECT * FROM sessions WHERE revoked_at IS NULL").fetchall()
                == []
            )
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert owner.me().status_code == 401
        assert len(apps) == 2


def test_old_app_outbox_survives_owner_key_cleanup_and_delivers(member_app):
    from tests.app_delete_client import delete, delete_key

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        apps = owned_apps(owner)
        app_key = delete_key(owner, apps[0]["id"])
        ledger_path = path.with_suffix(".deletions.sqlite3")
        with sqlite3.connect(ledger_path) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            assert delete(owner, apps[0]["id"], app_key).status_code == 503
            key = issue(browser, count=1).json()["key"]
            assert execute(browser, key, count=1).status_code == 503
        sweep(app.state.session_factory)
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT key FROM write_operations WHERE key=?", (app_key,)
                ).fetchone()
                is None
            )
            assert db.execute("SELECT delivered_at FROM app_delete_outbox").fetchone()[
                0
            ]
            assert db.execute(
                "SELECT count(*) FROM user_delete_outbox WHERE delivered_at IS NULL"
            ).fetchone() == (0,)


def test_concurrent_same_key_and_confirmers_have_one_group(member_app):
    app, path = member_app()
    with (
        TestClient(app) as client,
        TestClient(app) as other_client,
        ThreadPoolExecutor() as workers,
    ):
        browser = signed_in(client, "admin")
        other = signed_in(other_client, "admin")
        key = issue(browser).json()["key"]
        one = workers.submit(execute, browser, key)
        two = workers.submit(execute, other, key)
        statuses = [one.result().status_code, two.result().status_code]
        assert 204 in statuses and set(statuses) <= {204, 409}
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM user_delete_outbox").fetchone() == (
                1,
            )
            assert db.execute(
                "SELECT count(*) FROM audit_logs WHERE action='user_delete'"
            ).fetchone() == (1,)


def test_independent_schema_cannot_add_target_foreign_keys(member_app):
    from app.user_deletion_ledger import INDEXES, SCHEMA, prepare

    app, path = member_app()
    with TestClient(app):
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("DROP TABLE completed_user_delete_events")
            ledger.execute(
                SCHEMA.replace(
                    "member_id TEXT NOT NULL,",
                    "member_id TEXT NOT NULL REFERENCES member_deletions(member_id),",
                )
            )
            for ddl in INDEXES:
                ledger.execute(ddl)
        with pytest.raises(RuntimeError, match="schema"):
            prepare(app.state.session_factory)


def test_one_deadline_is_spent_across_all_event_acknowledgements(
    member_app, monkeypatch
):
    from app import user_deletion_ledger as delivery

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as owner_client:
        browser = signed_in(client, "admin")
        owner = signed_in(owner_client)
        owned_apps(owner)
        key = issue(browser, count=2).json()["key"]
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
            ledger.execute("BEGIN IMMEDIATE")
            assert execute(browser, key, count=2).status_code == 503
        with sqlite3.connect(path) as db:
            group = db.execute(
                "SELECT group_id FROM user_delete_outbox LIMIT 1"
            ).fetchone()[0]
        clock = [time.monotonic()]
        original = delivery._operational

        def elapsed(factory, deadline):
            clock[0] += 1.5
            return original(factory, deadline)

        with monkeypatch.context() as patch:
            patch.setattr(delivery.time, "monotonic", lambda: clock[0])
            patch.setattr(delivery, "_operational", elapsed)
            assert not delivery.confirm(app.state.session_factory, group)
        assert result(browser, key).json()["state"] == "confirming_deletion"
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM user_delete_outbox WHERE delivered_at IS NULL"
                ).fetchone()[0]
                > 0
            )


@pytest.mark.parametrize("stage", ["before_commit", "committed"])
def test_actual_process_kill_on_each_side_of_db_commit_recovers_original_key(
    member_app, password_blocklist, stage
):
    from tests.auth_process import AuthProcess

    _, path = member_app()
    server = AuthProcess(path, password_blocklist)
    try:
        server.start()
        with server.client() as client, server.client() as owner_client:
            browser = signed_in(client, "admin")
            owner = signed_in(owner_client)
            apps = owned_apps(owner)
            key = issue(browser, count=2).json()["key"]
            before = snapshot(path)
            cookies = dict(client.cookies)
            server.command(action="arm", stage=stage)
            with ThreadPoolExecutor() as workers:
                pending = workers.submit(execute, browser, key, count=2)
                server.wait()
                server.kill()
                with pytest.raises(httpx.TransportError):
                    pending.result(timeout=5)
            if stage == "before_commit":
                assert snapshot(path) == before
            else:
                with sqlite3.connect(path) as db:
                    assert db.execute(
                        "SELECT state FROM write_operations WHERE key=?", (key,)
                    ).fetchone() == ("confirming_deletion",)
                    assert (
                        db.execute(
                            "SELECT id FROM members WHERE id=?", (TARGET,)
                        ).fetchone()
                        is None
                    )
                    assert db.execute(
                        "SELECT count(*) FROM user_delete_outbox"
                    ).fetchone() == (3,)
            with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
                assert ledger.execute(
                    "SELECT count(*) FROM completed_user_delete_events"
                ).fetchone() == (0,)
        server.start()
        with server.client() as restarted:
            restarted.cookies.update(cookies)
            browser.client = restarted
            found = result(browser, key).json()
            if stage == "before_commit":
                assert found["state"] == "unresolved"
                assert execute(browser, key, count=2).status_code == 204
            else:
                assert found["state"] == "succeeded"
            with sqlite3.connect(path) as db:
                assert db.execute("PRAGMA foreign_key_check").fetchall() == []
                assert db.execute(
                    "SELECT count(*) FROM user_delete_outbox"
                ).fetchone() == (3,)
                assert db.execute(
                    "SELECT count(*) FROM audit_logs WHERE action='user_delete'"
                ).fetchone() == (1,)
                assert all(
                    db.execute(
                        "SELECT id FROM apps WHERE id=?", (item["id"],)
                    ).fetchone()
                    is None
                    for item in apps
                )
    finally:
        server.close()
