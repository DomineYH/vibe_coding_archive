"""Extend the shared work-key namespace while preserving approval history."""

import sqlalchemy as sa

from alembic import op

revision = "0007_app_create"
down_revision = "0006_retired_credentials"
branch_labels = None
depends_on = None


def upgrade():
    old = sa.Table("write_operations", sa.MetaData(), autoload_with=op.get_bind())
    for constraint in list(old.constraints):
        if isinstance(constraint, sa.CheckConstraint):
            old.constraints.remove(constraint)
    checks = (
        sa.CheckConstraint(
            "kind IN ('user_approval','app_create')", name="ck_write_kind"
        ),
        sa.CheckConstraint(
            "state IN ('unresolved','succeeded','rejected')", name="ck_write_state"
        ),
        sa.CheckConstraint(
            "expected_account_version > 0", name="ck_write_account_version"
        ),
        sa.CheckConstraint("approved IN (0,1)", name="ck_write_approved"),
        sa.CheckConstraint(
            "result_version BETWEEN 1 AND 9007199254740991",
            name="ck_write_result_version",
        ),
        sa.CheckConstraint(
            "(kind='user_approval' AND target_id IS NOT NULL AND expected_account_version IS NOT NULL AND approved IS NOT NULL AND request_hash IS NULL AND result_version IS NULL) OR (kind='app_create' AND expected_account_version IS NULL AND approved IS NULL AND request_hash IS NOT NULL AND length(request_hash)=64 AND result_account_version IS NULL AND result_approved IS NULL)",
            name="ck_write_kind_fields",
        ),
        sa.CheckConstraint(
            "kind<>'app_create' OR (state='succeeded' AND target_id IS NOT NULL AND result_version IS NOT NULL AND applied_at IS NOT NULL) OR (state IN ('unresolved','rejected') AND target_id IS NULL AND result_version IS NULL)",
            name="ck_write_app_result",
        ),
    )
    with op.batch_alter_table(
        "write_operations", recreate="always", copy_from=old, table_args=checks
    ) as batch:
        batch.alter_column("target_id", existing_type=sa.String(36), nullable=True)
        batch.alter_column(
            "expected_account_version", existing_type=sa.Integer(), nullable=True
        )
        batch.alter_column("approved", existing_type=sa.Boolean(), nullable=True)
        batch.add_column(sa.Column("request_hash", sa.String(64), nullable=True))
        batch.add_column(sa.Column("result_version", sa.Integer(), nullable=True))


def downgrade():
    raise RuntimeError(
        "App operation history cannot be discarded safely; restore a verified backup and reapply the independent deletion ledger."
    )
