"""Restore CLI contract. Pass-through age fixture proves protocol only."""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from tests.test_backup import (  # noqa: F401
    BACKEND,
    backup_case,
    environment,
    fingerprints,
    rows,
    run_backup,
)
from tests.test_backup_process import real_age_case  # noqa: F401


@pytest.fixture
def restore_case(backup_case):  # noqa: F811
    result = run_backup(backup_case)
    assert result.returncode == 3, result.stderr
    artifact = next(p for p in backup_case[1].iterdir() if p.is_dir())
    identity = backup_case[0].parent / "identity.txt"
    # Synthetic native-format key: zero payload plus Bech32 checksum.
    alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    hrp = "age-secret-key-"
    values = [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]
    checksum = 1
    for value in values + [0] * 58:
        top = checksum >> 25
        checksum = ((checksum & 0x1FFFFFF) << 5) ^ value
        for i, generator in enumerate(
            (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
        ):
            if top >> i & 1:
                checksum ^= generator
    checksum ^= 1
    tail = "".join(alphabet[(checksum >> (5 * (5 - i))) & 31] for i in range(6))
    identity.write_text((hrp + "1" + "q" * 52 + tail).upper() + "\n")
    identity.chmod(0o600)
    target = backup_case[0].parent / "isolated"
    target.mkdir(mode=0o700)
    return backup_case, artifact, identity, target / "restored.sqlite3"


def run_restore(case, command="restore-db", *, env=None, extra=()):
    source, artifact, identity, target = case
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "app.cli",
            command,
            "--backup-dir",
            str(artifact),
            "--identity-file",
            str(identity),
            "--ledger-file",
            str(source[0].with_suffix(".deletions.sqlite3")),
            *extra,
        ],
        cwd=BACKEND,
        env={**environment(source), "DATABASE_PATH": str(target), **(env or {})},
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )


def test_restore_cli_creates_only_fresh_blocked_target(restore_case):
    source, artifact, _, target = restore_case
    before = {
        p: p.read_bytes()
        for p in (source[0], source[0].with_suffix(".deletions.sqlite3"))
    }
    result = run_restore(restore_case)
    assert result.returncode == 3, result.stderr
    assert result.stdout.strip() == "RESTORE_VERIFIED_LOCAL_ONLY_MAINTENANCE_REQUIRED"
    receipt = json.loads((target.parent / "restore-receipt.json").read_bytes())
    manifest = json.loads((artifact / "manifest.json").read_bytes())
    assert receipt["original_expires_at"] == manifest["original_expires_at"]
    assert receipt["authority_status"] == "CURRENT_AUTHORITY_UNPROVEN"
    assert (target.parent / ".restore-blocked").stat().st_mode & 0o777 == 0o600
    assert target.stat().st_mode & 0o777 == 0o600
    with sqlite3.connect(source[0]) as original, sqlite3.connect(target) as restored:
        for table in ("members", "apps", "app_grades", "health_results"):
            assert rows(original)[table] == rows(restored)[table]
        assert restored.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert restored.execute("PRAGMA foreign_key_check").fetchall() == []
    assert all(p.read_bytes() == raw for p, raw in before.items())
    target_before = fingerprints(target.parent)
    assert run_restore(restore_case, "verify-restore").returncode == 3
    assert fingerprints(target.parent) == target_before
    assert run_restore(restore_case).returncode == 2


@pytest.mark.parametrize(
    "fault",
    [
        "development",
        "production",
        "health",
        "missing_origin",
        "existing",
        "wal",
        "ledger",
        "marker",
        "receipt",
        "target_mode",
        "identity_mode",
        "identity_symlink",
        "identity_hardlink",
        "target_symlink",
        "identity_plugin",
        "unknown_flag",
    ],
)
def test_restore_refuses_environment_existing_target_and_aliases(restore_case, fault):
    _, _, identity, target = restore_case
    env, extra = {}, ()
    if fault in {"development", "production"}:
        env["APP_ENV"] = fault
    elif fault == "health":
        env["HEALTH_CHECKS_ENABLED"] = "true"
    elif fault == "missing_origin":
        env["PUBLIC_ORIGIN"] = ""
    elif fault in {"existing", "wal", "ledger", "marker", "receipt"}:
        file = {
            "existing": target,
            "wal": Path(str(target) + "-wal"),
            "ledger": target.with_suffix(".deletions.sqlite3"),
            "marker": target.parent / ".restore-blocked",
            "receipt": target.parent / "restore-receipt.json",
        }[fault]
        file.write_bytes(b"DO_NOT_OVERWRITE")
    elif fault == "target_mode":
        target.parent.chmod(0o755)
    elif fault == "identity_mode":
        identity.chmod(0o644)
    elif fault == "identity_symlink":
        original = identity.with_suffix(".original")
        identity.rename(original)
        identity.symlink_to(original)
    elif fault == "identity_hardlink":
        os.link(identity, identity.with_suffix(".link"))
    elif fault == "target_symlink":
        original = target.parent.with_name("original")
        target.parent.rename(original)
        target.parent.symlink_to(original, target_is_directory=True)
    elif fault == "identity_plugin":
        identity.write_text("AGE-PLUGIN-SECRET_TEST_SENTINEL!\n")
    else:
        extra = ("--SECRET_TEST_SENTINEL!",)
    before = {p: p.read_bytes() for p in target.parent.iterdir()}
    result = run_restore(restore_case, env=env, extra=extra)
    assert result.returncode in {1, 2}
    assert "SECRET_TEST_SENTINEL!" not in result.stdout + result.stderr
    assert {p: p.read_bytes() for p in target.parent.iterdir()} == before


def replace_artifact(case, *, sql=None, mutate=None, members=None):
    import hashlib
    import io
    import tarfile

    from app.backup import CORE
    from tests.test_backup import unpack

    source, artifact, _, _ = case
    manifest, metadata, dump = unpack(source, artifact.name)
    if sql is not None:
        dump = sql.encode()
        manifest["database"] = {
            "bytes": len(dump),
            "sha256": hashlib.sha256(dump).hexdigest(),
        }
        metadata["database"] = manifest["database"]
    if mutate:
        mutate(manifest, metadata)
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as tar:
        for name, raw, type_ in members or [
            ("database.sql", dump, tarfile.REGTYPE),
            ("metadata.json", json.dumps(metadata).encode(), tarfile.REGTYPE),
        ]:
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.type = len(raw), 0o600, type_
            tar.addfile(info, io.BytesIO(raw))
    raw = data.getvalue()
    manifest["ciphertext"] = {
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    assert set(metadata) == CORE
    (artifact / "backup.tar.age").write_bytes(raw)
    (artifact / "manifest.json").write_text(json.dumps(manifest))


@pytest.mark.parametrize(
    "fault",
    [
        "ciphertext",
        "inner",
        "expiry",
        "dump_hash",
        "traversal",
        "duplicate",
        "extra",
        "symlink",
        "attach",
        "extension",
        "writable_schema",
        "vacuum",
        "future_revision",
        "missing_revision",
    ],
)
def test_restore_rejects_untrusted_artifact_before_sql(restore_case, fault):
    import tarfile

    from tests.test_backup import unpack

    source, artifact, _, target = restore_case
    _, _, dump = unpack(source, artifact.name)
    if fault == "ciphertext":
        file = artifact / "backup.tar.age"
        file.write_bytes(file.read_bytes()[:-100])
    elif fault in {"inner", "expiry", "dump_hash"}:

        def mutate(manifest, metadata):
            if fault == "inner":
                manifest["release_id"] = "untrusted-edit"
            elif fault == "expiry":
                manifest["created_at"] = "2000-01-01T00:00:00Z"
                manifest["original_expires_at"] = "2000-01-31T00:00:00Z"
            else:
                manifest["database"]["sha256"] = "a" * 64

        replace_artifact(restore_case, mutate=mutate)
    elif fault in {"traversal", "duplicate", "extra", "symlink"}:
        names = {
            "traversal": "../escape",
            "duplicate": "database.sql",
            "extra": "extra",
            "symlink": "metadata.json",
        }
        members = [
            ("database.sql", dump, tarfile.REGTYPE),
            (
                names[fault],
                b"{}",
                tarfile.SYMTYPE if fault == "symlink" else tarfile.REGTYPE,
            ),
        ]
        replace_artifact(restore_case, members=members)
    else:
        escape = target.parent.parent / "escape.sqlite3"
        statement = {
            "attach": f"ATTACH DATABASE '{escape}' AS escape;",
            "extension": "SELECT load_extension('SECRET_TEST_SENTINEL!');",
            "writable_schema": "PRAGMA writable_schema=ON;",
            "vacuum": f"VACUUM INTO '{escape}';",
            "future_revision": "UPDATE alembic_version SET version_num='9999_future';",
            "missing_revision": "DELETE FROM alembic_version;",
        }[fault]
        replace_artifact(restore_case, sql=dump.decode() + statement)
    result = run_restore(restore_case)
    assert result.returncode == 1, result.stderr
    assert result.stderr.strip() == "RESTORE_FAILED"
    assert (target.parent / ".restore-blocked").exists()
    assert not (target.parent / "restore-receipt.json").exists()
    assert not (target.parent.parent / "escape.sqlite3").exists()
    assert run_restore(restore_case).returncode == 2


@pytest.mark.parametrize(
    "fault", ["missing", "corrupt", "table", "partial_group", "conflict"]
)
def test_restore_latest_ledger_preflight_never_repairs_source(restore_case, fault):
    from uuid import uuid4

    from app.user_deletion_ledger import FIELDS, new_group

    source, _, _, target = restore_case
    ledger_path = source[0].with_suffix(".deletions.sqlite3")
    if fault == "missing":
        ledger_path.unlink()
    elif fault == "corrupt":
        ledger_path.write_bytes(b"SECRET_TEST_SENTINEL!")
    else:
        with sqlite3.connect(ledger_path) as ledger:
            if fault == "table":
                ledger.execute("DROP TABLE completed_deletions")
            elif fault == "partial_group":
                group = new_group(str(uuid4()), [str(uuid4())], "2026-10-08T00:00:00Z")
                ledger.execute(
                    "INSERT INTO completed_user_delete_events VALUES ("
                    + ",".join("?" for _ in FIELDS)
                    + ")",
                    tuple(group[0][f] for f in FIELDS),
                )
            else:
                from tests.test_backup import unpack

                event, app_id = str(uuid4()), str(uuid4())
                _, _, dump = unpack(source, restore_case[1].name)
                replace_artifact(
                    restore_case,
                    sql=dump.decode()
                    + f"INSERT INTO app_delete_outbox VALUES ('{event}','{app_id}','interactive_app_delete','2026-10-07T00:00:00Z','2026-10-07T00:00:00Z');",
                )
                ledger.execute(
                    "INSERT INTO completed_app_delete_events VALUES (?,?,'interactive_app_delete','2026-10-08T00:00:00Z')",
                    (event, app_id),
                )

    before = ledger_path.read_bytes() if ledger_path.exists() else None
    result = run_restore(restore_case)
    assert result.returncode == 1
    assert (ledger_path.read_bytes() if ledger_path.exists() else None) == before
    assert not (target.parent / "restore-receipt.json").exists()


@pytest.mark.parametrize(
    "fault", ["receipt", "credentials", "ledger", "new_evidence", "marker"]
)
def test_verify_restore_is_read_only_and_never_unblocks(restore_case, fault):
    from uuid import uuid4

    assert run_restore(restore_case).returncode == 3
    source, _, _, target = restore_case
    if fault == "receipt":
        file = target.parent / "restore-receipt.json"
        value = json.loads(file.read_bytes())
        value["original_expires_at"] = "2099-01-01T00:00:00Z"
        file.write_text(json.dumps(value))
    elif fault == "credentials":
        with sqlite3.connect(target) as db:
            db.execute("UPDATE members SET password_hash='SECRET_TEST_SENTINEL!'")
    elif fault in {"ledger", "new_evidence"}:
        path = target if fault == "ledger" else source[0]
        with sqlite3.connect(path.with_suffix(".deletions.sqlite3")) as db:
            db.execute(
                "INSERT INTO completed_app_delete_events VALUES (?,?,'interactive_app_delete','2026-10-08T00:00:00Z')",
                (str(uuid4()), str(uuid4())),
            )
    else:
        (target.parent / ".restore-blocked").unlink()
    before = fingerprints(target.parent)
    result = run_restore(restore_case, "verify-restore")
    assert result.returncode == 1
    assert result.stderr.strip() == "RESTORE_FAILED"
    assert fingerprints(target.parent) == before


def test_restore_sweeps_newly_expired_pending_on_replica_only(restore_case):
    from datetime import UTC, datetime, timedelta
    from uuid import uuid4

    from tests.support import AUTH_MEMBERS, populate_auth_members

    source, _, identity, target = restore_case
    populate_auth_members(source[0])
    pending = AUTH_MEMBERS["pending"][0]
    with sqlite3.connect(source[0]) as db:
        db.execute(
            "UPDATE members SET created_at=? WHERE id=?",
            ((datetime.now(UTC) - timedelta(days=91)).isoformat(), pending),
        )
    run_id = str(uuid4())
    assert run_backup(source, run_id).returncode == 3
    case = source, source[1] / run_id, identity, target
    original_ledger = source[0].with_suffix(".deletions.sqlite3").read_bytes()
    result = run_restore(case)
    assert result.returncode == 3, result.stderr
    with sqlite3.connect(target) as db:
        assert (
            db.execute("SELECT id FROM members WHERE id=?", (pending,)).fetchall() == []
        )
    assert source[0].with_suffix(".deletions.sqlite3").read_bytes() == original_ledger
    assert run_restore(case, "verify-restore").returncode == 3


def prepare_live_restore(case, database):
    """Re-use artifact/key provisioning while taking a fresh real API snapshot."""
    from uuid import uuid4

    source, _, identity, target = case
    source = database, source[1], source[2]
    database.chmod(0o600)
    run_id = str(uuid4())
    result = run_backup(source, run_id)
    assert result.returncode == 3, result.stderr
    return source, source[1] / run_id, identity, target


@pytest.fixture(
    params=["protocol", pytest.param("age", marks=pytest.mark.requires_age)]
)
def restore_inputs(request):
    if request.param == "protocol":
        return request.getfixturevalue("restore_case")
    source, identity = request.getfixturevalue("real_age_case")
    directory = source[0].parent / "isolated"
    directory.mkdir(mode=0o700)
    return source, None, identity, directory / "restored.sqlite3"


def test_restore_migrates_known_ancestor(restore_case):

    source, _, _, target = restore_case
    old = source[0].with_name("ancestor.sqlite3")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0011_user_delete"],
        cwd=BACKEND,
        env={**environment(source), "DATABASE_PATH": str(old)},
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0
    from tests.support import populate_public_and_private_apps

    populate_public_and_private_apps(old)
    with sqlite3.connect(old) as ancestor:
        dump = "\n".join(ancestor.iterdump()) + "\n"
        members = rows(ancestor)["members"]
    replace_artifact(
        restore_case,
        sql=dump,
        mutate=lambda m, inner: (
            m.update(revision="0011_user_delete"),
            inner.update(revision="0011_user_delete"),
        ),
    )
    result = run_restore(restore_case)
    assert result.returncode == 3, result.stderr
    with sqlite3.connect(target) as db:
        assert rows(db)["members"] == members
        assert db.execute("SELECT version_num FROM alembic_version").fetchall() == [
            ("0012_health_checks",)
        ]


def test_restore_health_cancels_active_work_and_fences_late_result(restore_case):
    from sqlalchemy import text

    from app import health_store as store
    from app.backup import _stamp
    from app.database import make_engine, make_session_factory
    from app.health_worker import Worker
    from app.settings import Settings

    source = restore_case[0]
    engine = make_engine(source[0])
    stamp = _stamp()
    try:
        with make_session_factory(engine)() as db:
            apps = db.execute(text("SELECT id FROM apps ORDER BY id")).scalars().all()
            store.request_check(db, apps[2], "anon:restore-completed", None, stamp)
            store.heartbeat(
                db, worker_id="old-worker", boot_id="old-boot", mono=100, stamp=stamp
            )
            completed = store.claim(
                db, worker_id="old-worker", boot_id="old-boot", mono=100, stamp=stamp
            )
            assert store.finish(
                db,
                completed,
                {
                    "state": "healthy",
                    "checked_at": stamp,
                    "http_status": 200,
                    "response_ms": 1,
                },
                boot_id="old-boot",
                mono=101,
                stamp=stamp,
            )
            completed_clock = db.execute(
                text("SELECT finished_at FROM health_jobs WHERE id=:id"),
                {"id": completed["id"]},
            ).scalar()
            results = db.execute(
                text("SELECT * FROM health_results ORDER BY app_id")
            ).all()
            store.request_check(db, apps[0], "anon:restore-one", None, stamp)
            store.heartbeat(
                db, worker_id="old-worker", boot_id="old-boot", mono=100, stamp=stamp
            )
            job = store.claim(
                db, worker_id="old-worker", boot_id="old-boot", mono=100, stamp=stamp
            )
            store.request_check(db, apps[1], "anon:restore-two", None, stamp)
            db.commit()
    finally:
        engine.dispose()
    case = prepare_live_restore(restore_case, source[0])
    assert run_restore(case).returncode == 3
    engine = make_engine(case[3])
    try:
        factory = make_session_factory(engine)
        with factory() as db:
            assert not store.finish(
                db,
                job,
                {
                    "state": "healthy",
                    "checked_at": stamp,
                    "http_status": 200,
                    "response_ms": 1,
                },
                boot_id="old-boot",
                mono=101,
                stamp=stamp,
            )
            assert db.execute(
                text("SELECT status FROM health_jobs ORDER BY app_id")
            ).scalars().all() == ["cancelled", "cancelled", "completed"]
            assert (
                db.execute(
                    text("SELECT finished_at FROM health_jobs WHERE id=:id"),
                    {"id": completed["id"]},
                ).scalar()
                == completed_clock
            )
            assert (
                db.execute(text("SELECT * FROM health_results ORDER BY app_id")).all()
                == results
            )
            assert db.execute(text("SELECT ready FROM health_worker")).scalar() == 0
        worker = Worker(
            Settings.from_environment(
                {**environment(source), "DATABASE_PATH": str(case[3])}
            ),
            factory,
            testing_probe=lambda: None,
        )
        assert not worker.enabled()
        (case[3].parent / ".restore-blocked").unlink()
        assert not worker.enabled()
    finally:
        engine.dispose()


@pytest.mark.parametrize("phase", ["import", "reconcile", "audit", "receipt", "fsync"])
def test_restore_safe_failure_and_retry(restore_case, phase):
    source, artifact, identity, target = restore_case
    script = f"""
import os, sqlite3, sys
import app.restore as r
sys.argv = ['restore-db', '--backup-dir', {str(artifact)!r}, '--identity-file', {str(identity)!r}, '--ledger-file', {str(source[0].with_suffix(".deletions.sqlite3"))!r}]
def fail(*args, **kwargs): raise OSError(28, 'SECRET_TEST_SENTINEL!')
"""
    if phase == "reconcile":
        script += "r.reconcile = fail\n"
    elif phase == "audit":
        # Failure of the existing audit insert leaves the isolated partial restore blocked.
        from tests.test_backup import unpack

        _, _, dump = unpack(source, artifact.name)
        replace_artifact(
            restore_case,
            sql=dump.decode()
            + "CREATE TRIGGER fail_restore_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'SECRET_TEST_SENTINEL!'); END;",
        )
    else:
        script += "original = os.open\ndef opened(name, *args, **kwargs):\n"
        file = {
            "import": target.name,
            "receipt": ".restore-receipt.tmp",
            "fsync": ".restore-receipt.tmp",
        }[phase]
        if phase == "fsync":
            script += f"    fd = original(name, *args, **kwargs)\n    if name == {file!r}: r.os.fsync = fail\n    return fd\n"
        else:
            script += f"    if name == {file!r}: fail()\n    return original(name, *args, **kwargs)\n"
        script += "r.os.open = opened\n"
    script += "raise SystemExit(r.main('restore-db', sys.argv[1:]))\n"
    before = {
        p: p.read_bytes()
        for p in (source[0], source[0].with_suffix(".deletions.sqlite3"))
    }
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BACKEND,
        env={**environment(source), "DATABASE_PATH": str(target)},
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )
    assert result.returncode == 1
    assert result.stderr.strip() == "RESTORE_FAILED"
    assert all(p.read_bytes() == raw for p, raw in before.items())
    assert (target.parent / ".restore-blocked").exists()
    assert not (target.parent / "restore-receipt.json").exists()
    assert run_restore(restore_case).returncode == 2


def test_concurrent_restore_has_one_reservation_winner(restore_case):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as workers:
        one = workers.submit(run_restore, restore_case)
        two = workers.submit(run_restore, restore_case)
        assert sorted([one.result().returncode, two.result().returncode]) == [2, 3]
    assert run_restore(restore_case, "verify-restore").returncode == 3
