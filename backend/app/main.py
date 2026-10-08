from __future__ import annotations

import asyncio
import sqlite3
import sys
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from pydantic import (
    AnyUrl,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    WithJsonSchema,
)
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from app import health_store
from app.admin_approval import router as admin_approval_router
from app.admin_apps import router as admin_apps_router
from app.admin_password_reset import router as password_reset_router
from app.admin_user_delete import router as user_delete_router
from app.app_create import router as app_create_router
from app.app_delete import router as app_delete_router
from app.app_input import AppInput
from app.app_update import router as app_update_router
from app.auth import router as auth_router
from app.auth_boundary import (
    READ_CONTEXT_PARAMETERS,
    AuthBodyLimit,
    AuthError,
    app_patch_path,
    error_response,
    invalid_cookie_names,
    read_context,
)
from app.auth_login import HashGate
from app.auth_login import router as login_router
from app.auth_maintenance import reconcile, sweep
from app.auth_password import router as password_router
from app.auth_reauth import router as reauth_router
from app.auth_register import router as register_router
from app.auth_runtime import auth_available, load_candidate_blocklist
from app.auth_runtime import runtime_enabled as auth_runtime_enabled
from app.catalog import CATALOG
from app.database import (
    current_head,
    current_revision,
    get_session,
    make_engine,
    make_session_factory,
)
from app.health_api import router as health_router
from app.health_runtime import boot_clock, checks_available, runtime_enabled
from app.password_policy import load_blocklist
from app.password_reset_secret import ResetSecretGate
from app.public_apps import ErrorEnvelope
from app.public_apps import router as public_apps_router
from app.settings import ConfigurationError, Settings
from app.user_deletion_ledger import prepare as prepare_user_delete

NOT_IMPLEMENTED = ["not_implemented"]
COLLECTION_DISABLED = ["collection_disabled"]
Subject = Literal[*CATALOG["subjects"]]
Grade = Literal[*CATALOG["grades"]]
Uri = Annotated[AnyUrl, WithJsonSchema({"type": "string", "format": "uri"})]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Theme(StrictModel):
    id: str
    name: str
    pantone: str
    from_: str = Field(alias="from", pattern=r"^#[0-9A-Fa-f]{6}$")
    to: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    ink: Literal["dark", "light"]


class Capability(StrictModel):
    enabled: bool
    reasons: list[
        Literal[
            "not_implemented",
            "verification_pending",
            "operational_restriction",
            "collection_disabled",
        ]
    ]


class Capabilities(StrictModel):
    apps_read: Capability
    auth_register: Capability
    auth_login: Capability
    auth_logout: Capability
    auth_password_change: Capability
    admin_users_read: Capability
    admin_approval: Capability
    admin_summary: Capability
    apps_create: Capability
    apps_update_own: Capability
    apps_delete_own: Capability
    admin_apps_read: Capability
    admin_apps_manage: Capability
    admin_reauth: Capability
    admin_password_reset: Capability
    admin_user_delete: Capability
    health_read: Capability
    health_check: Capability
    health_batch: Capability
    email_collection: Capability
    phone_collection: Capability


class Support(StrictModel):
    email: str | None
    service_url: Uri | None
    announcement_url: Uri | None


class MetaResponse(StrictModel):
    subjects: list[Subject]
    grades: list[Grade]
    themes: list[Theme]
    server_time: datetime
    capabilities: Capabilities
    support: Support
    initial_pending_days: int = Field(ge=1)


class LivenessResponse(StrictModel):
    status: Literal["ok"]


class ReadyResponse(StrictModel):
    status: Literal["ready"]


class NotReadyResponse(StrictModel):
    status: Literal["not_ready"]


def _capabilities() -> dict[str, dict[str, object]]:
    keys = Capabilities.model_fields
    return {
        key: {
            "enabled": key == "apps_read",
            "reasons": (
                []
                if key == "apps_read"
                else COLLECTION_DISABLED
                if key.endswith("_collection")
                else NOT_IMPLEMENTED
            ),
        }
        for key in keys
    }


def _verify_schema(engine) -> str:
    head = current_head()
    if not head or current_revision(engine) != head:
        raise RuntimeError("Database migration revision is not current.") from None
    return head


def create_app(
    settings: Settings | None = None,
    *,
    auth_testing: bool = False,
    health_testing: bool = False,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = None
        try:
            resolved = Settings.model_validate(
                (settings or Settings.from_environment()).model_dump()
            )
            if auth_testing and resolved.app_env != "test":
                raise RuntimeError(
                    "Authentication test boundary requires APP_ENV=test."
                )
            if health_testing and resolved.app_env != "test":
                raise RuntimeError("Health test boundary requires APP_ENV=test.")
            if resolved.app_env == "test":
                Settings.from_environment(
                    {
                        "APP_ENV": "test",
                        "DATABASE_PATH": str(resolved.database_path),
                        "PUBLIC_ORIGIN": resolved.public_origin,
                    }
                )
            resolved.validate_production_runtime()
            engine = make_engine(resolved.database_path)
            head = _verify_schema(engine)
        except (
            ConfigurationError,
            ValidationError,
            SQLAlchemyError,
            RuntimeError,
        ) as error:
            if engine is None and str(error) in {
                "Authentication test boundary requires APP_ENV=test.",
                "Health test boundary requires APP_ENV=test.",
            }:
                raise
            if engine is not None:
                engine.dispose()
            print(
                "Application configuration or database revision is invalid.",
                file=sys.stderr,
            )
            raise RuntimeError(
                "Application configuration or database revision is invalid."
            ) from None

        app.state.health_testing = health_testing
        app.state.settings = resolved
        app.state.auth_candidate = resolved.app_env == "production"
        app.state.auth_revoked = False
        app.state.auth_enabled = (
            auth_testing
            or resolved.app_env == "development"
            or auth_runtime_enabled(resolved)
        )
        app.state.user_delete_corrupt = False
        app.state.user_delete_ready = False
        app.state.auth_ready = False
        if app.state.auth_enabled:
            try:
                app.state.password_blocklist = (
                    load_candidate_blocklist(resolved.password_blocklist_path)
                    if resolved.app_env == "production"
                    else load_blocklist(resolved.password_blocklist_path)
                )
            except (RuntimeError, OSError, ValueError, TypeError):
                engine.dispose()
                if resolved.app_env == "development":
                    raise RuntimeError(
                        "Authentication requires a verified password blocklist. "
                        "From backend/, run: APP_ENV=development uv run --frozen "
                        "python -m app.cli prepare-password-blocklist"
                    ) from None
                raise RuntimeError(
                    "A verified password blocklist is required."
                ) from None
        app.state.hash_gate = HashGate()
        app.state.engine = engine
        app.state.expected_head = head
        app.state.session_factory = make_session_factory(engine)
        verification_failed = False
        try:
            reconcile(app.state.session_factory)
            sweep(app.state.session_factory)
            app.state.user_delete_ready = (
                prepare_user_delete(app.state.session_factory) is not None
            )
            app.state.auth_ready = True
        except RuntimeError:
            verification_failed = True
        except (SQLAlchemyError, AuthError, sqlite3.Error):
            app.state.auth_ready = False

        app.state.password_reset_gate = ResetSecretGate(
            resolved.password_reset_hmac_path,
            app.state.session_factory,
            app.state.auth_enabled,
        )

        async def maintain_auth():
            nonlocal verification_failed
            while True:
                await asyncio.sleep(60)
                await asyncio.to_thread(app.state.password_reset_gate.maintain)
                try:
                    await asyncio.to_thread(sweep, app.state.session_factory)
                    app.state.user_delete_ready = (
                        await asyncio.to_thread(
                            prepare_user_delete, app.state.session_factory
                        )
                        is not None
                    )
                    verification_failed = (
                        verification_failed or app.state.user_delete_corrupt
                    )
                    if not app.state.auth_ready and not verification_failed:
                        await asyncio.to_thread(reconcile, app.state.session_factory)
                        app.state.auth_ready = True
                except RuntimeError:
                    # #113 latches verification failures; transient failures retry with reconciliation.
                    verification_failed = True
                    app.state.auth_ready = False
                except Exception:  # noqa: BLE001 - A maintenance failure must not stop future cycles.
                    app.state.auth_ready = False

        def health_maintenance_cycle():
            with app.state.session_factory() as db:
                db.execute(text("BEGIN IMMEDIATE"))
                boot_id, mono = boot_clock()
                stamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")
                if not app.state.health_testing and not runtime_enabled(resolved):
                    health_store.cancel_all(db, stamp)
                health_store.maintain(
                    db,
                    boot_id=boot_id,
                    mono=mono,
                    stamp=stamp,
                )
                db.commit()

        async def health_maintenance_once():
            try:
                await asyncio.to_thread(health_maintenance_cycle)
            except Exception:  # noqa: BLE001 - Retry transient maintenance failures.
                print(
                    "Health maintenance failed; retrying next cycle.", file=sys.stderr
                )

        async def maintain_health():
            while True:
                await asyncio.sleep(5)
                await health_maintenance_once()

        await health_maintenance_once()
        maintenance = asyncio.create_task(maintain_auth())
        health_maintenance = asyncio.create_task(maintain_health())
        try:
            yield
        finally:
            health_maintenance.cancel()
            with suppress(asyncio.CancelledError):
                await health_maintenance
            maintenance.cancel()
            with suppress(asyncio.CancelledError):
                await maintenance
            engine.dispose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    app.add_middleware(AuthBodyLimit)

    @app.exception_handler(AuthError)
    def handle_auth_error(request, error):
        result = error_response(error)
        if error.code == "AUTH_COOKIE_BUDGET_EXCEEDED":
            try:
                with request.app.state.session_factory() as session:
                    for name in invalid_cookie_names(session, request):
                        result.delete_cookie(
                            name,
                            path="/",
                            secure=name.startswith("__Host-"),
                            httponly=True,
                            samesite="lax",
                        )
            except SQLAlchemyError as failure:
                code = (
                    "DB_BUSY"
                    if "locked" in str(failure).lower()
                    else "SERVICE_UNAVAILABLE"
                )
                return error_response(AuthError(code, 503))
        return result

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request, error):
        if (
            request.url.path.startswith(
                ("/api/v1/auth/", "/api/v1/admin/", "/api/v1/write-operations")
            )
            or (request.method == "POST" and request.url.path == "/api/v1/apps")
            or (
                request.method in ("PATCH", "DELETE")
                and app_patch_path(request.url.path)
            )
        ):
            return error_response(
                AuthError("BAD_REQUEST", 400)
                if any(item["type"] == "json_invalid" for item in error.errors())
                else AuthError(
                    "VALIDATION_ERROR",
                    422,
                    fields={
                        str(
                            next(
                                (
                                    part
                                    for part in item["loc"]
                                    if part in AppInput.model_fields
                                ),
                                "form",
                            )
                        ): "입력 내용을 확인해 주세요."
                        for item in error.errors()
                    }
                    if request.url.path in ("/api/v1/apps", "/api/v1/write-operations")
                    or (
                        request.method in ("PATCH", "DELETE")
                        and app_patch_path(request.url.path)
                    )
                    else None,
                )
            )
        from fastapi.exception_handlers import request_validation_exception_handler

        return await request_validation_exception_handler(request, error)

    @app.exception_handler(HTTPException)
    async def handle_http_error(request, error):
        if (
            request.url.path.startswith(
                ("/api/v1/auth/", "/api/v1/admin/", "/api/v1/write-operations")
            )
            or (request.method == "POST" and request.url.path == "/api/v1/apps")
            or (
                request.method in ("PATCH", "DELETE")
                and app_patch_path(request.url.path)
            )
        ) and error.status_code == 400:
            return error_response(AuthError("BAD_REQUEST", 400))
        from fastapi.exception_handlers import http_exception_handler

        return await http_exception_handler(request, error)

    api = APIRouter(prefix="/api/v1")

    @api.get(
        "/meta",
        response_model=MetaResponse,
        openapi_extra={"parameters": READ_CONTEXT_PARAMETERS},
        responses={422: {"model": ErrorEnvelope}},
    )
    def get_meta(request: Request) -> dict[str, object]:
        read_context(request)
        auth_decision = auth_available(request.app.state)
        capabilities = _capabilities()
        if request.app.state.auth_candidate and not auth_decision:
            for key in capabilities.keys() - {
                "apps_read",
                "health_read",
                "email_collection",
                "phone_collection",
            }:
                capabilities[key] = {
                    "enabled": False,
                    "reasons": ["operational_restriction"],
                }
        capabilities["health_read"] = {"enabled": True, "reasons": []}
        try:
            with request.app.state.session_factory() as db:
                health_enabled = checks_available(
                    db, request, auth_decision=auth_decision
                )
        except (SQLAlchemyError, OSError):
            health_enabled = False
        for key in ("health_check", "health_batch"):
            capabilities[key] = {
                "enabled": health_enabled,
                "reasons": [] if health_enabled else ["operational_restriction"],
            }
        gate = request.app.state.password_reset_gate
        gate.maintain()
        capabilities["admin_password_reset"] = {
            "enabled": bool(auth_decision and gate.ready),
            "reasons": []
            if auth_decision and gate.ready
            else ["operational_restriction"],
        }
        delete_enabled = bool(auth_decision and request.app.state.user_delete_ready)
        capabilities["admin_user_delete"] = {
            "enabled": delete_enabled,
            "reasons": [] if delete_enabled else ["operational_restriction"],
        }
        capabilities["admin_apps_read"] = {
            "enabled": False,
            "reasons": ["operational_restriction"],
        }
        capabilities["admin_apps_manage"] = {
            "enabled": False,
            "reasons": ["operational_restriction"],
        }
        if auth_decision:
            # Candidate approval never substitutes for the operating release gate.
            for key in (
                "auth_login",
                "auth_logout",
                "auth_password_change",
                "auth_register",
                "admin_reauth",
                "admin_users_read",
                "admin_approval",
                "admin_apps_read",
                "admin_apps_manage",
                "admin_summary",
                "apps_create",
                "apps_update_own",
                "apps_delete_own",
            ):
                capabilities[key] = {"enabled": True, "reasons": []}
        return {
            "subjects": CATALOG["subjects"],
            "grades": CATALOG["grades"],
            "themes": CATALOG["themes"],
            "server_time": datetime.now(UTC),
            "capabilities": capabilities,
            "support": {
                "email": None,
                "service_url": None,
                "announcement_url": None,
            },
            "initial_pending_days": 90,
        }

    api.include_router(health_router)
    api.include_router(auth_router)
    api.include_router(login_router)
    api.include_router(password_router)
    api.include_router(reauth_router)
    api.include_router(register_router)
    api.include_router(admin_approval_router)
    api.include_router(admin_apps_router)
    api.include_router(password_reset_router)
    api.include_router(user_delete_router)
    api.include_router(public_apps_router)
    api.include_router(app_create_router)
    api.include_router(app_update_router)
    api.include_router(app_delete_router)
    app.include_router(api)

    @app.get("/healthz", response_model=LivenessResponse)
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(
        "/readyz",
        response_model=ReadyResponse,
        responses={503: {"model": NotReadyResponse}},
    )
    def readyz(
        request: Request,
        session: Annotated[Session, Depends(get_session)],
    ) -> ReadyResponse | JSONResponse:
        try:
            revision = session.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if (
                revision != request.app.state.expected_head
                or not request.app.state.auth_ready
            ):
                raise RuntimeError("Migration revision does not match the head.")
        except (SQLAlchemyError, RuntimeError):
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready"},
            )
        return ReadyResponse(status="ready")

    return app


app = create_app()
