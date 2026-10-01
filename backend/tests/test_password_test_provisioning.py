"""Test runners use verified, provisioned R15 data without network acquisition."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("auth_enabled", [False, True])
def test_contracts_run_offline_with_only_explicit_auth_provisioning(
    tmp_path, auth_enabled
):
    guard = tmp_path / "sitecustomize.py"
    guard.write_text(
        "import socket\n"
        "def offline(*args, **kwargs):\n"
        "    raise AssertionError('test attempted network acquisition')\n"
        "socket.socket.connect = offline\n"
    )
    env = {**os.environ, "PYTHONPATH": str(tmp_path)}
    if not auth_enabled:
        env.pop("PASSWORD_BLOCKLIST_PATH", None)
    selection = (
        "tests/contracts/test_auth_password.py::test_auth_enabled_startup_refuses_missing_or_corrupt_blocklist"
        if auth_enabled
        else "tests/contracts/test_public_meta_health.py"
    )
    result = subprocess.run(
        [sys.executable, "-m", "pytest", selection, "-q"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
