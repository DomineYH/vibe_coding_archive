from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal
from unicodedata import normalize
from urllib.parse import parse_qsl
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi import Path as ApiPath
from pydantic import (
    AnyUrl,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    WithJsonSchema,
)
from sqlalchemy import or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, load_only, selectinload
from starlette.responses import JSONResponse

from app.auth_boundary import (
    READ_CONTEXT_PARAMETERS,
    AuthError,
    read_context,
    response,
    screen_activity,
    screen_read_context,
)
from app.catalog import CATALOG
from app.database import get_session
from app.models import App, AppGrade, Member
from app.models import HealthResult as HealthResultRow

UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
    r"[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)

Subject = Literal[*CATALOG["subjects"]]
Grade = Literal[*CATALOG["grades"]]
Uri = Annotated[str, WithJsonSchema({"type": "string", "format": "uri"})]
SubjectFilter = Annotated[
    str | None,
    Query(description="Empty omits the filter; otherwise use one catalog value."),
    WithJsonSchema(
        {
            "anyOf": [
                {"type": "string", "enum": [""]},
                {"type": "string", "enum": CATALOG["subjects"]},
            ]
        }
    ),
]
GradeFilter = Annotated[
    str | None,
    Query(description="Empty omits the filter; otherwise use one catalog value."),
    WithJsonSchema(
        {
            "anyOf": [
                {"type": "string", "enum": [""]},
                {"type": "string", "enum": CATALOG["grades"]},
            ]
        }
    ),
]
router = APIRouter()
QUERY_KEYS = {"q", "subject", "grade", "limit", "offset"}
SEARCH_TRIM = " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


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


class Facets(StrictModel):
    subjects_in_use: list[Subject]


class AppPage(StrictModel):
    items: list[AppCard]
    pagination: Pagination
    server_time: datetime
    facets: Facets


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


def _error(
    status: int,
    code: str,
    message: str,
    fields: dict[str, str] | None = None,
) -> JSONResponse:
    error = {"code": code, "message": message, "request_id": None}
    if fields is not None:
        error["fields"] = fields
    return JSONResponse(
        status_code=status,
        content={"error": error},
    )


def _not_found() -> JSONResponse:
    result = _error(404, "NOT_FOUND", "요청한 자료를 찾을 수 없습니다.")
    result.headers["Cache-Control"] = "private, no-store"
    return result


def _server_unavailable() -> JSONResponse:
    return _error(503, "SERVICE_UNAVAILABLE", "자료를 불러올 수 없습니다.")


def _invalid_query(fields: dict[str, str]) -> JSONResponse:
    return _error(400, "VALIDATION_ERROR", "목록 조건이 올바르지 않습니다.", fields)


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


def _parse_raw_query(request: Request) -> list[tuple[str, str]] | None:
    try:
        query = request.scope["query_string"].decode("utf-8")
        if re.search(r"%(?![0-9a-f]{2})", query, flags=re.IGNORECASE):
            return None
        query = "&".join(
            f"{part}=" if part and "=" not in part else part
            for part in query.split("&")
        )
        return parse_qsl(
            query,
            keep_blank_values=True,
            strict_parsing=True,
            encoding="utf-8",
            errors="strict",
        )
    except (UnicodeDecodeError, ValueError):
        return None


def _fold_search_value(value: str) -> str:
    return normalize("NFC", value).casefold()


@router.get(
    "/apps",
    operation_id="listPublicApps",
    openapi_extra={"parameters": READ_CONTEXT_PARAMETERS},
    summary="List public archive apps",
    response_model=AppPage,
    responses={
        400: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def list_public_apps(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[
        str | int,
        Query(
            description="Page size; defaults to 24 and cannot exceed 100.",
        ),
        WithJsonSchema(
            {"type": "integer", "minimum": 1, "maximum": 100, "default": 24}
        ),
    ] = 24,
    offset: Annotated[
        str | int,
        Query(
            description="Zero-based offset. A valid offset past the result count returns an empty page.",
        ),
        WithJsonSchema({"type": "integer", "minimum": 0, "default": 0}),
    ] = 0,
    q: Annotated[
        str | None,
        Query(description="Search app names, author nicknames, and descriptions."),
        WithJsonSchema({"type": "string"}),
    ] = None,
    subject: SubjectFilter = None,
    grade: GradeFilter = None,
) -> AppPage | JSONResponse:
    parameters = _parse_raw_query(request)
    if parameters is None:
        return _invalid_query({"query": "쿼리 형식이 올바르지 않습니다."})
    keys = [key for key, _value in parameters]
    seen: set[str] = set()
    invalid_keys: set[str] = set()
    for key in keys:
        if key in seen or key not in QUERY_KEYS:
            invalid_keys.add(key)
        seen.add(key)
    if invalid_keys:
        return _invalid_query(
            {key: "지원하지 않거나 중복된 입력입니다." for key in invalid_keys}
        )
    query = dict(parameters)
    folded_query = _fold_search_value(query.get("q", "").strip(SEARCH_TRIM))
    if len(folded_query) > 100:
        return _invalid_query({"q": "정규화 후 100자 이하여야 합니다."})
    folded_query = folded_query or None
    subject_filter = query.get("subject") or None
    grade_filter = query.get("grade") or None
    invalid_filters = {}
    if subject_filter and subject_filter not in CATALOG["subjects"]:
        invalid_filters["subject"] = "지원하지 않는 과목입니다."
    if grade_filter and grade_filter not in CATALOG["grades"]:
        invalid_filters["grade"] = "지원하지 않는 학년입니다."
    if invalid_filters:
        return _invalid_query(invalid_filters)
    try:
        limit = _parse_page_number(query.get("limit"), 24)
    except ValueError:
        return _invalid_query({"limit": "1에서 100 사이의 정수여야 합니다."})
    try:
        offset = _parse_page_number(query.get("offset"), 0)
    except ValueError:
        return _invalid_query({"offset": "0 이상의 정수여야 합니다."})
    if not 1 <= limit <= 100:
        return _invalid_query({"limit": "1에서 100 사이의 정수여야 합니다."})

    context = read_context(request)
    try:
        if context is not None:
            session.execute(text("BEGIN IMMEDIATE"))
            screen_read_context(session, request, context)
        candidates = (
            select(App.id, App.name, Member.nickname, App.description)
            .join(App.owner)
            .where(App.is_public.is_(True))
            .order_by(App.created_at.desc(), App.id.desc())
        )
        if subject_filter:
            candidates = candidates.where(App.subject == subject_filter)
        if grade_filter:
            candidates = candidates.where(
                App.grades.any(AppGrade.grade == grade_filter)
            )
        # ponytail: Python Unicode casefold scans public search fields; add a SQLite Unicode index if catalogue size makes this costly.
        matching_ids = [
            app_id
            for app_id, name, nickname, description in session.execute(candidates).all()
            if folded_query is None
            or any(
                folded_query in _fold_search_value(value)
                for value in (name, nickname, description)
            )
        ]
        total = len(matching_ids)
        page_ids = matching_ids[offset : offset + limit]
        apps = (
            session.scalars(
                select(App)
                .options(
                    load_only(
                        App.id,
                        App.name,
                        App.subject,
                        App.is_public,
                        App.theme_id,
                        App.version,
                        App.url_version,
                    ),
                    selectinload(App.owner).load_only(Member.id, Member.nickname),
                    selectinload(App.grades).load_only(AppGrade.app_id, AppGrade.grade),
                    selectinload(App.health_result).load_only(
                        HealthResultRow.app_id,
                        HealthResultRow.state,
                        HealthResultRow.checked_at,
                        HealthResultRow.fresh_until,
                    ),
                )
                .where(App.id.in_(page_ids), App.is_public.is_(True))
                .order_by(App.created_at.desc(), App.id.desc())
            ).all()
            if page_ids
            else []
        )
        subjects = session.scalars(
            select(App.subject).where(App.is_public.is_(True)).distinct()
        ).all()
        page = AppPage.model_validate(
            {
                "items": [_app_card(app) for app in apps],
                "pagination": {
                    "limit": limit,
                    "offset": offset,
                    "total": total,
                    "has_more": offset + len(page_ids) < total,
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
    except SQLAlchemyError as error:
        session.rollback()
        if context is not None and "locked" in str(error).lower():
            raise AuthError("DB_BUSY", 503) from None
        return _server_unavailable()
    except (ValidationError, ValueError):
        return _server_unavailable()
    return page


@router.get(
    "/apps/{id}",
    operation_id="getApp",
    openapi_extra={"parameters": READ_CONTEXT_PARAMETERS},
    summary="Read an archive app available to the current member",
    response_model=AppDetailResponse,
    responses={
        400: {"model": ErrorEnvelope},
        401: {"model": ErrorEnvelope},
        403: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
        409: {"model": ErrorEnvelope},
        422: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
)
def get_public_app(
    request: Request,
    id: Annotated[
        str,
        ApiPath(
            description=(
                "Canonical 8-4-4-4-12 hexadecimal UUID with version 1-8 and variant "
                "8/9/a/b. Hex is case-insensitive and normalized to lowercase. "
                "Other formats return 404 NOT_FOUND; query errors take precedence."
            ),
            json_schema_extra={
                "format": "uuid",
                "pattern": UUID_PATTERN,
                "minLength": 36,
                "maxLength": 36,
            },
        ),
    ],
    session: Annotated[Session, Depends(get_session)],
) -> AppDetailResponse | JSONResponse:
    if _parse_raw_query(request) != []:
        return _error(
            400,
            "VALIDATION_ERROR",
            "상세 조회는 쿼리를 지원하지 않습니다.",
            {"query": "상세 조회는 쿼리를 지원하지 않습니다."},
        )
    context = read_context(request)
    app_id = id.lower()
    try:
        if context is not None:
            session.execute(text("BEGIN IMMEDIATE"))
        item, credential_row, member = screen_read_context(session, request, context)
        if not re.fullmatch(UUID_PATTERN, id):
            return _not_found()
        scope = App.is_public.is_(True)
        if member is not None:
            scope = or_(scope, App.owner_id == member["id"])
            if member["is_admin"]:
                scope = True
        app = session.scalar(
            select(App)
            .options(
                selectinload(App.owner).load_only(Member.id, Member.nickname),
                selectinload(App.grades),
                selectinload(App.health_result),
            )
            .where(App.id == app_id, scope)
        )
        if app is None:
            return _not_found()
        body = AppDetailResponse.model_validate(
            {
                "item": _app_detail(app),
                "server_time": datetime.now(UTC),
            }
        )
        if member is not None:
            if not screen_activity(session, item, credential_row):
                return _not_found()
            return response(
                session,
                request,
                body.model_dump(mode="json"),
                metadata=item,
                private=True,
            )
        return body
    except SQLAlchemyError as error:
        session.rollback()
        if context is not None and "locked" in str(error).lower():
            raise AuthError("DB_BUSY", 503) from None
        return _server_unavailable()
    except (ValidationError, ValueError):
        return _server_unavailable()
