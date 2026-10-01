import os
import sqlite3
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from threading import Event

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.pending_retention import sweep_pending
from tests.auth_client import Browser
from tests.support import AUTH_MEMBERS


def maintenance(path, command="sweep-pending"):
    return subprocess.run(
        [sys.executable, "-m", "app.cli", command],
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        check=False,
        capture_output=True,
        text=True,
    )


def test_initial_pending_expiry_preserves_approved_history_and_replays_deletion_after_restore(
    member_app,
):
    app, path = member_app()
    pending_id = AUTH_MEMBERS["pending"][0]
    expired = (
        (datetime.now(UTC) - timedelta(days=90, seconds=1))
        .isoformat()
        .replace("+00:00", "Z")
    )
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET created_at=?, updated_at=? WHERE id=?",
            (expired, expired, pending_id),
        )
        # Past approval followed by revocation is never initial pending.
        db.execute(
            "UPDATE members SET approval_status='revoked', created_at=? WHERE id=?",
            (expired, AUTH_MEMBERS["approved"][0]),
        )
        backup = path.with_name("backup.sqlite3")
        with sqlite3.connect(backup) as copy:
            db.commit()
            db.backup(copy)
    result = maintenance(path)
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(path) as db:
        assert (
            db.execute("SELECT id FROM members WHERE id=?", (pending_id,)).fetchone()
            is None
        )
        assert db.execute(
            "SELECT id FROM members WHERE id=?", (AUTH_MEMBERS["approved"][0],)
        ).fetchone()
        assert db.execute("SELECT member_id FROM member_deletions").fetchall() == [
            (pending_id,)
        ]
    # Restore only operational data. The independent deletion ledger never rolls back.
    with sqlite3.connect(backup) as copy, sqlite3.connect(path) as db:
        copy.backup(db)
    result = maintenance(path, "invalidate-restored-auth")
    assert result.returncode == 0, result.stderr
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        assert (
            browser.login(AUTH_MEMBERS["pending"][1]).json()["error"]["code"]
            == "INVALID_CREDENTIALS"
        )
    with sqlite3.connect(path) as db:
        assert (
            db.execute("SELECT id FROM members WHERE id=?", (pending_id,)).fetchone()
            is None
        )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep


def make_expired(path):
    id_ = AUTH_MEMBERS["pending"][0]
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET created_at='2026-01-01T00:00:00.000000Z' WHERE id=?",
            (id_,),
        )
    return id_


def test_approval_commits_first_while_deletion_waits_for_final_write_lock(member_app):
    app, path = member_app()
    with TestClient(app):
        pass  # Prepare the independent ledger before the controlled race.
    id_ = make_expired(path)
    waiting = Event()

    def observe_lock(connection, cursor, statement, parameters, context, many):
        if statement == "BEGIN IMMEDIATE":
            waiting.set()
        if statement.startswith("SELECT id FROM members WHERE approval_status="):
            # A candidate SELECT outside the write transaction must fail here,
            # even when scheduling happens to make the resulting race harmless.
            assert cursor.connection.in_transaction

    event.listen(app.state.engine, "before_cursor_execute", observe_lock)
    try:
        with sqlite3.connect(path) as approval, ThreadPoolExecutor(1) as pool:
            approval.execute("BEGIN IMMEDIATE")
            future = pool.submit(sweep_pending, app.state.session_factory)
            assert waiting.wait(5)
            assert not future.done()  # sweep has reached the occupied DB lock.
            stamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            approval.execute(
                "UPDATE members SET approval_status='approved',first_approved_at=?,account_version=account_version+1 WHERE id=?",
                (stamp, id_),
            )
            approval.commit()
            future.result()
    finally:
        event.remove(app.state.engine, "before_cursor_execute", observe_lock)
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT approval_status,first_approved_at,account_version FROM members WHERE id=?",
            (id_,),
        ).fetchone() == ("approved", stamp, 2)
        assert db.execute("SELECT member_id FROM member_deletions").fetchall() == []


def test_deletion_commits_first_and_late_approval_cannot_resurrect(member_app):
    app, path = member_app()
    with TestClient(app):
        pass
    id_ = make_expired(path)
    ledger_path = path.with_suffix(".deletions.sqlite3")
    with sqlite3.connect(ledger_path) as ledger, ThreadPoolExecutor(2) as pool:
        ledger.execute("BEGIN IMMEDIATE")
        deletion = pool.submit(maintenance, path)
        # The child holds the final operational lock while waiting to commit intent.
        deadline = monotonic() + 4
        while True:
            try:
                with sqlite3.connect(path, timeout=0) as probe:
                    probe.execute("BEGIN IMMEDIATE")
                assert monotonic() < deadline
                sleep(0.01)
            except sqlite3.OperationalError:
                break

        def approve():
            with sqlite3.connect(path, timeout=5) as db:
                return db.execute(
                    "UPDATE members SET approval_status='approved',first_approved_at=? WHERE id=?",
                    (datetime.now(UTC).isoformat(), id_),
                ).rowcount

        approval = pool.submit(approve)
        ledger.commit()
        assert deletion.result().returncode == 0
        assert approval.result() == 0
    with sqlite3.connect(path) as db:
        assert (
            db.execute("SELECT id FROM members WHERE id=?", (id_,)).fetchone() is None
        )
        assert db.execute("SELECT member_id FROM member_deletions").fetchall() == [
            (id_,)
        ]


def test_failed_durable_ledger_blocks_deletion_and_readiness(member_app):
    app, path = member_app()
    with TestClient(app):
        pass
    id_ = make_expired(path)
    with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
        ledger.execute(
            "CREATE TRIGGER fail_record BEFORE INSERT ON member_deletions BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
        )
    assert maintenance(path).returncode != 0
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id FROM members WHERE id=?", (id_,)).fetchone()
        assert db.execute("SELECT member_id FROM member_deletions").fetchall() == []
    with TestClient(app) as client:
        assert client.get("/readyz").status_code == 503
        assert (
            client.get("/api/v1/meta").json()["capabilities"]["auth_register"][
                "enabled"
            ]
            is False
        )


def test_durable_intent_survives_operational_rollback_and_retry(member_app):
    app, path = member_app()
    with TestClient(app):
        pass
    id_ = make_expired(path)
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TRIGGER fail_delete BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
        )
    assert maintenance(path).returncode != 0
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id FROM members WHERE id=?", (id_,)).fetchone()
        db.execute("DROP TRIGGER fail_delete")
    with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
        assert ledger.execute("SELECT member_id FROM member_deletions").fetchall() == [
            (id_,)
        ]
    assert maintenance(path).returncode == 0
    assert maintenance(path).returncode == 0
    with sqlite3.connect(path) as db:
        assert (
            db.execute("SELECT id FROM members WHERE id=?", (id_,)).fetchone() is None
        )
        assert db.execute("SELECT member_id FROM member_deletions").fetchall() == [
            (id_,)
        ]


def test_exact_ninetieth_day_is_deleted_and_one_microsecond_before_is_retained(
    member_app,
):
    app, path = member_app()
    with TestClient(app):
        pass
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET created_at='2026-07-04T00:00:00.000000Z' WHERE id=?",
            (AUTH_MEMBERS["pending"][0],),
        )

    def at(clock):
        script = """import sys
from datetime import datetime
from app import auth_boundary
from app.cli import main
fixed = sys.argv.pop()
class Clock(datetime):
    @classmethod
    def now(cls, tz=None): return datetime.fromisoformat(fixed)
auth_boundary.datetime = Clock
raise SystemExit(main())
"""
        return subprocess.run(
            [sys.executable, "-c", script, "sweep-pending", clock],
            env={
                **os.environ,
                "APP_ENV": "test",
                "DATABASE_PATH": str(path),
                "PUBLIC_ORIGIN": "http://localhost:5174",
            },
            check=False,
            capture_output=True,
            text=True,
        )

    assert at("2026-10-01T23:59:59.999999Z").returncode == 0
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT created_at FROM members WHERE id=?", (AUTH_MEMBERS["pending"][0],)
        ).fetchone() == ("2026-07-04T00:00:00.000000Z",)
    assert at("2026-10-02T00:00:00.000000Z").returncode == 0
    with sqlite3.connect(path) as db:
        assert (
            db.execute(
                "SELECT id FROM members WHERE id=?", (AUTH_MEMBERS["pending"][0],)
            ).fetchone()
            is None
        )


def test_restore_without_current_independent_ledger_is_rejected(member_app):
    _, path = member_app()
    result = maintenance(path, "invalidate-restored-auth")
    assert result.returncode == 1
    assert "service must remain unavailable" in result.stderr
    assert "Traceback" not in result.stderr


def test_pending_deletion_records_archive_app_ids_without_recording_content(member_app):
    app, path = member_app()
    with TestClient(app):
        pass
    id_ = make_expired(path)
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,version,url_version,created_at,updated_at) VALUES ('expired-app',?,'합성 원문','https://example.test','합성 prompt','합성 description','수학',1,'cloudDancer',1,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            (id_,),
        )
    assert maintenance(path).returncode == 0
    with sqlite3.connect(path) as db:
        assert (
            db.execute("SELECT id FROM apps WHERE id='expired-app'").fetchone() is None
        )
        assert db.execute("SELECT app_id FROM app_deletions").fetchall() == [
            ("expired-app",)
        ]
    with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
        assert ledger.execute("SELECT app_id FROM app_deletions").fetchall() == [
            ("expired-app",)
        ]
        assert [
            row[1] for row in ledger.execute("PRAGMA table_info(app_deletions)")
        ] == ["app_id", "deleted_at"]


def test_failed_cli_intent_is_cancelled_when_approval_commits_before_replay(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        id_ = make_expired(path)
        with sqlite3.connect(path) as db:
            db.execute(
                "INSERT INTO apps(id,owner_id,name,url,prompt,description,subject,is_public,theme_id,version,url_version,created_at,updated_at) VALUES ('approval-app',?,'합성 앱','https://example.test','합성 prompt','합성 description','수학',1,'cloudDancer',1,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
                (id_,),
            )
            db.execute(
                "CREATE TRIGGER fail_delete BEFORE DELETE ON members BEGIN SELECT RAISE(ABORT,'controlled failure'); END"
            )
        # Exact reviewer scenario: operator CLI fails after durable intent;
        # the independently running service remains ready and accepts approval.
        assert maintenance(path).returncode != 0
        assert client.get("/readyz").status_code == 200
        stamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT id FROM apps WHERE id='approval-app'").fetchone()
            db.execute("DROP TRIGGER fail_delete")
            db.execute(
                "UPDATE members SET approval_status='approved',first_approved_at=?,account_version=account_version+1 WHERE id=?",
                (stamp, id_),
            )
        browser = Browser(client).prepare().anonymous()
        assert browser.login(AUTH_MEMBERS["pending"][1]).status_code == 200
        assert maintenance(path).returncode == 0
        assert maintenance(path).returncode == 0
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT approval_status,first_approved_at,account_version FROM members WHERE id=?",
                (id_,),
            ).fetchone() == ("approved", stamp, 2)
            assert db.execute("SELECT id FROM apps WHERE id='approval-app'").fetchone()
            assert db.execute(
                "SELECT member_id FROM sessions WHERE member_id=?", (id_,)
            ).fetchone()
            assert db.execute(
                "SELECT revoked_at FROM auth_flows WHERE id=?", (browser.flow,)
            ).fetchone() == (None,)
            assert db.execute("SELECT member_id FROM member_deletions").fetchall() == []
            assert db.execute("SELECT app_id FROM app_deletions").fetchall() == []
        assert browser.me().status_code == 200
    with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as ledger:
        assert ledger.execute(
            "SELECT kind,target_id,reason FROM deletion_cancellations ORDER BY kind"
        ).fetchall() == [
            ("app", "approval-app", "OWNER_NOT_INITIAL_PENDING_EXPIRED"),
            ("member", id_, "APPROVAL_COMMITTED"),
        ]
        assert all(
            row[0]
            for row in ledger.execute("SELECT cancelled_at FROM deletion_cancellations")
        )
