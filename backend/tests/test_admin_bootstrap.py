import sqlite3
from datetime import datetime

from tests.admin_cli import run_admin_cli
from tests.support import AUTH_PASSWORD


def test_bootstrap_uses_hidden_confirmed_tty_input_and_atomic_audit(
    tmp_path, migrate_test_database, password_blocklist
):
    path = tmp_path / "admin.sqlite3"
    migrate_test_database(path)
    status, output = run_admin_cli(
        "bootstrap-admin",
        path,
        password_blocklist,
        [
            ("Login ID: ", "first-admin"),
            ("Nickname: ", "관리 담당"),
            ("Temporary password: ", AUTH_PASSWORD),
            ("Confirm temporary password: ", AUTH_PASSWORD),
            ("Type YES to confirm: ", "YES"),
        ],
    )
    assert status == 0
    assert AUTH_PASSWORD not in output
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT login_id, is_admin, approval_status, must_change_password, account_version FROM members"
        ).fetchone() == ("first-admin", 1, "approved", 1, 1)
        assert db.execute("SELECT action, outcome FROM audit_logs").fetchall() == [
            ("bootstrap_admin", "succeeded")
        ]
        created, expiry = db.execute(
            "SELECT created_at,temporary_password_expires_at FROM members"
        ).fetchone()
        assert (
            datetime.fromisoformat(expiry) - datetime.fromisoformat(created)
        ).total_seconds() == 86400


def answers(
    login="first-admin", *, bootstrap=True, password=AUTH_PASSWORD, confirmation=None
):
    return [
        ("Login ID: ", login),
        *([("Nickname: ", "관리 담당")] if bootstrap else []),
        ("Temporary password: ", password),
        (
            "Confirm temporary password: ",
            password if confirmation is None else confirmation,
        ),
        ("Type YES to confirm: ", "YES"),
    ]


def test_cli_guards_collisions_promotion_and_recovery_target(
    member_app, password_blocklist
):
    _app, path = member_app()
    for command, login in [
        ("bootstrap-admin", "brand-new-admin"),
        ("recover-admin", "member-a"),
        ("recover-admin", "missing-admin"),
    ]:
        with sqlite3.connect(path) as db:
            before = db.execute("SELECT * FROM members ORDER BY id").fetchall()
        status, output = run_admin_cli(
            command,
            path,
            password_blocklist,
            answers(login, bootstrap=command == "bootstrap-admin"),
        )
        assert status == 1
        assert AUTH_PASSWORD not in output
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT * FROM members ORDER BY id").fetchall() == before
            assert db.execute("SELECT COUNT(*) FROM audit_logs").fetchone() == (0,)
    with sqlite3.connect(path) as db:
        db.execute("DELETE FROM members WHERE is_admin=1")
    status, _ = run_admin_cli(
        "bootstrap-admin", path, password_blocklist, answers("MEMBER-A")
    )
    assert status == 1
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM members WHERE is_admin=1"
        ).fetchone() == (0,)


def test_recover_invalidates_sessions_increments_version_and_requires_first_change(
    member_app, password_blocklist
):
    from fastapi.testclient import TestClient

    from tests.auth_client import Browser, signed_in

    app, path = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        status, output = run_admin_cli(
            "recover-admin",
            path,
            password_blocklist,
            answers("admin-user", bootstrap=False),
        )
        assert status == 0 and AUTH_PASSWORD not in output
        assert browser.me().status_code == 401
        client.cookies.clear()
        fresh = Browser(client).prepare().anonymous()
        assert fresh.login("admin-user").json()["user"]["session_kind"] == "change_only"
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT account_version, must_change_password FROM members WHERE login_id='admin-user'"
        ).fetchone() == (2, 1)
        assert db.execute("SELECT action FROM audit_logs").fetchall() == [
            ("recover_admin",)
        ]


def test_audit_failure_rolls_back_bootstrap_and_recovery(
    tmp_path, migrate_test_database, member_app, password_blocklist
):
    from fastapi.testclient import TestClient

    from tests.auth_client import signed_in

    empty = tmp_path / "empty.sqlite3"
    migrate_test_database(empty)
    app, existing = member_app()
    with TestClient(app) as client:
        browser = signed_in(client, "admin")
        for command, path, login in [
            ("bootstrap-admin", empty, "first-admin"),
            ("recover-admin", existing, "admin-user"),
        ]:
            with sqlite3.connect(path) as db:
                before = db.execute("SELECT * FROM members ORDER BY id").fetchall()
                sessions = db.execute(
                    "SELECT * FROM sessions ORDER BY rowid"
                ).fetchall()
                db.execute(
                    "CREATE TRIGGER deny_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test-owned audit failure'); END"
                )
            status, output = run_admin_cli(
                command,
                path,
                password_blocklist,
                answers(login, bootstrap=command == "bootstrap-admin"),
            )
            assert status == 1 and AUTH_PASSWORD not in output
            assert "argon2" not in output and "Traceback" not in output
            with sqlite3.connect(path) as db:
                assert (
                    db.execute("SELECT * FROM members ORDER BY id").fetchall() == before
                )
                assert (
                    db.execute("SELECT * FROM sessions ORDER BY rowid").fetchall()
                    == sessions
                )
        assert browser.me().status_code == 200


def test_noninteractive_and_mismatched_confirmation_leave_no_credentials(
    tmp_path, migrate_test_database, password_blocklist
):
    import os
    import subprocess
    import sys

    from tests.conftest import BACKEND

    path = tmp_path / "empty.sqlite3"
    migrate_test_database(path)
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "bootstrap-admin"],
        cwd=BACKEND,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        input="",
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1 and "interactive terminal" in result.stderr
    status, output = run_admin_cli(
        "bootstrap-admin",
        path,
        password_blocklist,
        answers(confirmation="Different synthetic password"),
    )
    assert (
        status == 1
        and AUTH_PASSWORD not in output
        and "Different synthetic password" not in output
    )
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM members").fetchone() == (0,)
