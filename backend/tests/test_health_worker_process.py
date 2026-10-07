"""OS process/lock/socket evidence; controlled probe, not production egress proof."""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from app import health_store as store
from app.database import make_engine, make_session_factory
from sqlalchemy import text

from tests.support import populate_public_and_private_apps


class ProcessHarness:
    def __init__(self, directory, database):
        self.database = database
        self.lock = directory / "worker.lock"
        self.control = directory / "control.sock"
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(str(self.control))
        self.server.listen(10)
        self.processes = []
        self.probes = []
        self.engine = make_engine(database)
        self.factory = make_session_factory(self.engine)

    def spawn(self):
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tests.health_worker_process",
                str(self.database),
                str(self.lock),
                str(self.control),
            ],
            cwd=Path(__file__).resolve().parents[1],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "APP_ENV": "test"},
        )
        self.processes.append(process)
        return process

    def accept(self, timeout=20):
        self.server.settimeout(timeout)
        connection, _ = self.server.accept()
        connection.settimeout(2)
        data = bytearray()
        while not data.endswith(b"\n"):
            chunk = connection.recv(1024)
            assert chunk, "Worker closed the probe before identifying its socket"
            data.extend(chunk)
        self.probes.append(connection)
        return connection, json.loads(data)

    def states(self):
        with self.factory() as db:
            return [
                dict(row)
                for row in db.execute(
                    text("SELECT * FROM health_jobs ORDER BY id")
                ).mappings()
            ]

    def admit(self, count):
        with self.factory() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            for index in range(1, count + 1):
                store.request_check(
                    db,
                    f"00000000-0000-4000-8000-{index:012d}",
                    f"actor:{index}",
                    None,
                    datetime.now(UTC),
                )
            db.commit()

    def close(self):
        for process in self.processes:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=10)
        for connection in self.probes:
            connection.close()
        self.server.close()
        self.engine.dispose()


@pytest.fixture
def harness(tmp_path, tmp_path_factory, migrate_test_database):
    template = tmp_path_factory.getbasetemp() / "worker-process-template.sqlite3"
    if not template.exists():
        migrate_test_database(template)
        populate_public_and_private_apps(template, public_count=3)
    database = tmp_path / "worker.sqlite3"
    shutil.copyfile(template, database)
    result = ProcessHarness(tmp_path, database)
    yield result
    result.close()


def wait_until(check, timeout=20):
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if value := check():
            return value
        time.sleep(0.05)
    raise AssertionError("Process state did not reach the expected boundary")


def test_sigterm_drains_three_original_deadlines_without_claiming_fourth(harness):
    harness.admit(4)
    worker = harness.spawn()
    probes = [harness.accept() for _ in range(3)]
    first_at = time.monotonic()
    assert {record["pid"] for _, record in probes} == {worker.pid}
    assert sorted(row["status"] for row in harness.states()) == [
        "queued",
        "running",
        "running",
        "running",
    ]
    with pytest.raises(TimeoutError):
        harness.accept(timeout=0.3)
    time.sleep(1)
    stopped_at = time.monotonic()
    worker.terminate()
    stdout, stderr = worker.communicate(timeout=15)
    assert worker.returncode == 0, (stdout, stderr)
    assert time.monotonic() - stopped_at < 15
    assert 8 <= time.monotonic() - first_at < 12
    for connection, _ in probes:
        assert connection.recv(1) == b""
    states = harness.states()
    assert sorted(row["status"] for row in states) == [
        "completed",
        "completed",
        "completed",
        "queued",
    ]
    assert sum(row["attempts"] for row in states) == 3


def test_second_worker_process_is_rejected_before_probe_or_registration(harness):
    harness.admit(1)
    first = harness.spawn()
    connection, record = harness.accept()
    assert record["pid"] == first.pid
    with harness.factory() as db:
        original = store.current_worker(db)["worker_id"]
    second = harness.spawn()
    _, stderr = second.communicate(timeout=15)
    assert second.returncode != 0
    assert b"already running" in stderr
    with harness.factory() as db:
        assert store.current_worker(db)["worker_id"] == original
    with pytest.raises(TimeoutError):
        harness.accept(timeout=0.2)
    connection.sendall(b"complete\n")
    wait_until(lambda: harness.states()[0]["status"] == "completed")
    first.terminate()
    first.communicate(timeout=15)
    assert first.returncode == 0


def test_sigkill_wait_then_restart_obeys_real_cooldown_and_same_job_attempt_limit(
    harness,
):
    harness.admit(1)
    first = harness.spawn()
    connection, _ = harness.accept()
    initial = harness.states()[0]
    first.kill()
    assert first.wait(timeout=10) == -signal.SIGKILL
    assert connection.recv(1) == b""
    second = harness.spawn()
    wait_until(lambda: harness.states()[0]["status"] == "queued")
    with pytest.raises(TimeoutError):
        harness.accept(timeout=0.5)
    recovering = harness.states()[0]
    assert recovering["id"] == initial["id"] and recovering["attempts"] == 1
    second_connection, second_record = harness.accept(timeout=65)
    assert second_record["pid"] == second.pid
    retried = harness.states()[0]
    assert retried["id"] == initial["id"] and retried["attempts"] == 2
    assert retried["started_at"] == initial["started_at"]
    with harness.factory() as db:
        started = db.execute(
            text("SELECT started_at FROM health_cooldowns")
        ).scalar_one()
    assert (
        datetime.fromisoformat(started) - datetime.fromisoformat(initial["started_at"])
    ).total_seconds() >= 60
    second.kill()
    second.wait(timeout=10)
    assert second_connection.recv(1) == b""
    third = harness.spawn()
    wait_until(lambda: harness.states()[0]["status"] == "failed")
    assert harness.states()[0]["failure_code"] == "WORKER_RECOVERY_EXHAUSTED"
    with pytest.raises(TimeoutError):
        harness.accept(timeout=0.3)
    third.terminate()
    third.communicate(timeout=15)
    assert third.returncode == 0


def test_explicit_disable_closes_each_probe_cancels_queue_and_preserves_last_result(
    harness,
):
    checked = "2026-10-01T00:00:00.000000Z"
    with harness.factory() as db:
        db.execute(
            text(
                "UPDATE health_results SET state='healthy',checked_at=:checked,fresh_until='2026-10-01T00:15:00.000000Z'"
            ),
            {"checked": checked},
        )
        db.commit()
    harness.admit(4)
    worker = harness.spawn()
    probes = [harness.accept() for _ in range(3)]
    worker.send_signal(signal.SIGUSR1)
    stdout, stderr = worker.communicate(timeout=10)
    assert worker.returncode == 0, (stdout, stderr)
    assert {row["status"] for row in harness.states()} == {"cancelled"}
    for connection, _ in probes:
        assert connection.recv(1) == b""
    with harness.factory() as db:
        result = store.snapshot(
            db, "00000000-0000-4000-8000-000000000001", datetime.now(UTC)
        )
    assert result["health"]["result"]["checked_at"] == checked
    assert result["health"]["result"]["state"] == "healthy"


def test_expired_lease_recovers_only_after_socket_cleanup_and_stops_at_two_attempts(
    harness,
):
    from app.health_runtime import boot_clock

    checked = "2026-10-01T00:00:00.000000Z"
    with harness.factory() as db:
        db.execute(
            text(
                "UPDATE health_results SET state='healthy',checked_at=:checked,fresh_until='2026-10-01T00:15:00.000000Z'"
            ),
            {"checked": checked},
        )
        db.commit()
    harness.admit(1)
    worker = harness.spawn()
    first_socket, _ = harness.accept()
    original = harness.states()[0]
    with harness.factory() as db:
        db.execute(
            text("UPDATE health_jobs SET lease_deadline=0 WHERE id=:id"),
            {"id": original["id"]},
        )
        db.commit()
    # Observe this execution's real socket EOF, not just task.cancel() or a flag.
    assert first_socket.recv(1) == b""
    wait_until(lambda: harness.states()[0]["status"] == "queued", timeout=5)
    recovered = harness.states()[0]
    assert recovered["id"] == original["id"]
    assert recovered["attempts"] == 1
    with harness.factory() as db:
        boot, mono = boot_clock()
        assert store.availability(db, boot_id=boot, mono=mono)
        result = store.snapshot(db, original["app_id"], datetime.now(UTC))
    assert result["health"]["result"]["checked_at"] == checked
    with pytest.raises(TimeoutError):
        harness.accept(timeout=0.2)
    # The real cooldown boundary has its own process test. Move this fixture's
    # cooldown past due so this test isolates lease recovery, not 60-second waits.
    with harness.factory() as db:
        db.execute(
            text(
                "UPDATE health_cooldowns SET next_check_at='2000-01-01T00:00:00.000000Z'"
            )
        )
        db.commit()
    second_socket, record = harness.accept(timeout=5)
    assert record["pid"] == worker.pid
    second = harness.states()[0]
    assert second["id"] == original["id"]
    assert second["attempts"] == 2
    assert second["started_at"] == original["started_at"]
    with harness.factory() as db:
        db.execute(
            text("UPDATE health_jobs SET lease_deadline=0 WHERE id=:id"),
            {"id": original["id"]},
        )
        db.commit()
    assert second_socket.recv(1) == b""
    wait_until(lambda: harness.states()[0]["status"] == "failed", timeout=5)
    assert harness.states()[0]["failure_code"] == "WORKER_RECOVERY_EXHAUSTED"
    with harness.factory() as db:
        result = store.snapshot(db, original["app_id"], datetime.now(UTC))
    assert result["health"]["result"]["checked_at"] == checked
    assert result["health"]["result"]["state"] == "healthy"
    with pytest.raises(TimeoutError):
        harness.accept(timeout=0.2)
    worker.terminate()
    worker.communicate(timeout=15)
    assert worker.returncode == 0
