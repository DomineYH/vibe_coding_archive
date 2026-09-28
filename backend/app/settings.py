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


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    app_env: Literal["development", "test", "production"]
    database_path: Path
    public_origin: str

    @classmethod
    def from_environment(
        cls,
        environment: Mapping[str, str] = os.environ,
        *,
        repo_root: Path = ROOT,
        backend_root: Path = BACKEND_ROOT,
    ) -> Settings:
        app_env = environment.get("APP_ENV")
        if app_env not in {"development", "test", "production"}:
            raise ConfigurationError("APP_ENV must be set to a supported environment.")

        values = (
            dotenv_values(backend_root / ".env") if app_env == "development" else {}
        )
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
        try:
            parsed = urlsplit(origin)
            port = parsed.port
            hostname = parsed.hostname
        except ValueError:
            raise ConfigurationError(
                "PUBLIC_ORIGIN must be one exact HTTP origin."
            ) from None
        if (
            parsed.scheme not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or "?" in origin
            or "#" in origin
            or parsed.netloc.endswith(":")
            or port == 0
            or not hostname.rstrip(".")
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

        try:
            return cls(
                app_env=app_env,
                database_path=path,
                public_origin=origin,
            )
        except ValidationError:
            raise ConfigurationError("Application configuration is invalid.") from None
