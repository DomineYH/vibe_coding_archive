"""Preserve shared work-key history while admitting version-bound app edits."""

import sqlalchemy as sa

from alembic import op

revision = "0008_app_update"
down_revision = "0007_app_create"
branch_labels = None
depends_on = None


def upgrade():
    old = sa.Table("write_operations", sa.MetaData(), autoload_with=op.get_bind())
    for constraint in list(old.constraints):
        if isinstance(constraint, sa.CheckConstraint) and constraint.name in (
            "ck_write_kind",
            "ck_write_kind_fields",
        ):
            old.constraints.remove(constraint)
    checks = (
        sa.CheckConstraint(
            "kind IN ('user_approval','app_create','app_update')", name="ck_write_kind"
        ),
        sa.CheckConstraint(
            "expected_version BETWEEN 1 AND 9007199254740991",
            name="ck_write_expected_version",
        ),
        sa.CheckConstraint(
            "(kind='user_approval' AND expected_version IS NULL AND target_id IS NOT NULL AND expected_account_version IS NOT NULL AND approved IS NOT NULL AND request_hash IS NULL AND result_version IS NULL) OR "
            "(kind='app_create' AND expected_version IS NULL AND expected_account_version IS NULL AND approved IS NULL AND request_hash IS NOT NULL AND length(request_hash)=64 AND result_account_version IS NULL AND result_approved IS NULL) OR "
            "(kind='app_update' AND target_id IS NOT NULL AND expected_version IS NOT NULL AND expected_account_version IS NULL AND approved IS NULL AND request_hash IS NOT NULL AND length(request_hash)=64 AND result_account_version IS NULL AND result_approved IS NULL)",
            name="ck_write_kind_fields",
        ),
        sa.CheckConstraint(
            "kind<>'app_update' OR "
            "(state='unresolved' AND result_version IS NULL AND applied_at IS NULL AND failure_code IS NULL) OR "
            "(state='succeeded' AND result_version IS NOT NULL AND result_version=expected_version+1 AND applied_at IS NOT NULL AND failure_code IS NULL) OR "
            "(state='rejected' AND result_version IS NULL AND applied_at IS NOT NULL AND failure_code IS NOT NULL AND length(failure_code)>0)",
            name="ck_write_update_result",
        ),
    )
    with op.batch_alter_table(
        "write_operations", recreate="always", copy_from=old, table_args=checks
    ) as batch:
        batch.add_column(sa.Column("expected_version", sa.Integer(), nullable=True))


def downgrade():
    raise RuntimeError(
        "App update history cannot be discarded safely; restore a verified backup "
        "and reapply the independent deletion ledger."
    )
