"""Bind an operator's activation record to this build and its egress settings.

The record is evidence metadata, not a replacement for firewall or host tests.
Generating a template never approves a build. In-process test injection lives
outside this gate and is restricted to APP_ENV=test.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from app.settings import Settings

BACKEND = Path(__file__).resolve().parents[1]
VERIFICATION_GROUPS = (
    "egress_dns_tls",
    "http_headers_deadline",
    "resource_cleanup_concurrency",
    "supervisor_single_worker",
    "clock_suspend",
    "database_fencing_recovery",
    "api_batch_retention",
    "disable_reenable",
)


def boot_clock() -> tuple[str, float]:
    """Same-host boot identity and monotonic time; UTC never controls a lease."""
    return Path("/proc/sys/kernel/random/boot_id").read_text().strip(), time.monotonic()


def build_digest() -> str:
    digest = hashlib.sha256()
    paths = sorted(
        [*BACKEND.glob("app/**/*.py"), *BACKEND.glob("alembic/**/*.py")]
        + [BACKEND / "pyproject.toml", BACKEND / "uv.lock"]
    )
    for path in paths:
        digest.update(str(path.relative_to(BACKEND)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def configuration(settings: Settings) -> dict:
    return {
        "database_path": str(settings.database_path.resolve()),
        "dns_servers": list(settings.health_dns_servers),
        "denied_ips": list(settings.health_denied_ips),
        "worker_uid": settings.health_worker_uid,
        "worker_lock_path": str(settings.health_worker_lock_path),
    }


def activation_template(settings: Settings) -> dict:
    return {
        "version": 1,
        "approved_by": None,
        "approved_at": None,
        "build_sha256": build_digest(),
        "configuration": configuration(settings),
        "verification": {
            group: {"status": "not_run", "evidence": None}
            for group in VERIFICATION_GROUPS
        },
    }


def runtime_enabled(settings: Settings) -> bool:
    if (
        not settings.health_checks_enabled
        or settings.app_env == "test"
        or settings.health_activation_path is None
        or not settings.health_dns_servers
        or not settings.health_denied_ips
        or settings.health_worker_uid is None
        or settings.health_worker_uid <= 0
    ):
        return False
    try:
        raw = settings.health_activation_path.read_bytes()
        if len(raw) > 65536:
            return False
        record = json.loads(raw)
        if (
            not isinstance(record, dict)
            or record.get("version") != 1
            or record.get("approved_by") != "DomineYH"
            or record.get("build_sha256") != build_digest()
            or record.get("configuration") != configuration(settings)
        ):
            return False
        approved_at = datetime.fromisoformat(record["approved_at"])
        if approved_at.tzinfo is None or approved_at > datetime.now(UTC):
            return False
        boot_clock()
        for group in VERIFICATION_GROUPS:
            verification = record["verification"][group]
            if (
                verification["status"] != "pass"
                or not isinstance(verification["evidence"], str)
                or not verification["evidence"].strip()
            ):
                return False
        return True
    except (OSError, ValueError, TypeError, KeyError):
        return False


def main() -> None:
    # stdout is a template only; the operator stores the completed private record.
    print(json.dumps(activation_template(Settings.from_environment()), indent=2))


if __name__ == "__main__":
    main()
