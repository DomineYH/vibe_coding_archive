"""Keep exact issued-name fences after expiring credential material."""

import sqlalchemy as sa

from alembic import op

revision = "0006_retired_credentials"
down_revision = "0005_member_approval"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "auth_retired_credentials",
        sa.Column(
            "flow_id",
            sa.Text,
            sa.ForeignKey("auth_flows.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("kind", sa.Text, primary_key=True),
        sa.Column("issued_seq", sa.Text, primary_key=True),
        sa.CheckConstraint("kind IN ('session','recovery')"),
    )


def downgrade():
    raise RuntimeError(
        "Retired credential fences cannot be discarded safely; "
        "restore a separately verified backup."
    )
