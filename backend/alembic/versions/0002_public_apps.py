"""Create member and public app read tables.

Revision ID: 0002_public_apps
Revises: 0001_baseline
Create Date: 2026-09-29
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_public_apps"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "members",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("login_id", sa.String(128), nullable=False),
        sa.Column("nickname", sa.String(80), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "approval_status",
            sa.String(16),
            server_default="pending",
            nullable=False,
        ),
        sa.CheckConstraint("is_admin IN (0, 1)", name="ck_members_is_admin"),
        sa.CheckConstraint(
            "approval_status IN ('pending', 'approved', 'revoked')",
            name="ck_members_approval_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("login_id", name="uq_members_login_id"),
    )
    op.create_table(
        "apps",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("owner_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("subject", sa.String(16), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column("theme_id", sa.String(32), nullable=False),
        sa.Column("stack_db", sa.String(80), nullable=True),
        sa.Column("stack_backend", sa.String(80), nullable=True),
        sa.Column("stack_frontend", sa.String(80), nullable=True),
        sa.Column("stack_hosting", sa.String(80), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("url_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.CheckConstraint(
            "subject IN ('수학', '과학', '영어', '역사', '국어', '사회', '정보', '기타')",
            name="ck_apps_subject",
        ),
        sa.CheckConstraint("is_public IN (0, 1)", name="ck_apps_is_public"),
        sa.CheckConstraint(
            "theme_id IN ('cloudDancer', 'niagara', 'turquoise', 'sage', "
            "'lavenderGray', 'butterum', 'powderPink', 'ironGate')",
            name="ck_apps_theme_id",
        ),
        sa.CheckConstraint("version >= 1", name="ck_apps_version"),
        sa.CheckConstraint("url_version >= 1", name="ck_apps_url_version"),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["members.id"], ondelete="CASCADE", name="fk_apps_owner"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_apps_public_created_id",
        "apps",
        ["is_public", "created_at", "id"],
    )
    op.create_index("ix_apps_owner_id", "apps", ["owner_id"])
    op.create_table(
        "app_grades",
        sa.Column("app_id", sa.String(36), nullable=False),
        sa.Column("grade", sa.String(16), nullable=False),
        sa.CheckConstraint(
            "grade IN ('초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', "
            "'중3', '고1', '고2', '고3')",
            name="ck_app_grades_grade",
        ),
        sa.ForeignKeyConstraint(
            ["app_id"], ["apps.id"], ondelete="CASCADE", name="fk_app_grades_app"
        ),
        sa.PrimaryKeyConstraint("app_id", "grade"),
    )
    op.create_table(
        "health_results",
        sa.Column("app_id", sa.String(36), nullable=False),
        sa.Column("state", sa.String(24), server_default="unchecked", nullable=False),
        sa.Column("checked_at", sa.String(40), nullable=True),
        sa.Column("fresh_until", sa.String(40), nullable=True),
        sa.CheckConstraint(
            "state IN ('unchecked', 'healthy', 'http_error', 'timeout', "
            "'network_error', 'blocked', 'redirect_error')",
            name="ck_health_results_state",
        ),
        sa.CheckConstraint(
            "(state = 'unchecked' AND checked_at IS NULL AND fresh_until IS NULL) "
            "OR (state <> 'unchecked' AND checked_at IS NOT NULL "
            "AND fresh_until IS NOT NULL)",
            name="ck_health_results_timestamps",
        ),
        sa.ForeignKeyConstraint(
            ["app_id"], ["apps.id"], ondelete="CASCADE", name="fk_health_results_app"
        ),
        sa.PrimaryKeyConstraint("app_id"),
    )


def downgrade() -> None:
    op.drop_table("health_results")
    op.drop_table("app_grades")
    op.drop_index("ix_apps_owner_id", table_name="apps")
    op.drop_index("ix_apps_public_created_id", table_name="apps")
    op.drop_table("apps")
    op.drop_table("members")
