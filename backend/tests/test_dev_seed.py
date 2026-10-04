from __future__ import annotations

import errno
import json
import os
import pty
import select
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import pytest
from pwdlib import PasswordHash

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
PROMPTS = (b"Shared development password: ", b"Confirm development password: ")
TEST_PASSWORD = "Synthetic-demo-password-2026!"
PUBLIC_APP_ID = "00000000-0000-4000-8000-000000000084"
PRIVATE_APP_ID = "00000000-0000-4000-8000-000000000085"
MEMBER_IDS = (
    "00000000-0000-4000-8000-000000000084",
    "00000000-0000-4000-8000-000000000085",
)


def _copy_backend(tmp_path: Path) -> tuple[Path, Path]:
    repo = tmp_path / "checkout"
    backend = repo / "backend"
    ignored = shutil.ignore_patterns(
        ".env", ".venv", ".pytest_cache", ".ruff_cache", "__pycache__", "*.pyc"
    )
    shutil.copytree(BACKEND, backend, ignore=ignored)
    (repo / "contracts").mkdir()
    shutil.copy2(ROOT / "contracts" / "catalog.json", repo / "contracts")
    metadata = Path(
        "docs/research/password-blocklist-provenance/metadata/candidate_sources.json"
    )
    (repo / metadata.parent).mkdir(parents=True)
    shutil.copy2(ROOT / metadata, repo / metadata)
    (repo / "storage").mkdir()
    return repo, backend


def _environment(*, app_env="development", database_path: Path | None = None):
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"APP_ENV", "DATABASE_PATH", "PUBLIC_ORIGIN", "PYTHONPATH"}
    }
    env["APP_ENV"] = app_env
    if database_path is not None:
        env["DATABASE_PATH"] = str(database_path)
    return env


def _migrate(backend: Path) -> Path:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend,
        env=_environment(),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return backend.parent / "storage" / "development.sqlite3"


def _run_cli(
    backend: Path,
    *,
    app_env="development",
    database_path: Path | None = None,
    passwords=(),
) -> tuple[int, str]:
    pid, terminal = pty.fork()
    if pid == 0:
        os.chdir(backend)
        os.execve(
            sys.executable,
            [sys.executable, "-m", "app.cli", "seed"],
            _environment(app_env=app_env, database_path=database_path),
        )

    output = bytearray()
    sent = 0
    deadline = time.monotonic() + 20
    status = None
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([terminal], [], [], 0.1)
            if ready:
                try:
                    output.extend(os.read(terminal, 4096))
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            occurrences = sum(output.count(prompt) for prompt in PROMPTS)
            while sent < occurrences:
                response = passwords[sent] if sent < len(passwords) else ""
                os.write(terminal, response.encode() + b"\n")
                sent += 1
            waited, child_status = os.waitpid(pid, os.WNOHANG)
            if waited:
                status = child_status
                break
        if status is None:
            os.kill(pid, signal.SIGKILL)
            _, status = os.waitpid(pid, 0)
            raise AssertionError(
                f"seed CLI timed out: {output.decode(errors='replace')}"
            )
        while select.select([terminal], [], [], 0)[0]:
            try:
                output.extend(os.read(terminal, 4096))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
    finally:
        os.close(terminal)
    return os.waitstatus_to_exitcode(status), output.decode(errors="replace")


def _start_development_api(backend: Path) -> tuple[subprocess.Popen, str]:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--fd",
            str(listener.fileno()),
            "--no-access-log",
        ],
        cwd=backend,
        env=_environment(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        pass_fds=(listener.fileno(),),
    )
    listener.close()
    base_url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(
                f"Development API exited during startup: {process.communicate()[1]}"
            )
        try:
            with urlopen(f"{base_url}/healthz", timeout=0.5) as response:
                if response.status == 200:
                    return process, base_url
        except (URLError, TimeoutError):
            time.sleep(0.05)
    process.terminate()
    raise AssertionError(
        f"Development API did not become ready: {process.communicate(timeout=5)[1]}"
    )


def _stop_development_api(process: subprocess.Popen) -> None:
    process.terminate()
    process.communicate(timeout=10)


def _read_api_json(base_url: str, path: str) -> tuple[int, dict]:
    try:
        with urlopen(f"{base_url}{path}", timeout=3) as response:
            return response.status, json.load(response)
    except HTTPError as response:
        return response.code, json.load(response)


def _verify_seeded_ui(base_url: str) -> None:
    frontend = ROOT / "frontend"
    result = subprocess.run(
        ["node", "scripts/test-seeded-dev-ui.mjs"],
        cwd=frontend,
        env={
            **os.environ,
            "ISSUE84_SEED_UI_API_URL": base_url,
        },
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _assert_seed_api_read(
    base_url: str,
    *,
    nickname="시연 교사",
    name="분수 탐험 교실",
    prompt="초등학교 4학년을 위한 분수 탐험 활동을 만들어 주세요.",
) -> tuple[dict, dict]:
    status, page = _read_api_json(base_url, "/api/v1/apps?limit=100")
    assert status == 200
    assert page["pagination"]["total"] == 1
    assert len(page["items"]) == 1
    card = page["items"][0]
    assert card["id"] == PUBLIC_APP_ID
    assert card["owner"]["nickname"] == nickname
    assert card["name"] == name
    assert card["health"] == {
        "result": {"state": "unchecked", "checked_at": None, "fresh_until": None},
        "latest_job": None,
        "next_check_at": None,
    }
    assert "private" not in json.dumps(page, ensure_ascii=False).casefold()

    status, response = _read_api_json(base_url, f"/api/v1/apps/{PUBLIC_APP_ID}")
    assert status == 200
    detail = response["item"]
    assert detail["url"] == "https://example.test/fraction-adventure"
    assert detail["description"] == "분수와 수직선을 함께 살펴보는 합성 자료입니다."
    assert detail["prompt"] == prompt
    public_json = json.dumps({"page": page, "detail": detail}, ensure_ascii=False)
    for sensitive_key in ("login_id", "email", "phone", "password_hash"):
        assert f'"{sensitive_key}"' not in public_json
    status, response = _read_api_json(base_url, f"/api/v1/apps/{PRIVATE_APP_ID}")
    assert status == 404
    assert "sentinel" not in json.dumps(response).casefold()
    return page, detail


def test_seed_cli_seeds_only_missing_rows_and_preserves_existing_edits(
    tmp_path: Path, password_blocklist, monkeypatch
):
    monkeypatch.setenv("PASSWORD_BLOCKLIST_PATH", str(password_blocklist))
    repo, backend = _copy_backend(tmp_path)
    database_path = _migrate(backend)

    empty_server, empty_base_url = _start_development_api(backend)
    try:
        status, page = _read_api_json(empty_base_url, "/api/v1/apps")
        assert status == 200
        assert page["items"] == []
        assert page["pagination"]["total"] == 0
        assert page["facets"]["subjects_in_use"] == []
    finally:
        _stop_development_api(empty_server)

    status, output = _run_cli(backend, passwords=(TEST_PASSWORD, TEST_PASSWORD))
    assert status == 0, output
    assert TEST_PASSWORD not in output
    assert sum(output.count(prompt.decode()) for prompt in PROMPTS) == 2
    assert "Seeded 2 members and 2 apps." in output

    with sqlite3.connect(database_path) as connection:
        members = connection.execute(
            "SELECT id, login_id, nickname, password_hash, is_admin, approval_status "
            "FROM members ORDER BY id"
        ).fetchall()
        assert [member[0] for member in members] == list(MEMBER_IDS)
        assert connection.execute(
            "SELECT login_id_key FROM members ORDER BY id"
        ).fetchall() == [("seed-member-one",), ("seed-member-two",)]
        assert all(not member[4] and member[5] == "approved" for member in members)
        assert all(
            PasswordHash.recommended().verify(TEST_PASSWORD, member[3])
            for member in members
        )
        assert len({member[3] for member in members}) == 2
        assert connection.execute("SELECT COUNT(*) FROM apps").fetchone()[0] == 2
        public = connection.execute(
            "SELECT id, owner_id, name, prompt, is_public FROM apps WHERE id = ?",
            (PUBLIC_APP_ID,),
        ).fetchone()
        private = connection.execute(
            "SELECT id, is_public FROM apps WHERE id = ?", (PRIVATE_APP_ID,)
        ).fetchone()
        assert public[0] == PUBLIC_APP_ID and public[1] == MEMBER_IDS[0]
        assert public[4] == 1 and private == (PRIVATE_APP_ID, 0)
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM health_results WHERE state <> 'unchecked' "
                "OR checked_at IS NOT NULL OR fresh_until IS NOT NULL"
            ).fetchone()[0]
            == 0
        )

    first_server, first_base_url = _start_development_api(backend)
    try:
        first_page, first_detail = _assert_seed_api_read(first_base_url)
    finally:
        _stop_development_api(first_server)

    second_server, second_base_url = _start_development_api(backend)
    try:
        second_page, second_detail = _assert_seed_api_read(second_base_url)
    finally:
        _stop_development_api(second_server)
    assert first_page["items"] == second_page["items"]
    assert first_page["pagination"] == second_page["pagination"]
    assert first_detail == second_detail

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE apps SET name = 'Existing app edit', prompt = 'Existing prompt' "
            "WHERE id = ?",
            (PUBLIC_APP_ID,),
        )
        connection.commit()

    if os.environ.get("ISSUE84_VERIFY_SEEDED_UI") == "1":
        ui_server, ui_base_url = _start_development_api(backend)
        try:
            _verify_seeded_ui(ui_base_url)
        finally:
            _stop_development_api(ui_server)

    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "UPDATE members SET login_id = '  SEED-MEMBER-ONE  ', "
            "nickname = 'Edited member nickname', password_hash = 'existing-hash', "
            "approval_status = 'revoked' WHERE id = ?",
            (MEMBER_IDS[0],),
        )
        connection.execute("DELETE FROM apps WHERE id = ?", (PRIVATE_APP_ID,))
        connection.commit()

    status, output = _run_cli(backend)
    assert status == 0, output
    assert all(prompt.decode() not in output for prompt in PROMPTS)
    assert "Seeded 0 members and 1 apps." in output
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT login_id, nickname, password_hash, approval_status "
            "FROM members WHERE id = ?",
            (MEMBER_IDS[0],),
        ).fetchone() == (
            "  SEED-MEMBER-ONE  ",
            "Edited member nickname",
            "existing-hash",
            "revoked",
        )
        assert connection.execute(
            "SELECT name, prompt FROM apps WHERE id = ?", (PUBLIC_APP_ID,)
        ).fetchone() == ("Existing app edit", "Existing prompt")
        assert connection.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM apps").fetchone()[0] == 2

    status, output = _run_cli(backend)
    assert status == 0, output
    assert all(prompt.decode() not in output for prompt in PROMPTS)
    assert "Seeded 0 members and 0 apps." in output

    third_server, third_base_url = _start_development_api(backend)
    try:
        edited_page, edited_detail = _assert_seed_api_read(
            third_base_url,
            nickname="Edited member nickname",
            name="Existing app edit",
            prompt="Existing prompt",
        )
    finally:
        _stop_development_api(third_server)
    fourth_server, fourth_base_url = _start_development_api(backend)
    try:
        restarted_page, restarted_detail = _assert_seed_api_read(
            fourth_base_url,
            nickname="Edited member nickname",
            name="Existing app edit",
            prompt="Existing prompt",
        )
    finally:
        _stop_development_api(fourth_server)
    assert edited_page["items"] == restarted_page["items"]
    assert edited_page["pagination"] == restarted_page["pagination"]
    assert edited_detail == restarted_detail

    assert database_path.is_relative_to(repo)


def test_seed_cli_refuses_noninteractive_wrong_environment_and_wrong_database(
    tmp_path: Path,
):
    repo, backend = _copy_backend(tmp_path)
    default_database = repo / "storage" / "development.sqlite3"

    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "seed"],
        cwd=backend,
        env=_environment(),
        input="",
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode != 0
    assert "interactive terminal" in result.stderr
    assert not default_database.exists()

    status, output = _run_cli(
        backend, app_env="test", database_path=tmp_path / "test.sqlite3"
    )
    assert status != 0
    assert "development environment" in output
    assert not (tmp_path / "test.sqlite3").exists()

    alternate_database = repo / "storage" / "other.sqlite3"
    alternate_database.write_bytes(b"leave untouched")
    status, output = _run_cli(backend, database_path=alternate_database)
    assert status != 0
    assert "designated development database" in output
    assert alternate_database.read_bytes() == b"leave untouched"
    assert not default_database.exists()

    external_database = tmp_path / "outside.sqlite3"
    external_database.write_bytes(b"also untouched")
    default_database.symlink_to(external_database)
    status, output = _run_cli(backend)
    assert status != 0
    assert "designated development database" in output
    assert external_database.read_bytes() == b"also untouched"


def test_seed_cli_rejects_missing_or_incompatible_revision_without_migrating(
    tmp_path: Path,
):
    repo, backend = _copy_backend(tmp_path)
    database_path = repo / "storage" / "development.sqlite3"

    status, output = _run_cli(backend)
    assert status != 0
    assert not database_path.exists()
    assert "Run the explicit development migration first" in output

    with sqlite3.connect(database_path):
        pass
    status, output = _run_cli(backend)
    assert status != 0
    assert "migration head" in output
    with sqlite3.connect(database_path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'"
            ).fetchone()[0]
            == 0
        )

    database_path = _migrate(backend)
    with sqlite3.connect(database_path) as connection:
        connection.execute("UPDATE alembic_version SET version_num = 'unknown'")
        connection.commit()
    status, output = _run_cli(backend)
    assert status != 0
    assert "migration head" in output
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == ("unknown",)

    with sqlite3.connect(database_path) as connection:
        connection.execute("UPDATE alembic_version SET version_num = '0001_baseline'")
        connection.commit()
    status, output = _run_cli(backend)
    assert status != 0
    assert "migration head" in output
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone() == ("0001_baseline",)

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO alembic_version(version_num) VALUES ('0002_public_apps')"
        )
        connection.commit()
    status, output = _run_cli(backend)
    assert status != 0
    assert "migration head" in output
    assert "Traceback" not in output
    with sqlite3.connect(database_path) as connection:
        assert connection.execute(
            "SELECT version_num FROM alembic_version ORDER BY version_num"
        ).fetchall() == [("0001_baseline",), ("0002_public_apps",)]


@pytest.mark.parametrize(
    ("passwords", "message"),
    [
        (("short-password", "short-password"), "15 to 128"),
        ((TEST_PASSWORD, "Different-synthetic-password"), "do not match"),
    ],
)
def test_seed_cli_validates_password_without_echo_or_partial_writes(
    tmp_path: Path, passwords: tuple[str, str], message: str
):
    _repo, backend = _copy_backend(tmp_path)
    database_path = _migrate(backend)

    status, output = _run_cli(backend, passwords=passwords)

    assert status != 0
    assert message in output
    assert all(password not in output for password in passwords)
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM apps").fetchone()[0] == 0


def test_seed_cli_login_collision_rolls_back_every_new_row(tmp_path: Path):
    _repo, backend = _copy_backend(tmp_path)
    database_path = _migrate(backend)
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO members "
            "(id, login_id, nickname, is_admin, approval_status, login_id_key, created_at, updated_at, first_approved_at) "
            "VALUES (?, 'seed-member-two', 'Existing member', 0, 'approved', 'seed-member-two', '2026-09-28T12:00:00Z', '2026-09-28T12:00:00Z', '2026-09-28T12:00:00Z')",
            ("00000000-0000-0000-0000-000000000099",),
        )
        connection.commit()

    status, output = _run_cli(backend, passwords=(TEST_PASSWORD, TEST_PASSWORD))
    assert status != 0
    assert "Conflicting seed data" in output
    assert TEST_PASSWORD not in output
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT id FROM members ORDER BY id").fetchall() == [
            ("00000000-0000-0000-0000-000000000099",)
        ]
        assert connection.execute("SELECT COUNT(*) FROM apps").fetchone()[0] == 0


def test_seed_cli_rejects_normalized_login_collision_before_prompt_or_writes(
    tmp_path: Path,
):
    _repo, backend = _copy_backend(tmp_path)
    database_path = _migrate(backend)
    blocker_id = "00000000-0000-0000-0000-000000000099"
    blocker_login = "  SEED-MEMBER-ONE  "
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO members "
            "(id, login_id, nickname, is_admin, approval_status, login_id_key, created_at, updated_at, first_approved_at) "
            "VALUES (?, ?, 'Existing member', 0, 'approved', ?, '2026-09-28T12:00:00Z', '2026-09-28T12:00:00Z', '2026-09-28T12:00:00Z')",
            (blocker_id, blocker_login, blocker_login.strip().lower()),
        )
        connection.commit()

    status, output = _run_cli(backend)

    assert status != 0
    assert "Conflicting seed data; no changes were saved." in output
    assert all(prompt.decode() not in output for prompt in PROMPTS)
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT id, login_id FROM members").fetchall() == [
            (blocker_id, blocker_login)
        ]
        assert connection.execute("SELECT COUNT(*) FROM apps").fetchone()[0] == 0


def test_seed_cli_rejects_seed_member_id_with_different_login_before_prompt_or_writes(
    tmp_path: Path,
):
    _repo, backend = _copy_backend(tmp_path)
    database_path = _migrate(backend)
    blocker_login = "another-member"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO members "
            "(id, login_id, nickname, is_admin, approval_status, login_id_key, created_at, updated_at, first_approved_at) "
            "VALUES (?, ?, 'Existing member', 0, 'approved', ?, '2026-09-28T12:00:00Z', '2026-09-28T12:00:00Z', '2026-09-28T12:00:00Z')",
            (MEMBER_IDS[0], blocker_login, blocker_login.strip().lower()),
        )
        connection.commit()

    status, output = _run_cli(backend)

    assert status != 0
    assert "Conflicting seed data; no changes were saved." in output
    assert all(prompt.decode() not in output for prompt in PROMPTS)
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT id, login_id FROM members").fetchall() == [
            (MEMBER_IDS[0], blocker_login)
        ]
        assert connection.execute("SELECT COUNT(*) FROM apps").fetchone()[0] == 0
