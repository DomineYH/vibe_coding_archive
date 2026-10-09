"""Actual CLI/API processes; only requires_age cases prove encryption."""

import hashlib
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

import pytest

from app.backup import validate_manifest
from tests.app_create_client import INPUT
from tests.app_update_client import detail, registered, update, update_key
from tests.auth_client import signed_in
from tests.test_backup import (  # noqa: F401
    BACKEND,
    backup_case,
    command,
    environment,
    rows,
    run_backup,
    unpack,
)


def fingerprints(directory):
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()
    }


def wait_file(path):
    deadline = time.monotonic() + 30
    while not path.exists():
        if time.monotonic() >= deadline:
            raise AssertionError("backup process did not reach private barrier")
        time.sleep(0.01)


@contextmanager
def running(case, run_id, barrier=None):
    args = command(case, run_id)
    if barrier:
        ready, release = case[1] / ".ready", case[1] / ".release"
        ready.unlink(missing_ok=True)
        release.unlink(missing_ok=True)
        gate = f"""
def gate():
    Path({str(ready)!r}).write_text('ready')
    deadline = time.monotonic() + 90
    while not Path({str(release)!r}).exists():
        if time.monotonic() > deadline: raise TimeoutError()
        time.sleep(0.01)
"""
        script = (
            "import os,runpy,sys,time,sqlite3\nfrom pathlib import Path\nimport app.backup\n"
            + gate
        )
        if barrier == "snapshot":
            script += """
original_connect = sqlite3.connect
class Connection(sqlite3.Connection):
    def backup(self, target, **kwargs):
        gate()
        return super().backup(target, **kwargs)
def connect(*args, **kwargs):
    return original_connect(*args, factory=Connection, **kwargs)
sqlite3.connect = connect
"""
        elif barrier == "encryption":
            script += f"""
original_popen = app.backup.subprocess.Popen
def popen(*args, **kwargs):
    child = original_popen(*args, **kwargs)
    if '--encrypt' in args[0]: Path({str(case[1] / ".child.pid")!r}).write_text(str(child.pid))
    return child
app.backup.subprocess.Popen = popen
original_write = app.backup._Pipe.write
def write(self, data):
    gate()
    return original_write(self, data)
app.backup._Pipe.write = write
"""
        else:
            script += """
original_fsync = os.fsync
calls = 0
def fsync(fd):
    global calls
    calls += 1
    if calls == 3: gate()
    return original_fsync(fd)
os.fsync = fsync
"""
        script += "sys.argv = ['app.cli', *sys.argv[1:]]\nrunpy.run_module('app.cli', run_name='__main__')\n"
        args = [sys.executable, "-c", script, *args[3:]]
    process = subprocess.Popen(
        args,
        cwd=BACKEND,
        env=environment(case),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        yield process
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)
        if barrier:
            ready.unlink(missing_ok=True)
            release.unlink(missing_ok=True)
            (case[1] / ".child.pid").unlink(missing_ok=True)


@pytest.fixture
def real_age_case(backup_case, monkeypatch):  # noqa: F811
    # Ignore the controlled encryptor's private PATH entry, including in CI.
    monkeypatch.setenv("PATH", os.defpath)
    identity = backup_case[0].parent / "identity.txt"
    with identity.open("xb") as output:
        identity.chmod(0o600)
        subprocess.run(
            ["age-keygen"],
            stdout=output,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=5,
        )
    public = subprocess.run(
        ["age-keygen", "-y", str(identity)], capture_output=True, check=True, timeout=5
    ).stdout
    backup_case[2].write_bytes(public)
    return backup_case, identity


def decrypt(case, identity, run_id, raw=None):
    ciphertext = (
        (case[1] / run_id / "backup.tar.age").read_bytes() if raw is None else raw
    )
    return subprocess.run(
        ["age", "--decrypt", "--identity", str(identity)],
        input=ciphertext,
        capture_output=True,
        check=False,
        timeout=10,
    )


def api_round_trip(case, process_server, decrypt_payload):
    server, database = process_server
    database.chmod(0o600)
    case = database, case[1], case[2]
    with closing(sqlite3.connect(database)) as keeper, server.client() as client:
        keeper.execute("PRAGMA journal_mode=WAL")
        keeper.execute("PRAGMA wal_autocheckpoint=0")
        disk_hash = hashlib.sha256(database.read_bytes()).hexdigest()
        owner = signed_in(client)
        public = registered(
            owner,
            {
                **INPUT,
                "prompt": "exact raw prompt\n  두 번째 줄  ",
                "grades": ["초2", "중1"],
            },
        )
        private = registered(
            owner,
            {
                **INPUT,
                "name": "private test app",
                "is_public": False,
                "prompt": "private raw prompt",
            },
        )
        assert hashlib.sha256(database.read_bytes()).hexdigest() == disk_hash
        assert database.with_name(database.name + "-wal").stat().st_size > 0
        run_id = str(uuid4())
        with running(case, run_id, "snapshot") as process:
            wait_file(case[1] / ".ready")
            with closing(sqlite3.connect(database)) as source:
                expected = rows(source)
            patch = {
                "prompt": "writer committed after snapshot",
                "grades": ["초1"],
                "is_public": False,
            }
            key = update_key(owner, public["id"], patch)
            assert update(owner, public["id"], key, patch).status_code == 200
            assert detail(owner, public["id"]).json()["item"]["version"] == 2
            (case[1] / ".release").touch()
            stdout, stderr = process.communicate(timeout=30)
            assert process.returncode == 3, stderr.decode()
            assert stdout.strip() == b"LOCAL_ONLY_REMOTE_NOT_CONFIRMED"
        payload = decrypt_payload(case, run_id)
        manifest, metadata, dump = unpack(case, run_id, payload=payload)
        validate_manifest(manifest, metadata=metadata)
        with closing(sqlite3.connect(":memory:")) as restored:
            restored.executescript(dump.decode("utf-8"))
            assert restored.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
            assert restored.execute("PRAGMA foreign_key_check").fetchall() == []
            equal = rows(restored) == expected
            assert equal, "restored tables differ from fixed source snapshot"
            assert restored.execute(
                "SELECT version,is_public,prompt FROM apps WHERE id=?", (public["id"],)
            ).fetchone() == (1, 1, "exact raw prompt\n  두 번째 줄  ")
            assert restored.execute(
                "SELECT is_public FROM apps WHERE id=?", (private["id"],)
            ).fetchone() == (0,)
        assert client.get("/healthz").status_code == 200
        assert detail(owner, public["id"]).json()["item"]["version"] == 2
        with sqlite3.connect(database) as db:
            db.execute("DELETE FROM rate_limit_events")


def test_protocol_dump_round_trip_during_api_writes(backup_case, process_server):  # noqa: F811
    api_round_trip(
        backup_case,
        process_server,
        lambda case, run_id: (case[1] / run_id / "backup.tar.age").read_bytes(),
    )


@pytest.mark.requires_age
def test_age_round_trip_during_api_writes(real_age_case, process_server):
    case, identity = real_age_case

    def payload(case, run_id):
        result = decrypt(case, identity, run_id)
        assert result.returncode == 0, "age decryption failed"
        return result.stdout

    api_round_trip(case, process_server, payload)


@pytest.mark.requires_age
def test_age_rejects_ciphertext_and_manifest_tampering(real_age_case):
    case, identity = real_age_case
    run_id = str(uuid4())
    assert run_backup(case, run_id).returncode == 3
    before = fingerprints(case[1] / run_id)
    raw = (case[1] / run_id / "backup.tar.age").read_bytes()
    for tampered in (
        raw[:-10],
        raw[: len(raw) // 2]
        + bytes([raw[len(raw) // 2] ^ 1])
        + raw[len(raw) // 2 + 1 :],
    ):
        assert decrypt(case, identity, run_id, tampered).returncode != 0
    decrypted = decrypt(case, identity, run_id)
    assert decrypted.returncode == 0
    value, inner, _ = unpack(case, run_id, payload=decrypted.stdout)
    for field, replacement in [
        ("release_id", "forged-build"),
        ("database", {"sha256": "0" * 64, "bytes": value["database"]["bytes"]}),
        ("original_expires_at", "2099-01-01T00:00:00Z"),
    ]:
        altered = {
            **value,
            field: replacement,
            "ciphertext": {
                "sha256": hashlib.sha256(raw).hexdigest(),
                "bytes": len(raw),
            },
        }
        with pytest.raises(ValueError, match="BACKUP_MANIFEST_INVALID"):
            validate_manifest(altered, metadata=inner)
    assert fingerprints(case[1] / run_id) == before


@pytest.mark.requires_age
def test_age_keys_missing_or_wrong_fail_closed(real_age_case):
    case, identity = real_age_case
    run_id = str(uuid4())
    assert run_backup(case, run_id).returncode == 3
    before = fingerprints(case[1] / run_id)
    case[2].unlink()
    assert run_backup(case).returncode != 3
    assert decrypt(case, identity.with_name("missing.identity"), run_id).returncode != 0
    wrong = identity.with_name("wrong.identity")
    with wrong.open("xb") as output:
        wrong.chmod(0o600)
        subprocess.run(
            ["age-keygen"],
            stdout=output,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=5,
        )
    assert decrypt(case, wrong, run_id).returncode != 0
    assert fingerprints(case[1] / run_id) == before


@pytest.mark.parametrize("same_run", [True, False])
def test_backup_duplicate_process_and_run_are_rejected(backup_case, same_run):  # noqa: F811
    previous = str(uuid4())
    assert run_backup(backup_case, previous).returncode == 3
    inode = (backup_case[1] / ".backup.lock").stat().st_ino
    before = fingerprints(backup_case[1] / previous)
    run_id = str(uuid4())
    with running(backup_case, run_id, "snapshot") as first:
        wait_file(backup_case[1] / ".ready")
        result = run_backup(backup_case, run_id if same_run else str(uuid4()))
        assert result.returncode == 1
        assert result.stderr.strip() == "BACKUP_FAILED"
        first.kill()
        first.communicate(timeout=5)
    assert run_backup(backup_case, run_id).returncode == 3
    assert run_backup(backup_case, run_id).returncode == 1
    assert (backup_case[1] / ".backup.lock").stat().st_ino == inode
    assert fingerprints(backup_case[1] / previous) == before


@pytest.mark.parametrize("barrier", ["snapshot", "encryption", "publication"])
@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM, signal.SIGKILL])
def test_backup_interrupts_preserve_previous_run(backup_case, barrier, signum):  # noqa: F811
    previous, run_id = str(uuid4()), str(uuid4())
    assert run_backup(backup_case, previous).returncode == 3
    before = fingerprints(backup_case[1] / previous)
    with running(backup_case, run_id, barrier) as process:
        wait_file(backup_case[1] / ".ready")
        process.send_signal(signum)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == (
            -signal.SIGKILL if signum == signal.SIGKILL else 128 + signum
        )
        assert not stdout
        if signum != signal.SIGKILL:
            assert stderr.strip() == b"BACKUP_INTERRUPTED"
            assert not list(backup_case[1].glob(".stage-*"))
            child_pid = backup_case[1] / ".child.pid"
            if child_pid.exists():
                assert not Path("/proc", child_pid.read_text()).exists()
        assert not (backup_case[1] / run_id).exists()
    assert fingerprints(backup_case[1] / previous) == before
    for stage in backup_case[1].glob(".stage-*"):
        assert stage.stat().st_mode & 0o777 == 0o700
        assert {p.name for p in stage.iterdir()} <= {"backup.tar.age", "manifest.json"}
    assert (
        run_backup(backup_case).returncode == 3
    )  # Dead holder released persistent flock.


@pytest.mark.requires_age
def test_remote_confirmation_is_never_inferred(real_age_case):
    case, _ = real_age_case
    run_id = str(uuid4())
    assert run_backup(case, run_id).returncode == 3
    manifest = json.loads((case[1] / run_id / "manifest.json").read_bytes())
    assert manifest["remote_confirmed"] is False
    assert run_backup(case, str(uuid4()), "--remote-confirmed").returncode == 2
