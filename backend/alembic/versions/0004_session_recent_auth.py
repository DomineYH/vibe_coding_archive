"""Persist the administrator first-change recent-auth window across restart."""

import sqlalchemy as sa

from alembic import op

revision = "0004_session_recent_auth"
down_revision = "0003_auth_identity"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sessions", sa.Column("recent_auth_until", sa.String(40), nullable=True)
    )


def downgrade():
    raise RuntimeError(
        "Restore a separately verified backup; authentication history cannot be downgraded."
    )
