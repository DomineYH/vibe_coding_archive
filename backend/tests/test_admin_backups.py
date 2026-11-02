"""Administrator backup API over the real backup core and a controlled encryptor."""

import fcntl
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import backup
from tests.auth_client import Browser, signed_in
from tests.support import AUTH_MEMBERS, populate_auth_members
from tests.test_backup import (  # noqa: F401 - shared fixture
    BACKEND,
    backup_case,
    environment,
    fingerprints,
    run_backup,
)

URL = "/api/v1/admin/backups"
ADMIN_ID = AUTH_MEMBERS["admin"][0]
SENTINEL = "SECRET_TEST_SENTINEL!"


@pytest.fixture
def admin_case(backup_case, make_test_app, monkeypatch):  # noqa: F811
    database, output, recipient = backup_case
    monkeypatch.setenv("BACKUP_ROOT", str(output))
    monkeypatch.setenv("BACKUP_RECIPIENT_FILE", str(recipient))
    app = make_test_app(database, auth_testing=True)
    populate_auth_members(database)
    return app, database, output, recipient


def headers(browser):
    return {**browser.session_headers(), "X-EduVibe-Auth-Revision": browser.revision}


def finished(client, browser):
    for _ in range(600):
        result = client.get(URL, headers=headers(browser))
        assert result.status_code == 200, result.text
        if result.json()["current"]["state"] != "running":
            return result
        time.sleep(0.05)
    raise AssertionError("backup run did not finish")


def audit_rows(database):
    with sqlite3.connect(database) as db:
        return db.execute(
            "SELECT action,actor_id,target_id,outcome FROM audit_logs "
            "WHERE action='backup_create' ORDER BY id"
        ).fetchall()


def error_code(result):
    return result.json()["error"]["code"]


def test_unconfigured_get_is_200_false_and_post_is_409(
    member_app, monkeypatch, tmp_path
):
    monkeypatch.delenv("BACKUP_ROOT", raising=False)
    monkeypatch.delenv("BACKUP_RECIPIENT_FILE", raising=False)
    unsafe = tmp_path / "open-backups"
    unsafe.mkdir(mode=0o755)
    unsafe.chmod(0o755)
    recipient = tmp_path / "recipients.txt"
    recipient.write_text("unused\n")
    for root in (None, unsafe):
        if root is not None:
            monkeypatch.setenv("BACKUP_ROOT", str(root))
            monkeypatch.setenv("BACKUP_RECIPIENT_FILE", str(recipient))
        app, path = member_app(f"{uuid4()}.sqlite3")
        with TestClient(app) as client:
            admin = signed_in(client, "admin")
            listed = client.get(URL, headers=headers(admin))
            assert listed.status_code == 200, listed.text
            assert listed.json() == {
                "configured": False,
                "current": None,
                "items": [],
                "invalid_count": 0,
            }
            created = client.post(URL, headers=headers(admin))
            assert created.status_code == 409, created.text
            assert error_code(created) == "BACKUP_NOT_CONFIGURED"
        assert audit_rows(path) == []
    assert os.listdir(unsafe) == []


def test_post_runs_backup_and_list_shows_local_only_pair(admin_case):
    app, database, output, _recipient = admin_case
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        created = client.post(URL, headers=headers(admin))
        assert created.status_code == 202, created.text
        assert created.headers["Cache-Control"] == "private, no-store"
        body = created.json()
        assert set(body) == {"run_id", "state", "started_at"}
        assert body["state"] == "running"
        run_id = body["run_id"]
        listed = finished(client, admin)
    assert listed.headers["Cache-Control"] == "private, no-store"
    data = listed.json()
    assert data["configured"] is True
    assert data["invalid_count"] == 0
    assert data["current"] == {**body, "state": "local_only"}
    [item] = data["items"]
    manifest = json.loads((output / run_id / "manifest.json").read_bytes())
    backup.validate_manifest(manifest)
    assert item == {
        "run_id": run_id,
        "created_at": manifest["created_at"],
        "original_expires_at": manifest["original_expires_at"],
        "ciphertext_bytes": manifest["ciphertext"]["bytes"],
        "release_id": "test",
        "revision": manifest["revision"],
        "status": "LOCAL_ONLY_REMOTE_NOT_CONFIRMED",
    }
    assert set(os.listdir(output)) == {".backup.lock", run_id}
    assert audit_rows(database) == [("backup_create", ADMIN_ID, run_id, "local_only")]


def test_lock_held_by_other_process_returns_409_without_stage(admin_case):
    app, database, output, _recipient = admin_case
    lock = os.open(output / ".backup.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with TestClient(app) as client:
            admin = signed_in(client, "admin")
            rejected = client.post(URL, headers=headers(admin))
            assert rejected.status_code == 409, rejected.text
            assert error_code(rejected) == "BACKUP_IN_PROGRESS"
            assert not list(output.glob(".stage-*"))
            assert audit_rows(database) == []
            fcntl.flock(lock, fcntl.LOCK_UN)
            accepted = client.post(URL, headers=headers(admin))
            assert accepted.status_code == 202, accepted.text
            assert finished(client, admin).json()["current"]["state"] == "local_only"
    finally:
        os.close(lock)


def test_second_post_in_same_process_is_409(admin_case, monkeypatch):
    app, database, _output, _recipient = admin_case
    release = threading.Event()
    real = backup.backup_database

    def blocker(*args, **kwargs):
        assert release.wait(30)
        return real(*args, **kwargs)

    monkeypatch.setattr(backup, "backup_database", blocker)
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        try:
            first = client.post(URL, headers=headers(admin))
            assert first.status_code == 202, first.text
            second = client.post(URL, headers=headers(admin))
            assert second.status_code == 409, second.text
            assert error_code(second) == "BACKUP_IN_PROGRESS"
            current = client.get(URL, headers=headers(admin)).json()["current"]
            assert current == first.json()
        finally:
            release.set()
        assert finished(client, admin).json()["current"]["state"] == "local_only"
    assert [row[2] for row in audit_rows(database)] == [first.json()["run_id"]]


def test_access_control(admin_case):
    app, database, _output, _recipient = admin_case
    with TestClient(app) as client:
        assert error_code(client.get(URL)) == "VALIDATION_ERROR"  # headerless
        anonymous = Browser(client).prepare().anonymous()
        for method in (client.get, client.post):
            result = method(URL, headers=headers(anonymous))
            assert result.status_code == 401, result.text
            assert error_code(result) == "AUTH_REQUIRED"
        client.cookies.clear()
        member = signed_in(client, "approved")
        for method in (client.get, client.post):
            result = method(URL, headers=headers(member))
            assert result.status_code == 403, result.text
            assert error_code(result) == "FORBIDDEN"
        client.cookies.clear()
        admin = signed_in(client, "admin")
        valid = headers(admin)
        missing = {k: v for k, v in valid.items() if k != "X-CSRF-Token"}
        assert client.post(URL, headers=missing).status_code == 403
        untrusted = {**valid, "Origin": "https://untrusted.test"}
        assert client.post(URL, headers=untrusted).status_code == 403
        with_body = client.post(URL, headers=valid, content=b"{}")
        assert with_body.status_code == 422, with_body.text
        assert client.get(f"{URL}?x=1", headers=valid).status_code == 422
        app.state.auth_enabled = False
        for method in (client.get, client.post):
            result = method(URL, headers=valid)
            assert result.status_code == 503, result.text
            assert error_code(result) == "FEATURE_UNAVAILABLE"
    assert audit_rows(database) == []


def test_failed_run_is_failed_hidden_and_preserves_previous_pair_without_leaking(
    admin_case, capfd, caplog
):
    app, database, output, _recipient = admin_case
    case = (database, output, _recipient)
    previous = str(uuid4())
    assert run_backup(case, previous).returncode == 3
    before = fingerprints(output / previous)
    binary = database.parent / "age"
    binary.write_text(
        f"#!{sys.executable}\nimport sys\n"
        "if '--version' in sys.argv: print('v1.2.1')\n"
        f"else:\n    sys.stderr.write({SENTINEL!r})\n    sys.exit(1)\n"
    )
    bodies = []
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        created = client.post(URL, headers=headers(admin))
        assert created.status_code == 202, created.text
        run_id = created.json()["run_id"]
        listed = finished(client, admin)
        bodies += [created.text, listed.text]
    data = listed.json()
    assert data["current"]["state"] == "failed"
    assert [item["run_id"] for item in data["items"]] == [previous]
    assert audit_rows(database) == [("backup_create", ADMIN_ID, run_id, "failed")]
    assert before == fingerprints(output / previous)
    assert not list(output.glob(".stage-*"))
    assert run_id not in os.listdir(output)
    captured = capfd.readouterr()
    observed = [*bodies, captured.out, captured.err, caplog.text]
    observed.append(str(audit_rows(database)))
    assert all(SENTINEL not in text for text in observed)


def test_list_reads_manifest_only_and_counts_invalid_entries(admin_case):
    app, _database, output, _recipient = admin_case
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        created = client.post(URL, headers=headers(admin))
        assert created.status_code == 202, created.text
        run_id = created.json()["run_id"]
        assert finished(client, admin).json()["current"]["state"] == "local_only"
        ciphertext = output / run_id / "backup.tar.age"
        with open(ciphertext, "wb") as handle:
            handle.write(b"garbage-not-the-recorded-ciphertext")
        assert ciphertext.stat().st_mode & 0o777 == 0o600
        stray = output / str(uuid4())
        stray.mkdir(mode=0o700)
        (stray / "manifest.json").write_text("{}")
        (stray / "manifest.json").chmod(0o600)
        (output / "notes.txt").write_text("not a backup")
        listed = client.get(URL, headers=headers(admin)).json()
    assert [item["run_id"] for item in listed["items"]] == [run_id]
    assert listed["invalid_count"] == 2


def cli(case, command):
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", command, "--backup-dir", str(case[1])],
        env=environment(case),
        cwd=BACKEND,
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )
    counts = json.loads(result.stdout)["counts"] if command == "ops-check" else None
    return result.returncode, counts


def test_api_run_leaves_purge_and_ops_check_unchanged(admin_case):
    app, database, output, recipient = admin_case
    case = (database, output, recipient)
    purge_before, _ = cli(case, "purge-expired")
    ops_before, counts_before = cli(case, "ops-check")
    with TestClient(app) as client:
        admin = signed_in(client, "admin")
        assert client.post(URL, headers=headers(admin)).status_code == 202
        assert finished(client, admin).json()["current"]["state"] == "local_only"
    assert cli(case, "purge-expired")[0] == purge_before
    ops_after, counts_after = cli(case, "ops-check")
    assert ops_after == ops_before
    assert counts_after["backups_invalid"] == counts_before["backups_invalid"] == 0
    assert counts_after["backups_valid"] == counts_before["backups_valid"] + 1
