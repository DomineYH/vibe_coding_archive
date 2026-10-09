"""Operator metadata permits only a limited candidate, never public ingress."""

from __future__ import annotations

import json
import os
import re
import stat
from datetime import UTC, datetime
from pathlib import Path

from app.settings import ConfigurationError, Settings, private_directory, private_file

SCOPE = "limited candidate, external ingress closed"
COMMENT = re.compile(
    r"https://github\.com/DomineYH/vibe_coding_archive/issues/144#issuecomment-[1-9][0-9]*"
)


def _unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate activation field.")
        result[key] = value
    return result


def read_activation_record(path: Path, *, private=False):
    """Bound descriptor reads; private auth records also forbid links and bad modes."""
    if private:
        private_directory(path.parent)
    descriptor = os.open(
        path, os.O_RDONLY | os.O_NONBLOCK | (os.O_NOFOLLOW if private else 0)
    )
    with os.fdopen(descriptor, "rb") as file:
        metadata = os.fstat(file.fileno())
        if private:
            private_file(metadata)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 65536:
            raise ValueError("Activation record is invalid.")
        raw = file.read(65537)
    if len(raw) > 65536:
        raise ValueError("Activation record is too large.")
    return json.loads(raw, object_pairs_hook=_unique_fields if private else None)


def load_candidate_blocklist(path):
    from app.password_policy import blocklist_source, decode_blocklist

    try:
        if path is None or not path.is_absolute():
            raise ValueError("Invalid blocklist path.")
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as file:
            metadata = os.fstat(file.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o022:
                raise ValueError("Unsafe blocklist.")
            raw = file.read(blocklist_source()["file_size_bytes"] + 1)
        return decode_blocklist(raw)
    except (OSError, ValueError, TypeError):
        raise RuntimeError("A verified password blocklist is required.") from None


def auth_configuration(settings: Settings) -> dict:
    from app.password_policy import blocklist_source

    def canonical(path):
        return str(path.resolve()) if path is not None else None

    return {
        "app_env": settings.app_env,
        "database_path": canonical(settings.database_path),
        "public_origin": settings.public_origin,
        "password_blocklist_path": canonical(settings.password_blocklist_path),
        "password_blocklist_sha256": blocklist_source()["sha256"],
        # Bind the configured location; invalid HMAC leaf links remain reset-only.
        "password_reset_hmac_path": os.path.abspath(settings.password_reset_hmac_path)
        if settings.password_reset_hmac_path is not None
        else None,
        "auth_activation_path": canonical(settings.auth_activation_path),
        "health_checks_enabled": settings.health_checks_enabled,
        "email_collection": False,
        "phone_collection": False,
    }


def activation_template(settings: Settings) -> dict:
    from app.health_runtime import build_digest

    return {
        "version": 1,
        "status": "pending",
        "build_sha256": build_digest(),
        "release_id": settings.app_release_id,
        "configuration": auth_configuration(settings),
        "approved_by": None,
        "approved_at": None,
        "issue_144_comment": None,
        "scope": SCOPE,
    }


def record_enabled(path, *, build_sha256, release_id, configuration) -> bool:
    """Pure binding boundary also used by isolated synthetic test adapters."""
    if (
        path is None
        or not release_id
        or configuration.get("app_env") != "production"
        or any(
            configuration.get(key) is not False
            for key in ("health_checks_enabled", "email_collection", "phone_collection")
        )
    ):
        return False
    try:
        record = read_activation_record(path, private=True)
        if (
            not isinstance(record, dict)
            or record.keys()
            != {
                "version",
                "status",
                "build_sha256",
                "release_id",
                "configuration",
                "approved_by",
                "approved_at",
                "issue_144_comment",
                "scope",
            }
            or type(record.get("version")) is not int
            or record["version"] != 1
            or record.get("status") != "approved"
            or record.get("approved_by") != "DomineYH"
            or record.get("build_sha256") != build_sha256
            or record.get("release_id") != release_id
            or json.dumps(record.get("configuration"), sort_keys=True)
            != json.dumps(configuration, sort_keys=True)
            or record.get("scope") != SCOPE
            or not isinstance(record.get("issue_144_comment"), str)
            or not COMMENT.fullmatch(record["issue_144_comment"])
        ):
            return False
        approved_at = datetime.fromisoformat(record["approved_at"])
        return approved_at.tzinfo is not None and approved_at <= datetime.now(UTC)
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        return False


def runtime_enabled(settings: Settings) -> bool:
    from app.health_runtime import build_digest

    if settings.app_env != "production":
        return False
    try:
        return record_enabled(
            settings.auth_activation_path,
            build_sha256=build_digest(),
            release_id=settings.app_release_id,
            configuration=auth_configuration(settings),
        )
    except (OSError, ValueError, TypeError, KeyError):
        return False


def auth_available(state) -> bool:
    if not state.auth_enabled:
        return False
    if getattr(state, "auth_candidate", False):
        if state.auth_revoked:
            return False
        if not runtime_enabled(state.settings):
            state.auth_revoked = True
            return False
    return state.auth_ready and not getattr(state, "auth_revoked", False)


def main() -> None:
    try:
        template = activation_template(Settings.from_environment())
    except (ConfigurationError, OSError, ValueError):
        raise SystemExit("Application configuration is invalid.") from None
    # The operator redirects metadata under umask 077 and completes approval.
    print(json.dumps(template, indent=2))


if __name__ == "__main__":
    main()
