"""Socket/process isolation and mandatory real-age recovery in CI."""

import signal
import subprocess
import sys
from pathlib import Path

import pytest

from tests.auth_process import AuthProcess
from tests.test_backup import backup_case, environment, run_backup  # noqa: F401
from tests.test_backup_process import real_age_case, wait_file  # noqa: F401
from tests.test_restore import restore_case, run_restore  # noqa: F401


@pytest.mark.parametrize("incomplete", [False, True])
def test_restored_target_blocks_public_and_protected_api_across_restart(
    restore_case,  # noqa: F811
    password_blocklist,
    incomplete,
):
    target = restore_case[3]
    if incomplete:
        (target.parent / ".restore-blocked").write_bytes(b"malformed")
    else:
        assert run_restore(restore_case).returncode == 3
    server = AuthProcess(target, password_blocklist)
    try:
        for _ in range(2):
            server.start()
            with server.client() as client:
                assert client.get("/healthz").status_code == 200
                assert client.get("/readyz").status_code == 503
                for endpoint in (
                    "apps",
                    "apps/absent",
                    "apps/facets",
                    "meta",
                    "auth/state",
                    "auth/me",
                    "admin/users",
                    "admin/apps",
                    "health",
                    "write-operations/old",
                ):
                    response = client.get("/api/v1/" + endpoint)
                    assert response.status_code == 503
                    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
                for endpoint in (
                    "auth/login",
                    "auth/prepare",
                    "apps",
                    "write-operations",
                    "health/check",
                ):
                    assert (
                        client.post("/api/v1/" + endpoint, json={}).status_code == 503
                    )
            server.kill()
        server.start()
        (target.parent / ".restore-blocked").unlink()
        with server.client() as client:
            assert client.get("/api/v1/apps").status_code == 503
            assert client.get("/readyz").status_code == 503
    finally:
        server.close()


@pytest.mark.requires_age
def test_real_age_restore_and_verify_round_trip(real_age_case):  # noqa: F811
    source, identity = real_age_case
    assert run_backup(source).returncode == 3
    artifact = next(p for p in source[1].iterdir() if p.is_dir())
    directory = source[0].parent / "isolated"
    directory.mkdir(mode=0o700)
    case = source, artifact, identity, directory / "restored.sqlite3"
    assert run_restore(case).returncode == 3
    assert run_restore(case, "verify-restore").returncode == 3


@pytest.mark.requires_age
@pytest.mark.parametrize("fault", ["wrong", "missing", "truncated"])
def test_real_age_wrong_missing_identity_and_truncation(real_age_case, fault):  # noqa: F811
    source, identity = real_age_case
    assert run_backup(source).returncode == 3
    artifact = next(p for p in source[1].iterdir() if p.is_dir())
    directory = source[0].parent / "isolated"
    directory.mkdir(mode=0o700)
    if fault == "missing":
        identity.unlink()
    elif fault == "wrong":
        with identity.open("wb") as output:
            subprocess.run(
                ["age-keygen"], stdout=output, stderr=subprocess.DEVNULL, check=True
            )
    else:
        ciphertext = artifact / "backup.tar.age"
        ciphertext.write_bytes(ciphertext.read_bytes()[:-100])
    case = source, artifact, identity, directory / "restored.sqlite3"
    assert run_restore(case).returncode == 1
    assert not (directory / "restore-receipt.json").exists()


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM, signal.SIGKILL])
@pytest.mark.parametrize(
    "barrier", ["decrypt", "import", "migration", "reconcile", "receipt"]
)
def test_restore_signal_or_kill_never_publishes_readiness(
    restore_case,  # noqa: F811
    signum,
    barrier,
):
    source, artifact, identity, target = restore_case
    ready = target.parent.parent / "ready"
    script = f"""
import os, sys, time, sqlite3
from pathlib import Path
import app.restore as restore
sys.argv = ['restore-db', '--backup-dir', {str(artifact)!r}, '--identity-file', {str(identity)!r}, '--ledger-file', {str(source[0].with_suffix(".deletions.sqlite3"))!r}]
def gate(*args, **kwargs):
    Path({str(ready)!r}).touch()
    while True: time.sleep(.01)
"""
    if barrier == "decrypt":
        script += "restore._decrypt = gate\n"
    elif barrier == "import":
        script += "restore._authorize = gate\n"
    elif barrier == "migration":
        # Authentic older metadata/dump is supplied by the companion migration test.
        from tests.test_backup import unpack
        from tests.test_restore import replace_artifact

        _, _, dump = unpack(source, artifact.name)
        replace_artifact(
            restore_case,
            sql=dump.decode().replace("0012_health_checks", "0011_user_delete"),
            mutate=lambda m, inner: (
                m.update(revision="0011_user_delete"),
                inner.update(revision="0011_user_delete"),
            ),
        )
        script += "restore.subprocess.run = gate\n"
    elif barrier == "reconcile":
        script += "restore.reconcile = gate\n"
    else:
        script += "restore.os.rename = gate\n"
    script += "raise SystemExit(restore.main('restore-db', sys.argv[1:]))\n"
    process = subprocess.Popen(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        env={**environment(source), "DATABASE_PATH": str(target)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        wait_file(ready)
        process.send_signal(signum)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == (
            -signum if signum == signal.SIGKILL else 128 + signum
        )
        assert not stdout
        if signum != signal.SIGKILL:
            assert stderr.strip() == b"RESTORE_INTERRUPTED"
        assert (target.parent / ".restore-blocked").exists()
        assert not (target.parent / "restore-receipt.json").exists()
        assert run_restore(restore_case).returncode == 2
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)
