from __future__ import annotations

import ipaddress
import os
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

    @classmethod
    def from_environment(
        cls,
        environment: Mapping[str, str] = os.environ,
        *,
        repo_root: Path = ROOT,
        backend_root: Path = BACKEND_ROOT,
    ) -> Settings:
        process_app_env = environment.get("APP_ENV")
        values = (
            {} if process_app_env == "test" else dotenv_values(backend_root / ".env")
        )
        app_env = process_app_env or values.get("APP_ENV")
        if not process_app_env and app_env == "test":
            raise ConfigurationError(
                "APP_ENV=test must be set in the process environment."
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
            try:
                path.relative_to(temporary_root)
            except ValueError:
                pass
            else:
                raise ConfigurationError(
                    "Production databases must be outside the temporary directory."
                )

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
                loopback = ipaddress.ip_address(normalized_hostname).is_loopback
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
            )
        except ValidationError:
            raise ConfigurationError("Application configuration is invalid.") from None
