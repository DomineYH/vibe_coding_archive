from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, WithJsonSchema
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from app.auth import router as auth_router
from app.auth_boundary import (
    AuthBodyLimit,
    AuthError,
    error_response,
    invalid_cookie_names,
)
from app.auth_login import HashGate
from app.auth_login import router as login_router
from app.auth_maintenance import reconcile, sweep
from app.auth_password import router as password_router
from app.catalog import CATALOG
from app.database import (
    current_head,
    current_revision,
    get_session,
    make_engine,
    make_session_factory,
)
from app.password_policy import load_blocklist
from app.public_apps import router as public_apps_router
from app.settings import ConfigurationError, Settings

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
    settings: Settings | None = None, *, auth_testing: bool = False
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = None
        try:
            resolved = settings or Settings.from_environment()
            engine = make_engine(resolved.database_path)
            head = _verify_schema(engine)
        except (ConfigurationError, SQLAlchemyError, RuntimeError):
            if engine is not None:
                engine.dispose()
            print(
                "Application configuration or database revision is invalid.",
                file=sys.stderr,
            )
            raise RuntimeError(
                "Application configuration or database revision is invalid."
            ) from None

        if auth_testing and resolved.app_env != "test":
            engine.dispose()
            raise RuntimeError("Authentication test boundary requires APP_ENV=test.")
        app.state.settings = resolved
        app.state.auth_testing = auth_testing
        app.state.auth_ready = False
        if auth_testing:
            try:
                app.state.password_blocklist = load_blocklist(
                    resolved.password_blocklist_path
                )
            except RuntimeError:
                engine.dispose()
                raise
        app.state.hash_gate = HashGate()
        app.state.engine = engine
        app.state.expected_head = head
        app.state.session_factory = make_session_factory(engine)
        verification_failed = False
        try:
            reconcile(app.state.session_factory)
            sweep(app.state.session_factory)
            app.state.auth_ready = True
        except RuntimeError:
            verification_failed = True
        except (SQLAlchemyError, AuthError):
            app.state.auth_ready = False

        async def maintain_auth():
            nonlocal verification_failed
            while True:
                await asyncio.sleep(60)
                try:
                    await asyncio.to_thread(sweep, app.state.session_factory)
                    if not app.state.auth_ready and not verification_failed:
                        await asyncio.to_thread(reconcile, app.state.session_factory)
                        app.state.auth_ready = True
                except RuntimeError:
                    # #113 latches verification failures; transient failures retry with reconciliation.
                    verification_failed = True
                    app.state.auth_ready = False
                except Exception:  # noqa: BLE001 - A maintenance failure must not stop future cycles.
                    app.state.auth_ready = False

        maintenance = asyncio.create_task(maintain_auth())
        try:
            yield
        finally:
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
        if request.url.path.startswith("/api/v1/auth/"):
            return error_response(
                AuthError("BAD_REQUEST", 400)
                if any(item["type"] == "json_invalid" for item in error.errors())
                else AuthError("VALIDATION_ERROR", 422)
            )
        from fastapi.exception_handlers import request_validation_exception_handler

        return await request_validation_exception_handler(request, error)

    @app.exception_handler(HTTPException)
    async def handle_http_error(request, error):
        if request.url.path.startswith("/api/v1/auth/") and error.status_code == 400:
            return error_response(AuthError("BAD_REQUEST", 400))
        from fastapi.exception_handlers import http_exception_handler

        return await http_exception_handler(request, error)

    api = APIRouter(prefix="/api/v1")

    @api.get("/meta", response_model=MetaResponse)
    def get_meta(request: Request) -> dict[str, object]:
        capabilities = _capabilities()
        if request.app.state.auth_testing and request.app.state.auth_ready:
            # #113: the verified T01–T03 test bundle; ordinary runs stay off.
            for key in ("auth_login", "auth_logout", "auth_password_change"):
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

    api.include_router(auth_router)
    api.include_router(login_router)
    api.include_router(password_router)
    api.include_router(public_apps_router)
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
