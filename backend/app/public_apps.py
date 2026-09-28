from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import (
    AnyUrl,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    WithJsonSchema,
    field_validator,
)
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload
from starlette.responses import JSONResponse

from app.catalog import CATALOG
from app.database import get_session
from app.models import App

Subject = Literal[*CATALOG["subjects"]]
Grade = Literal[*CATALOG["grades"]]
Uri = Annotated[str, WithJsonSchema({"type": "string", "format": "uri"})]
Facets = Annotated[
    dict[str, list[Subject]],
    WithJsonSchema(
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["subjects_in_use"],
            "properties": {
                "subjects_in_use": {
                    "type": "array",
                    "items": {"type": "string", "enum": CATALOG["subjects"]},
                }
            },
        }
    ),
]
router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Owner(StrictModel):
    id: UUID
    nickname: str


class HealthResult(StrictModel):
    state: Literal[
        "unchecked",
        "healthy",
        "http_error",
        "timeout",
        "network_error",
        "blocked",
        "redirect_error",
    ]
    checked_at: datetime | None
    fresh_until: datetime | None


class Job(StrictModel):
    id: UUID
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    failure_code: str | None


def _health_view_schema(schema: dict[str, object]) -> None:
    properties = schema["properties"]
    if isinstance(properties, dict):
        latest_job = properties["latest_job"]
        if isinstance(latest_job, dict):
            variants = latest_job.pop("anyOf")
            if isinstance(variants, list):
                latest_job["oneOf"] = sorted(
                    variants,
                    key=lambda variant: 0 if variant.get("type") == "null" else 1,
                )


class HealthView(StrictModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra=_health_view_schema)

    result: HealthResult
    latest_job: Job | None
    next_check_at: datetime | None


class AppCard(StrictModel):
    id: UUID
    owner: Owner
    name: str
    subject: Subject
    grades: list[Grade]
    is_public: bool
    theme_id: str
    version: int = Field(ge=1)
    url_version: int = Field(ge=1)
    health: HealthView


class Pagination(StrictModel):
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
    total: int = Field(ge=0)
    has_more: bool


class AppPage(StrictModel):
    items: list[AppCard]
    pagination: Pagination
    server_time: datetime
    facets: Facets

    @field_validator("facets")
    @classmethod
    def only_subjects_in_use(
        cls, facets: dict[str, list[Subject]]
    ) -> dict[str, list[Subject]]:
        if set(facets) != {"subjects_in_use"}:
            raise ValueError("Invalid public app facets.")
        return facets


class AppDetail(AppCard):
    url: Uri
    prompt: str
    description: str
    stack_db: str | None
    stack_backend: str | None
    stack_frontend: str | None
    stack_hosting: str | None
    created_at: datetime
    updated_at: datetime


class AppDetailResponse(StrictModel):
    item: AppDetail
    server_time: datetime


class Error(StrictModel):
    code: str
    message: str
    fields: dict[str, str] = Field(default_factory=dict)
    request_id: str | None
    reasons: list[str] = Field(default_factory=list)
    retry_at: datetime | None = None
    server_time: datetime | None = None


class ErrorEnvelope(StrictModel):
    error: Error


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": None,
            }
        },
    )


def _not_found() -> JSONResponse:
    return _error(404, "NOT_FOUND", "요청한 자료를 찾을 수 없습니다.")


def _server_unavailable() -> JSONResponse:
    return _error(503, "SERVICE_UNAVAILABLE", "자료를 불러올 수 없습니다.")


def _utc_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Database timestamps must include a UTC offset.")
    return parsed.astimezone(UTC)


def _health_view(app: App) -> dict[str, object]:
    result = app.health_result
    return {
        "result": {
            "state": result.state if result else "unchecked",
            "checked_at": _utc_datetime(result.checked_at) if result else None,
            "fresh_until": _utc_datetime(result.fresh_until) if result else None,
        },
        "latest_job": None,
        "next_check_at": None,
    }


def _app_card(app: App) -> dict[str, object]:
    grades = {grade.grade for grade in app.grades}
    return {
        "id": app.id,
        "owner": {"id": app.owner.id, "nickname": app.owner.nickname},
        "name": app.name,
        "subject": app.subject,
        "grades": [grade for grade in CATALOG["grades"] if grade in grades],
        "is_public": app.is_public,
        "theme_id": app.theme_id,
        "version": app.version,
        "url_version": app.url_version,
        "health": _health_view(app),
    }


def _app_detail(app: App) -> dict[str, object]:
    AnyUrl(app.url)
    return {
        **_app_card(app),
        "url": app.url,
        "prompt": app.prompt,
        "description": app.description,
        "stack_db": app.stack_db,
        "stack_backend": app.stack_backend,
        "stack_frontend": app.stack_frontend,
        "stack_hosting": app.stack_hosting,
        "created_at": _utc_datetime(app.created_at),
        "updated_at": _utc_datetime(app.updated_at),
    }


def _parse_page_number(value: str | None, default: int) -> int:
    if value is None:
        return default
    if not re.fullmatch(r"[0-9]+", value, flags=re.ASCII):
        raise ValueError
    return int(value)


@router.get(
    "/apps",
    operation_id="listPublicApps",
    summary="List public archive apps",
    response_model=AppPage,
    responses={
        400: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def list_public_apps(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> AppPage | JSONResponse:
    parameters = request.query_params.multi_items()
    keys = [key for key, _value in parameters]
    if len(keys) != len(set(keys)) or any(
        key not in {"limit", "offset"} for key in keys
    ):
        return _error(400, "INVALID_QUERY", "목록 조건이 올바르지 않습니다.")
    query = dict(parameters)
    try:
        limit = _parse_page_number(query.get("limit"), 24)
        offset = _parse_page_number(query.get("offset"), 0)
        if not 1 <= limit <= 100:
            raise ValueError

        total = session.scalar(
            select(func.count()).select_from(App).where(App.is_public.is_(True))
        )
        apps = session.scalars(
            select(App)
            .options(
                selectinload(App.owner),
                selectinload(App.grades),
                selectinload(App.health_result),
            )
            .where(App.is_public.is_(True))
            .order_by(App.created_at.desc(), App.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        subjects = session.scalars(
            select(App.subject).where(App.is_public.is_(True)).distinct()
        ).all()
        page = AppPage.model_validate(
            {
                "items": [_app_card(app) for app in apps],
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "total": total or 0,
                    "has_more": offset + len(apps) < (total or 0),
                },
                "server_time": datetime.now(UTC),
                "facets": {
                    "subjects_in_use": [
                        subject
                        for subject in CATALOG["subjects"]
                        if subject in subjects
                    ]
                },
            }
        )
    except ValueError:
        return _error(400, "INVALID_QUERY", "목록 조건이 올바르지 않습니다.")
    except (SQLAlchemyError, ValidationError):
        return _server_unavailable()
    return page


@router.get(
    "/apps/{id}",
    operation_id="getApp",
    summary="Read an archive app available to the current member",
    response_model=AppDetailResponse,
    responses={
        401: {"model": ErrorEnvelope},
        403: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_public_app(
    id: str,
    session: Annotated[Session, Depends(get_session)],
) -> AppDetailResponse | JSONResponse:
    try:
        app_id = str(UUID(id))
    except ValueError:
        return _not_found()
    try:
        app = session.scalar(
            select(App)
            .options(
                selectinload(App.owner),
                selectinload(App.grades),
                selectinload(App.health_result),
            )
            .where(App.id == app_id, App.is_public.is_(True))
        )
        if app is None:
            return _not_found()
        return AppDetailResponse.model_validate(
            {
                "item": _app_detail(app),
                "server_time": datetime.now(UTC),
            }
        )
    except (SQLAlchemyError, ValidationError, ValueError):
        return _server_unavailable()
