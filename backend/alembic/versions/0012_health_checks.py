"""Persist health jobs, fenced executions, batch snapshots and admission limits."""

import sqlalchemy as sa
from alembic import op

revision = "0012_health_checks"
down_revision = "0011_user_delete"
branch_labels = depends_on = None


def upgrade():
    for column in (
        sa.Column("url_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("http_status", sa.Integer()),
        sa.Column("response_ms", sa.Integer()),
        sa.Column("error_kind", sa.String(40)),
        sa.Column("error_stage", sa.String(24)),
    ):
        op.add_column("health_results", column)
    op.execute(
        "UPDATE health_results SET url_version=(SELECT url_version FROM apps WHERE apps.id=health_results.app_id)"
    )
    op.execute("""CREATE TABLE health_jobs (
        id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
        url_version INTEGER NOT NULL CHECK(url_version>=1),
        requested_by TEXT REFERENCES members(id) ON DELETE SET NULL,
        individual INTEGER NOT NULL CHECK(individual IN (0,1)),
        status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
        created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, failure_code TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 2),
        worker_id TEXT, boot_id TEXT, lease_deadline REAL,
        CHECK((status IN ('queued','running') AND finished_at IS NULL) OR (status IN ('completed','failed','cancelled') AND finished_at IS NOT NULL)),
        CHECK((status='failed' AND failure_code IN ('QUEUE_WAIT_EXPIRED','WORKER_RECOVERY_EXHAUSTED','CHECK_EXECUTION_FAILED','RESULT_STORE_FAILED')) OR (status<>'failed' AND failure_code IS NULL)),
        CHECK(status<>'running' OR (attempts>0 AND worker_id IS NOT NULL AND boot_id IS NOT NULL AND lease_deadline IS NOT NULL AND started_at IS NOT NULL))
    )""")
    op.execute(
        "CREATE UNIQUE INDEX uq_health_active_app ON health_jobs(app_id) WHERE status IN ('queued','running')"
    )
    op.execute(
        "CREATE INDEX ix_health_jobs_queue ON health_jobs(status,individual,created_at,id)"
    )
    op.execute("CREATE INDEX ix_health_jobs_app ON health_jobs(app_id,created_at,id)")
    op.execute("""CREATE TABLE health_cooldowns (
        app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL, next_check_at TEXT NOT NULL
    )""")
    op.execute("""CREATE TABLE health_requests (
        id INTEGER PRIMARY KEY, actor_key TEXT NOT NULL, created_at TEXT NOT NULL
    )""")
    op.execute(
        "CREATE INDEX ix_health_requests_actor ON health_requests(actor_key,created_at)"
    )
    op.execute("""CREATE TABLE health_batches (
        id TEXT PRIMARY KEY, requested_by TEXT REFERENCES members(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, finished_at TEXT,
        target_count INTEGER NOT NULL CHECK(target_count>=0)
    )""")
    op.execute(
        "CREATE UNIQUE INDEX uq_health_active_batch ON health_batches((1)) WHERE finished_at IS NULL"
    )
    op.execute("""CREATE TABLE health_batch_items (
        batch_id TEXT NOT NULL REFERENCES health_batches(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        app_id TEXT REFERENCES apps(id) ON DELETE SET NULL,
        job_id TEXT REFERENCES health_jobs(id) ON DELETE SET NULL,
        url_version INTEGER NOT NULL CHECK(url_version>=1),
        disposition TEXT NOT NULL CHECK(disposition IN ('created','active_reused','result_reused')),
        status TEXT NOT NULL CHECK(status IN ('queued','running','result_obtained','failed','cancelled')),
        PRIMARY KEY(batch_id,ordinal)
    )""")
    op.execute("CREATE INDEX ix_health_batch_items_job ON health_batch_items(job_id)")
    op.execute("CREATE INDEX ix_health_batch_items_app ON health_batch_items(app_id)")
    op.execute("""CREATE TABLE health_worker (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), worker_id TEXT NOT NULL,
        boot_id TEXT NOT NULL, heartbeat_mono REAL NOT NULL, heartbeat_at TEXT NOT NULL,
        ready INTEGER NOT NULL CHECK(ready IN (0,1)), individual_streak INTEGER NOT NULL DEFAULT 0
    )""")
    # BEFORE DELETE also runs during member -> app cascades. Finalized batch
    # counts are immutable; unfinished snapshots invalidate even reused results.
    for name, event, condition, stamp in (
        (
            "health_url_changed",
            "AFTER UPDATE OF url_version ON apps",
            "NEW.url_version<>OLD.url_version",
            "NEW.updated_at",
        ),
        (
            "health_app_deleted",
            "BEFORE DELETE ON apps",
            "1",
            "strftime('%Y-%m-%dT%H:%M:%f000Z','now')",
        ),
    ):
        op.execute(f"""CREATE TRIGGER {name} {event} WHEN {condition} BEGIN
            UPDATE health_batch_items SET status='cancelled'
            WHERE app_id=OLD.id AND batch_id IN (SELECT id FROM health_batches WHERE finished_at IS NULL);
            UPDATE health_batches SET finished_at={stamp}
            WHERE finished_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM health_batch_items WHERE batch_id=health_batches.id AND status IN ('queued','running'));
            UPDATE health_jobs SET status='cancelled',finished_at={stamp},failure_code=NULL
            WHERE app_id=OLD.id AND status IN ('queued','running');
            DELETE FROM health_results WHERE app_id=OLD.id;
        END""")


def downgrade():
    raise RuntimeError("Health execution history requires a verified backup restore.")
