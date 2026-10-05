"""Preserve work history and retain independent interactive deletion delivery."""

import sqlalchemy as sa

from alembic import op

revision = "0009_app_delete"
down_revision = "0008_app_update"
branch_labels = depends_on = None


def upgrade():
    old = sa.Table("write_operations", sa.MetaData(), autoload_with=op.get_bind())
    prior_fields = next(
        str(c.sqltext)
        for c in old.constraints
        if isinstance(c, sa.CheckConstraint) and c.name == "ck_write_kind_fields"
    )
    for c in list(old.constraints):
        if isinstance(c, sa.CheckConstraint) and c.name in (
            "ck_write_kind",
            "ck_write_state",
            "ck_write_kind_fields",
        ):
            old.constraints.remove(c)
    checks = (
        sa.CheckConstraint(
            "kind IN ('user_approval','app_create','app_update','app_delete')",
            name="ck_write_kind",
        ),
        sa.CheckConstraint(
            "state IN ('unresolved','succeeded','rejected') OR (kind='app_delete' AND state='confirming_deletion')",
            name="ck_write_state",
        ),
        sa.CheckConstraint(
            "("
            + prior_fields
            + ") OR (kind='app_delete' AND target_id IS NOT NULL AND expected_version IS NOT NULL AND expected_account_version IS NULL AND approved IS NULL AND request_hash IS NOT NULL AND length(request_hash)=64 AND result_account_version IS NULL AND result_approved IS NULL AND result_version IS NULL)",
            name="ck_write_kind_fields",
        ),
        sa.CheckConstraint(
            "kind='app_delete' OR db_applied_at IS NULL", name="ck_write_delete_stamp"
        ),
        sa.CheckConstraint(
            "kind<>'app_delete' OR "
            "(state='unresolved' AND db_applied_at IS NULL AND applied_at IS NULL AND failure_code IS NULL) OR "
            "(state='confirming_deletion' AND db_applied_at IS NOT NULL AND applied_at IS NULL AND failure_code IS NULL) OR "
            "(state='succeeded' AND db_applied_at IS NOT NULL AND applied_at IS NOT NULL AND failure_code IS NULL) OR "
            "(state='rejected' AND db_applied_at IS NULL AND applied_at IS NOT NULL AND failure_code IS NOT NULL AND length(failure_code)>0)",
            name="ck_write_delete_result",
        ),
    )
    with op.batch_alter_table(
        "write_operations", recreate="always", copy_from=old, table_args=checks
    ) as batch:
        batch.alter_column(
            "state",
            existing_type=sa.String(16),
            type_=sa.String(24),
            existing_nullable=False,
        )
        batch.add_column(sa.Column("db_applied_at", sa.String(40), nullable=True))
    op.create_table(
        "app_delete_outbox",
        sa.Column("event_id", sa.String(36), primary_key=True),
        sa.Column("operation_key", sa.String(36), nullable=True, unique=True),
        sa.Column("app_id", sa.String(36), nullable=False, unique=True),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("db_applied_at", sa.String(40), nullable=False),
        sa.Column("delivered_at", sa.String(40), nullable=True),
        sa.CheckConstraint(
            "source='interactive_app_delete'", name="ck_app_delete_outbox_source"
        ),
    )
    op.create_index(
        "ix_app_delete_outbox_delivery", "app_delete_outbox", ["delivered_at"]
    )


def downgrade():
    raise RuntimeError(
        "App deletion history cannot be discarded safely; restore a verified backup and reapply the current independent deletion ledger."
    )
