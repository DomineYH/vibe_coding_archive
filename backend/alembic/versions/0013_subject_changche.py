"""Allow the '창체' subject on apps."""

import sqlalchemy as sa

from alembic import op

revision = "0013_subject_changche"
down_revision = "0012_health_checks"
branch_labels = None
depends_on = None

OLD = "subject IN ('수학', '과학', '영어', '역사', '국어', '사회', '정보', '기타')"
NEW = "subject IN ('수학', '과학', '영어', '역사', '국어', '사회', '정보', '창체', '기타')"


def _rebuild_apps(subject_check):
    bind = op.get_bind()
    # Batch mode recreates indexes and constraints but drops the 0012 triggers.
    triggers = (
        bind.execute(
            sa.text(
                "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='apps'"
            )
        )
        .scalars()
        .all()
    )
    old = sa.Table("apps", sa.MetaData(), autoload_with=bind)
    for constraint in list(old.constraints):
        if isinstance(constraint, sa.CheckConstraint):
            old.constraints.remove(constraint)
    checks = (
        sa.CheckConstraint(subject_check, name="ck_apps_subject"),
        sa.CheckConstraint("is_public IN (0, 1)", name="ck_apps_is_public"),
        sa.CheckConstraint(
            "theme_id IN ('cloudDancer', 'niagara', 'turquoise', 'sage', "
            "'lavenderGray', 'butterum', 'powderPink', 'ironGate')",
            name="ck_apps_theme_id",
        ),
        sa.CheckConstraint("version >= 1", name="ck_apps_version"),
        sa.CheckConstraint("url_version >= 1", name="ck_apps_url_version"),
    )
    with op.batch_alter_table(
        "apps", recreate="always", copy_from=old, table_args=checks
    ):
        pass
    for sql in triggers:
        op.execute(sql)


def upgrade():
    _rebuild_apps(NEW)


def downgrade():
    count = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM apps WHERE subject='창체'"))
        .scalar_one()
    )
    if count:
        raise RuntimeError(
            "Apps with subject '창체' exist; downgrade refused without an explicit data decision."
        )
    _rebuild_apps(OLD)
