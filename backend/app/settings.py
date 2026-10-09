from __future__ import annotations

import ipaddress
import os
import stat
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, ValidationError

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"


class ConfigurationError(ValueError):
    pass


def _is_valid_dns_hostname(hostname: str) -> bool:
    try:
        ascii_hostname = hostname.encode("idna").decode("ascii")
        ascii_hostname.encode("ascii").decode("idna")
    except UnicodeError:
        return False
    ascii_hostname = ascii_hostname.removesuffix(".")
    if not ascii_hostname or len(ascii_hostname) > 253:
        return False
    labels = ascii_hostname.split(".")
    if len(labels) == 4 and all(label.isdecimal() for label in labels):
        try:
            ipaddress.IPv4Address(ascii_hostname)
        except ValueError:
            return False
    return all(
        0 < len(label) <= 63
        and label[0].isalnum()
        and label[-1].isalnum()
        and all(character.isalnum() or character == "-" for character in label)
        for label in labels
    )


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    app_env: Literal["development", "test", "production"]
    database_path: Path
    public_origin: str
    password_blocklist_path: Path | None = None
    password_reset_hmac_path: Path | None = None
    health_checks_enabled: bool = False
    health_dns_servers: tuple[str, ...] = ()
    health_denied_ips: tuple[str, ...] = ()
    health_worker_uid: int | None = None
    health_worker_lock_path: Path = Path("/run/eduvibe/health-worker.lock")
    health_activation_path: Path | None = None
    auth_activation_path: Path | None = None
    app_release_id: str | None = None

    @classmethod
    def from_environment(
        cls,
        environment: Mapping[str, str] = os.environ,
        *,
        repo_root: Path = ROOT,
        backend_root: Path = BACKEND_ROOT,
    ) -> Settings:
        process_app_env = environment.get("APP_ENV")
        if process_app_env and process_app_env not in {
            "development",
            "test",
            "production",
        }:
            raise ConfigurationError("APP_ENV must be set to a supported environment.")
        values = (
            {}
            if process_app_env in {"test", "production"}
            else dotenv_values(backend_root / ".env")
        )
        app_env = process_app_env or values.get("APP_ENV")
        if not process_app_env and app_env in {"test", "production"}:
            raise ConfigurationError(
                f"APP_ENV={app_env} must be set in the process environment."
            )
        if app_env not in {"development", "test", "production"}:
            raise ConfigurationError("APP_ENV must be set to a supported environment.")
        values.update(environment)
        raw_database_path = values.get("DATABASE_PATH")
        raw_public_origin = values.get("PUBLIC_ORIGIN")

        if app_env == "development":
            raw_database_path = raw_database_path or str(
                repo_root / "storage" / "development.sqlite3"
            )
            raw_public_origin = raw_public_origin or "http://localhost:5174"
        elif not raw_database_path or not raw_public_origin:
            raise ConfigurationError(
                "Test and production require explicit database and public-origin settings."
            )

        path = Path(raw_database_path).expanduser()
        if app_env == "development" and not path.is_absolute():
            path = repo_root / path
        elif not path.is_absolute():
            raise ConfigurationError("The configured database path must be absolute.")
        path = path.resolve(strict=False)

        repo_root = repo_root.resolve()
        if app_env in {"test", "production"}:
            try:
                path.relative_to(repo_root)
            except ValueError:
                pass
            else:
                raise ConfigurationError(
                    "Test and production databases must be outside the repository."
                )
        temporary_root = Path(tempfile.gettempdir()).resolve()
        if app_env == "test":
            try:
                temporary_path = path.relative_to(temporary_root)
            except ValueError:
                raise ConfigurationError(
                    "Test databases must be inside a dedicated temporary directory."
                ) from None
            if len(temporary_path.parts) < 2:
                raise ConfigurationError(
                    "Test databases must be inside a dedicated temporary directory."
                )
        elif app_env == "production":
            production_path(Path(raw_database_path).expanduser(), repo_root=repo_root)

        origin = raw_public_origin
        if any(
            character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F
            for character in origin
        ):
            raise ConfigurationError("PUBLIC_ORIGIN must be one exact HTTP origin.")
        try:
            parsed = urlsplit(origin)
            port = parsed.port
            hostname = parsed.hostname
        except ValueError:
            raise ConfigurationError(
                "PUBLIC_ORIGIN must be one exact HTTP origin."
            ) from None
        if parsed.netloc.startswith("["):
            bracket = parsed.netloc.find("]")
            suffix = parsed.netloc[bracket + 1 :] if bracket >= 0 else ""
            try:
                bracketed_ipv6 = (
                    bracket > 1
                    and parsed.netloc.count("[") == 1
                    and parsed.netloc.count("]") == 1
                    and (not suffix or suffix.startswith(":"))
                    and bool(hostname)
                    and "%" not in hostname
                    and ipaddress.IPv6Address(hostname)
                )
            except ValueError:
                bracketed_ipv6 = False
            valid_host = bool(bracketed_ipv6)
        else:
            valid_host = (
                bool(hostname)
                and "[" not in parsed.netloc
                and "]" not in parsed.netloc
                and _is_valid_dns_hostname(hostname)
            )
        if (
            parsed.scheme not in {"http", "https"}
            or not valid_host
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "?" in origin
            or "#" in origin
            or parsed.netloc.endswith(":")
            or port == 0
        ):
            raise ConfigurationError("PUBLIC_ORIGIN must be one exact HTTP origin.")
        if app_env == "production":
            normalized_hostname = hostname.rstrip(".").casefold()
            try:
                address = ipaddress.ip_address(normalized_hostname)
                mapped = (
                    address.ipv4_mapped
                    if isinstance(address, ipaddress.IPv6Address)
                    else None
                )
                loopback = address.is_loopback or (
                    mapped is not None and mapped.is_loopback
                )
            except ValueError:
                loopback = (
                    normalized_hostname == "localhost"
                    or normalized_hostname.endswith(".localhost")
                )
            if parsed.scheme != "https" or loopback:
                raise ConfigurationError(
                    "Production requires an explicit non-local HTTPS origin."
                )

        health_enabled = values.get("HEALTH_CHECKS_ENABLED", "false")
        if health_enabled not in {"true", "false"}:
            raise ConfigurationError("HEALTH_CHECKS_ENABLED must be true or false.")
        dns_servers = tuple(
            item.strip()
            for item in (values.get("HEALTH_DNS_SERVERS") or "").split(",")
            if item.strip()
        )
        denied_ips = tuple(
            item.strip()
            for item in (values.get("HEALTH_DENIED_IPS") or "").split(",")
            if item.strip()
        )
        try:
            for address in dns_servers:
                ipaddress.ip_address(address)
            for address in denied_ips:
                ipaddress.ip_network(address, strict=False)
            worker_uid = (
                int(values["HEALTH_WORKER_UID"])
                if values.get("HEALTH_WORKER_UID")
                else None
            )
            if worker_uid is not None and worker_uid <= 0:
                raise ValueError("A nonprivileged worker UID is required.")
            health_lock = Path(
                values.get("HEALTH_WORKER_LOCK_PATH")
                or "/run/eduvibe/health-worker.lock"
            )
            health_activation = (
                Path(values["HEALTH_ACTIVATION_PATH"])
                if values.get("HEALTH_ACTIVATION_PATH")
                else None
            )
            if not health_lock.is_absolute() or (
                health_activation is not None and not health_activation.is_absolute()
            ):
                raise ValueError("Health paths must be absolute.")
        except (ValueError, TypeError):
            raise ConfigurationError(
                "Health worker configuration is invalid."
            ) from None

        auth_activation = None
        release_id = values.get("APP_RELEASE_ID") or None
        if values.get("AUTH_ACTIVATION_PATH"):
            auth_activation = Path(values["AUTH_ACTIVATION_PATH"])
            if not auth_activation.is_absolute():
                raise ConfigurationError("Auth activation path must be absolute.")
            if app_env == "production":
                production_path(auth_activation, repo_root=repo_root)
            if (
                not release_id
                or not release_id.strip()
                or len(release_id) > 256
                or any(ord(char) < 32 or ord(char) == 127 for char in release_id)
            ):
                raise ConfigurationError(
                    "Auth activation requires a valid APP_RELEASE_ID."
                )
        if app_env == "production":
            for name in ("PASSWORD_BLOCKLIST_PATH", "PASSWORD_RESET_HMAC_PATH"):
                if values.get(name) and not Path(values[name]).is_absolute():
                    raise ConfigurationError(
                        "Production supply paths must be absolute."
                    )

        try:
            return cls(
                app_env=app_env,
                database_path=path,
                public_origin=origin,
                password_reset_hmac_path=Path(environment["PASSWORD_RESET_HMAC_PATH"])
                if environment.get("PASSWORD_RESET_HMAC_PATH")
                else None,
                password_blocklist_path=Path(
                    values.get("PASSWORD_BLOCKLIST_PATH")
                    or path.parent / "password-blocklist-ncsc.txt"
                ).resolve(),
                health_checks_enabled=health_enabled == "true",
                health_dns_servers=dns_servers,
                health_denied_ips=denied_ips,
                health_worker_uid=worker_uid,
                health_worker_lock_path=health_lock,
                health_activation_path=health_activation,
                auth_activation_path=auth_activation,
                app_release_id=release_id,
            )
        except ValidationError:
            raise ConfigurationError("Application configuration is invalid.") from None

    def validate_production_runtime(self) -> None:
        if self.app_env != "production":
            return
        # Explicit Settings/model_copy must meet the same process-config invariants.
        Settings.from_environment(
            {
                "APP_ENV": "production",
                "DATABASE_PATH": str(self.database_path),
                "PUBLIC_ORIGIN": self.public_origin,
                "AUTH_ACTIVATION_PATH": str(self.auth_activation_path)
                if self.auth_activation_path
                else "",
                "APP_RELEASE_ID": self.app_release_id or "",
                "PASSWORD_BLOCKLIST_PATH": str(self.password_blocklist_path)
                if self.password_blocklist_path
                else "",
                "PASSWORD_RESET_HMAC_PATH": str(self.password_reset_hmac_path)
                if self.password_reset_hmac_path
                else "",
            }
        )
        try:
            private_directory(self.database_path.parent)
            for path in (
                self.database_path,
                Path(f"{self.database_path}-wal"),
                Path(f"{self.database_path}-shm"),
            ):
                if (
                    path != self.database_path
                    and not path.exists()
                    and not path.is_symlink()
                ):
                    continue
                descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    private_file(os.fstat(descriptor))
                finally:
                    os.close(descriptor)
        except (OSError, ValueError):
            raise ConfigurationError("Production storage is invalid.") from None


def production_path(path: Path, *, repo_root: Path = ROOT) -> None:
    temporary_roots = {
        Path(tempfile.gettempdir()),
        Path("/tmp"),
        Path("/var/tmp"),
        Path("/dev/shm"),
    }
    if not path.is_absolute():
        raise ConfigurationError("Production paths must be absolute.")
    if path != path.resolve():
        raise ConfigurationError("Production paths must be canonical without symlinks.")
    if path.is_relative_to(repo_root.resolve()):
        raise ConfigurationError("Production paths must be outside the repository.")
    if any(path.is_relative_to(root.resolve()) for root in temporary_roots):
        raise ConfigurationError(
            "Production paths must be outside the temporary directory."
        )


def private_file(metadata) -> None:
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise ValueError("Private file permissions are invalid.")


def private_directory(path: Path) -> None:
    metadata = path.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        raise ValueError("Private directory permissions are invalid.")
    for parent in path.parents:
        metadata = parent.lstat()
        # Root-owned sticky temp roots support only synthetic test fixtures.
        sticky_root = (
            parent in {Path("/tmp"), Path("/var/tmp"), Path("/dev/shm")}
            and metadata.st_uid == 0
            and bool(metadata.st_mode & stat.S_ISVTX)
        )
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid not in {0, os.geteuid()}
            or (metadata.st_mode & 0o022 and not sticky_root)
        ):
            raise ValueError("Untrusted storage ancestor.")
