from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Request
from pydantic import AnyUrl, BaseModel, ConfigDict, Field, WithJsonSchema
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.database import (
    current_head,
    current_revision,
    make_engine,
    make_session_factory,
)
from app.settings import ConfigurationError, Settings

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "contracts" / "catalog.json").read_text())
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
            "enabled": False,
            "reasons": (
                COLLECTION_DISABLED if key.endswith("_collection") else NOT_IMPLEMENTED
            ),
        }
        for key in keys
    }


def _verify_schema(engine) -> str:
    head = current_head()
    if not head or current_revision(engine) != head:
        raise RuntimeError("Database migration revision is not current.") from None
    return head


def create_app(settings: Settings | None = None) -> FastAPI:
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

        app.state.engine = engine
        app.state.expected_head = head
        app.state.session_factory = make_session_factory(engine)
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    api = APIRouter(prefix="/api/v1")

    @api.get("/meta", response_model=MetaResponse)
    def get_meta() -> dict[str, object]:
        return {
            "subjects": CATALOG["subjects"],
            "grades": CATALOG["grades"],
            "themes": CATALOG["themes"],
            "server_time": datetime.now(UTC),
            "capabilities": _capabilities(),
            "support": {
                "email": None,
                "service_url": None,
                "announcement_url": None,
            },
            "initial_pending_days": 90,
        }

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
        session: Annotated[Session, Depends(_get_session)],
    ) -> ReadyResponse | JSONResponse:
        try:
            revision = session.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            if revision != request.app.state.expected_head:
                raise RuntimeError("Migration revision does not match the head.")
        except (SQLAlchemyError, RuntimeError):
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready"},
            )
        return ReadyResponse(status="ready")

    return app


def _get_session(request: Request):
    factory = request.app.state.session_factory
    with factory() as session:
        yield session


app = create_app()
