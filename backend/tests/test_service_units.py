"""Installed-unit contracts and syntax verification, never supervisor proof."""

import os
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import pytest

UNITS = Path(__file__).resolve().parents[2] / "deploy" / "systemd"
PYTHON = "/opt/eduvibe/current/backend/.venv/bin/python"
EXPECTED = {
    "eduvibe-api.service",
    "eduvibe-health-worker.service",
    "eduvibe-nginx.service",
    "eduvibe-backup.service",
    "eduvibe-backup.timer",
    "eduvibe-ops-check.service",
    "eduvibe-ops-check.timer",
}


def shipped():
    paths = sorted(UNITS.glob("*"))
    assert {p.name for p in paths} == EXPECTED
    return paths


def directives(path):
    values = defaultdict(list)
    for line in path.read_text().splitlines():
        if line and not line.startswith(("#", "[")):
            key, value = line.split("=", 1)
            values[key].append(value)
    return values


def test_all_units_pass_systemd_analyze_verify(tmp_path):
    paths = shipped()
    executable = shutil.which("systemd-analyze")
    if not executable:
        if os.environ.get("CI", "").lower() == "true":
            pytest.fail("systemd-analyze is mandatory in CI")
        pytest.skip("NOT RUN: systemd-analyze unavailable")
    rendered = []
    for path in paths:
        target = tmp_path / path.name
        # Substitute installation executables only: no accounts/mounts/start proof.
        target.write_text(
            path.read_text()
            .replace(PYTHON, sys.executable)
            .replace("/usr/sbin/nginx", shutil.which("nginx") or "/usr/bin/true")
        )
        rendered.append(str(target))
    result = subprocess.run(
        [executable, "verify", "--man=no", *rendered],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert not any(
        word in result.stderr.lower() for word in ("unknown", "ignored", "invalid")
    ), result.stderr


def test_unit_lifecycle_and_privilege_contracts():
    for path in shipped():
        values = directives(path)
        assert "ExecStartPre" not in values
        assert "RuntimeDirectory" not in values  # Lifetime lock inode is persistent.
        assert "eduvibe.target" not in path.read_text()
        if path.suffix != ".service":
            continue
        nginx = path.name == "eduvibe-nginx.service"
        backup = path.name in {"eduvibe-backup.service", "eduvibe-ops-check.service"}
        uid = "eduvibe-nginx" if nginx else "eduvibe"
        assert values["User"] == values["Group"] == [uid]
        assert values["UMask"] == ["0077"]
        assert values["NoNewPrivileges"] == ["yes"]
        assert values["LimitCORE"] == ["0"]
        assert values["LogNamespace"] == ["eduvibe"]
        assert values["KillSignal"] == ["SIGTERM"]
        assert values["KillMode"] == ["control-group"]
        assert values["TimeoutStopSec"] == ["15s"]
        assert values["SendSIGKILL"] == ["yes"]
        assert values["Restart"] == (["no"] if backup else ["on-failure"])
        assert values["Type"] == (["oneshot"] if backup else ["simple"])
        assert values["EnvironmentFile"]
        assert all(not item.startswith("-") for item in values["EnvironmentFile"])
        assert "HEALTH_CHECKS_ENABLED=false" in values["Environment"]
        assert "APP_ENV=production" in values["Environment"]
        assert (
            values["StandardOutput"]
            == values["StandardError"]
            == ["null" if nginx else "journal"]
        )
        assert "SuccessExitStatus" not in values
        assert "RestartPreventExitStatus" not in values
        assert not values["ExecStart"][0].startswith("-")
        if not backup:
            assert values["RestartSec"] == ["5s"]
            assert values["StartLimitIntervalSec"] == ["60s"]
            assert values["StartLimitBurst"] == ["3"]
        if path.name in ("eduvibe-health-worker.service", "eduvibe-nginx.service"):
            assert values["Requires"] == values["After"] == ["eduvibe-api.service"]
        if path.name == "eduvibe-health-worker.service":
            assert "WantedBy" not in values  # No enabled worker by default.
        if path.name == "eduvibe-api.service":
            assert "Requires" not in values and "Wants" not in values
        if not nginx:
            assert values["WorkingDirectory"] == ["/opt/eduvibe/current/backend"]
        if path.name in ("eduvibe-api.service", "eduvibe-health-worker.service"):
            assert (
                "HEALTH_WORKER_LOCK_PATH=/srv/eduvibe/worker/health-worker.lock"
                in values["Environment"]
            )
    assert directives(UNITS / "eduvibe-api.service")["ExecStart"] == [
        f"{PYTHON} -m app.api --host 127.0.0.1 --port 8000"
    ]
    assert directives(UNITS / "eduvibe-health-worker.service")["ExecStart"] == [
        f"{PYTHON} -m app.health_worker"
    ]
    assert directives(UNITS / "eduvibe-nginx.service")["ExecStart"] == [
        "/usr/sbin/nginx -p /srv/eduvibe/nginx/ -c /etc/eduvibe/nginx.conf -g 'daemon off;'"
    ]


def test_backup_timer_preserves_kst_and_nonzero_status():
    shipped()
    timer = directives(UNITS / "eduvibe-backup.timer")
    assert timer["OnCalendar"] == [
        "*-*-* 07:00:00 Asia/Seoul",
        "*-*-* 19:00:00 Asia/Seoul",
    ]
    assert timer["Persistent"] == ["true"]
    assert timer["RandomizedDelaySec"] == ["0"]
    assert timer["Unit"] == ["eduvibe-backup.service"]
    backup = directives(UNITS / "eduvibe-backup.service")
    assert backup["ExecStart"] == [
        (
            f"{PYTHON} -m app.cli backup-db --output-dir ${{BACKUP_ROOT}} "
            "--recipient-file ${BACKUP_RECIPIENT_FILE} --release-id ${APP_RELEASE_ID}"
        )
    ]
    assert backup["EnvironmentFile"] == [
        "/etc/eduvibe/runtime.env",
        "/etc/eduvibe/backup.env",
    ]
    assert "SuccessExitStatus" not in backup
    assert not backup["ExecStart"][0].startswith("-")


def test_ops_timer_uses_safe_read_only_command_and_preserves_failures():
    timer = directives(UNITS / "eduvibe-ops-check.timer")
    assert timer["OnCalendar"] == ["*:0/5"]
    assert timer["Persistent"] == ["true"]
    assert timer["Unit"] == ["eduvibe-ops-check.service"]
    service = directives(UNITS / "eduvibe-ops-check.service")
    assert service["Type"] == ["oneshot"]
    assert service["Restart"] == ["no"]
    assert service["EnvironmentFile"] == [
        "/etc/eduvibe/runtime.env",
        "/etc/eduvibe/backup.env",
    ]
    assert service["ExecStart"] == [
        f"{PYTHON} -m app.cli ops-check --backup-dir ${{BACKUP_ROOT}}"
    ]
    assert "SuccessExitStatus" not in service and "OnFailure" not in service
    assert not any(
        word in service["ExecStart"][0]
        for word in ("systemctl", "purge-expired", "http://", "https://")
    )
