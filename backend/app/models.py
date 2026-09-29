from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.catalog import CATALOG


class Base(DeclarativeBase):
    pass


class UtcTimestampString(TypeDecorator[str]):
    impl = String(40)
    cache_ok = True

    def process_bind_param(self, value: str | datetime | None, _dialect) -> str | None:
        if value is None:
            return None
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("Timestamps must include a UTC offset.")
        return (
            parsed.astimezone(UTC)
            .isoformat(timespec="microseconds")
            .replace("+00:00", "Z")
        )


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint("is_admin IN (0, 1)", name="ck_members_is_admin"),
        CheckConstraint(
            "approval_status IN ('pending', 'approved', 'revoked')",
            name="ck_members_approval_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    login_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    nickname: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str | None] = mapped_column(Text)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approval_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending"
    )

    apps: Mapped[list[App]] = relationship(back_populates="owner")


class App(Base):
    __tablename__ = "apps"
    __table_args__ = (
        CheckConstraint(
            "subject IN ("
            + ", ".join(repr(value) for value in CATALOG["subjects"])
            + ")",
            name="ck_apps_subject",
        ),
        CheckConstraint("is_public IN (0, 1)", name="ck_apps_is_public"),
        CheckConstraint(
            "theme_id IN ("
            + ", ".join(repr(theme["id"]) for theme in CATALOG["themes"])
            + ")",
            name="ck_apps_theme_id",
        ),
        CheckConstraint("version >= 1", name="ck_apps_version"),
        CheckConstraint("url_version >= 1", name="ck_apps_url_version"),
        Index("ix_apps_public_created_id", "is_public", "created_at", "id"),
        Index("ix_apps_owner_id", "owner_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(String(16), nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False)
    theme_id: Mapped[str] = mapped_column(String(32), nullable=False)
    stack_db: Mapped[str | None] = mapped_column(String(80))
    stack_backend: Mapped[str | None] = mapped_column(String(80))
    stack_frontend: Mapped[str | None] = mapped_column(String(80))
    stack_hosting: Mapped[str | None] = mapped_column(String(80))
    version: Mapped[int] = mapped_column(nullable=False)
    url_version: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[str] = mapped_column(UtcTimestampString(), nullable=False)
    updated_at: Mapped[str] = mapped_column(UtcTimestampString(), nullable=False)

    owner: Mapped[Member] = relationship(back_populates="apps")
    grades: Mapped[list[AppGrade]] = relationship(
        back_populates="app", cascade="all, delete-orphan"
    )
    health_result: Mapped[HealthResult | None] = relationship(
        back_populates="app", cascade="all, delete-orphan", uselist=False
    )


class AppGrade(Base):
    __tablename__ = "app_grades"
    __table_args__ = (
        CheckConstraint(
            "grade IN (" + ", ".join(repr(value) for value in CATALOG["grades"]) + ")",
            name="ck_app_grades_grade",
        ),
    )

    app_id: Mapped[str] = mapped_column(
        ForeignKey("apps.id", ondelete="CASCADE"), primary_key=True
    )
    grade: Mapped[str] = mapped_column(String(16), primary_key=True)

    app: Mapped[App] = relationship(back_populates="grades")


class HealthResult(Base):
    __tablename__ = "health_results"
    __table_args__ = (
        CheckConstraint(
            "state IN ('unchecked', 'healthy', 'http_error', 'timeout', "
            "'network_error', 'blocked', 'redirect_error')",
            name="ck_health_results_state",
        ),
        CheckConstraint(
            "(state = 'unchecked' AND checked_at IS NULL AND fresh_until IS NULL) "
            "OR (state <> 'unchecked' AND checked_at IS NOT NULL "
            "AND fresh_until IS NOT NULL)",
            name="ck_health_results_timestamps",
        ),
    )

    app_id: Mapped[str] = mapped_column(
        ForeignKey("apps.id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[str] = mapped_column(String(24), nullable=False, default="unchecked")
    checked_at: Mapped[str | None] = mapped_column(String(40))
    fresh_until: Mapped[str | None] = mapped_column(String(40))

    app: Mapped[App] = relationship(back_populates="health_result")
