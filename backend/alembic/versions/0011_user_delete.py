"""Preserve work history and add independently confirmed account deletion groups."""

import sqlalchemy as sa

from alembic import op

revision = "0011_user_delete"
down_revision = "0010_password_reset"
branch_labels = depends_on = None


def upgrade():
    old = sa.Table("write_operations", sa.MetaData(), autoload_with=op.get_bind())
    replace = {}
    for constraint in list(old.constraints):
        if isinstance(constraint, sa.CheckConstraint) and constraint.name in (
            "ck_write_kind",
            "ck_write_state",
            "ck_write_kind_fields",
            "ck_write_delete_stamp",
            "ck_write_delete_result",
        ):
            replace[constraint.name] = str(constraint.sqltext)
            old.constraints.remove(constraint)
    checks = (
        sa.CheckConstraint(
            "kind IN ('user_approval','app_create','app_update','app_delete','user_password_reset','user_delete')",
            name="ck_write_kind",
        ),
        sa.CheckConstraint(
            "state IN ('unresolved','succeeded','rejected') OR (kind IN ('app_delete','user_delete') AND state='confirming_deletion')",
            name="ck_write_state",
        ),
        sa.CheckConstraint(
            "("
            + replace["ck_write_kind_fields"]
            + ") OR (kind='user_delete' AND target_id IS NOT NULL AND expected_app_count IS NOT NULL AND typeof(expected_app_count)='integer' AND expected_app_count BETWEEN 0 AND 9007199254740991 AND request_hash IS NOT NULL AND length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*' AND expected_account_version IS NULL AND approved IS NULL AND expected_version IS NULL AND result_account_version IS NULL AND result_approved IS NULL AND result_version IS NULL)",
            name="ck_write_kind_fields",
        ),
        sa.CheckConstraint(
            "kind='user_delete' OR expected_app_count IS NULL",
            name="ck_write_count_kind",
        ),
        sa.CheckConstraint(
            "kind IN ('app_delete','user_delete') OR db_applied_at IS NULL",
            name="ck_write_delete_stamp",
        ),
        sa.CheckConstraint(
            replace["ck_write_delete_result"].replace(
                "kind<>'app_delete'", "kind NOT IN ('app_delete','user_delete')"
            ),
            name="ck_write_delete_result",
        ),
    )
    with op.batch_alter_table(
        "write_operations", recreate="always", copy_from=old, table_args=checks
    ) as batch:
        batch.add_column(
            sa.Column("expected_app_count", sa.BigInteger(), nullable=True)
        )
    op.create_table(
        "user_delete_outbox",
        sa.Column("event_id", sa.String(36), primary_key=True),
        sa.Column("group_id", sa.String(36), nullable=False),
        sa.Column("member_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("app_count", sa.BigInteger(), nullable=False),
        sa.Column("manifest_hash", sa.String(64), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("db_applied_at", sa.String(40), nullable=False),
        sa.Column("operation_key", sa.String(36), nullable=True),
        sa.Column("delivered_at", sa.String(40), nullable=True),
        sa.UniqueConstraint("kind", "target_id", name="uq_user_delete_target"),
        sa.CheckConstraint("kind IN ('member','app')", name="ck_user_delete_kind"),
        sa.CheckConstraint(
            "source='interactive_user_delete'", name="ck_user_delete_source"
        ),
        sa.CheckConstraint(
            "typeof(app_count)='integer' AND app_count BETWEEN 0 AND 9007199254740991",
            name="ck_user_delete_count",
        ),
        sa.CheckConstraint(
            "length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'",
            name="ck_user_delete_manifest",
        ),
        sa.CheckConstraint(
            "kind<>'member' OR (target_id=member_id AND event_id=group_id)",
            name="ck_user_delete_member",
        ),
    )
    op.create_index("ix_user_delete_group", "user_delete_outbox", ["group_id"])
    op.create_index("ix_user_delete_delivery", "user_delete_outbox", ["delivered_at"])
    op.create_index(
        "uq_user_delete_member_group",
        "user_delete_outbox",
        ["group_id"],
        unique=True,
        sqlite_where=sa.text("kind='member'"),
    )
    op.create_index(
        "uq_user_delete_member_key",
        "user_delete_outbox",
        ["operation_key"],
        unique=True,
        sqlite_where=sa.text("kind='member' AND operation_key IS NOT NULL"),
    )


def downgrade():
    raise RuntimeError(
        "Account deletion history cannot be discarded safely; restore a verified backup with the current independent deletion ledger."
    )
