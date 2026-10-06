"""Preserve existing work history and constrain keyed password reset results."""

import sqlalchemy as sa

from alembic import op

revision = "0010_password_reset"
down_revision = "0009_app_delete"
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
            "ck_write_kind_fields",
        ):
            old.constraints.remove(c)
    checks = (
        sa.CheckConstraint(
            "kind IN ('user_approval','app_create','app_update','app_delete','user_password_reset')",
            name="ck_write_kind",
        ),
        sa.CheckConstraint(
            "("
            + prior_fields
            + ") OR (kind='user_password_reset' AND target_id IS NOT NULL AND expected_account_version IS NOT NULL AND typeof(expected_account_version)='integer' AND expected_account_version BETWEEN 1 AND 9007199254740991 AND approved IS NULL AND expected_version IS NULL AND request_hash IS NULL AND result_approved IS NULL AND result_version IS NULL AND db_applied_at IS NULL AND reset_key_id IS NOT NULL AND length(reset_key_id)=64 AND reset_key_id NOT GLOB '*[^0-9a-f]*' AND reset_request_hmac IS NOT NULL AND length(reset_request_hmac)=64 AND reset_request_hmac NOT GLOB '*[^0-9a-f]*')",
            name="ck_write_kind_fields",
        ),
        sa.CheckConstraint(
            "kind='user_password_reset' OR (reset_key_id IS NULL AND reset_request_hmac IS NULL AND result_temporary_password_expires_at IS NULL)",
            name="ck_write_reset_fields",
        ),
        sa.CheckConstraint(
            "kind<>'user_password_reset' OR (state='unresolved' AND applied_at IS NULL AND failure_code IS NULL AND result_account_version IS NULL AND result_temporary_password_expires_at IS NULL) OR (state='succeeded' AND applied_at IS NOT NULL AND failure_code IS NULL AND result_account_version IS NOT NULL AND result_account_version=expected_account_version+1 AND result_account_version<=9007199254740991 AND result_temporary_password_expires_at IS NOT NULL) OR (state='rejected' AND applied_at IS NOT NULL AND failure_code IS NOT NULL AND length(failure_code)>0 AND result_account_version IS NULL AND result_temporary_password_expires_at IS NULL)",
            name="ck_write_reset_result",
        ),
    )
    with op.batch_alter_table(
        "write_operations", recreate="always", copy_from=old, table_args=checks
    ) as batch:
        batch.add_column(sa.Column("reset_key_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("reset_request_hmac", sa.String(64), nullable=True))
        batch.add_column(
            sa.Column(
                "result_temporary_password_expires_at", sa.String(40), nullable=True
            )
        )


def downgrade():
    raise RuntimeError(
        "Password reset history cannot be discarded safely; restore a verified backup and reconcile historical keys."
    )
