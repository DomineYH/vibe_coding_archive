"""Approval work keys and initial pending maintenance; preserve all member history."""

import sqlalchemy as sa

from alembic import op

revision = "0005_member_approval"
down_revision = "0004_session_recent_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "write_operations",
        sa.Column("key", sa.String(36), primary_key=True),
        sa.Column(
            "actor_id", sa.String(36), sa.ForeignKey("members.id"), nullable=False
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        # No target FK: another actor's resolved result survives target deletion.
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("expected_account_version", sa.Integer, nullable=False),
        sa.Column("approved", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("result_account_version", sa.Integer),
        sa.Column("result_approved", sa.Boolean),
        sa.Column("applied_at", sa.String(40)),
        sa.Column("failure_code", sa.String(80)),
        sa.CheckConstraint("kind='user_approval'"),
        sa.CheckConstraint("state IN ('unresolved','succeeded','rejected')"),
        sa.CheckConstraint("expected_account_version > 0"),
        sa.CheckConstraint("approved IN (0,1)"),
    )
    op.create_index("ix_write_operations_expiry", "write_operations", ["expires_at"])
    op.create_table(
        "member_deletions",
        sa.Column("member_id", sa.String(36), primary_key=True),
        sa.Column("deleted_at", sa.String(40), nullable=False),
    )
    op.create_table(
        "app_deletions",
        sa.Column("app_id", sa.String(36), primary_key=True),
        sa.Column("deleted_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_members_initial_pending",
        "members",
        ["approval_status", "first_approved_at", "created_at"],
    )


def downgrade():
    raise RuntimeError(
        "Restore a verified backup and reapply the independent deletion ledger."
    )
