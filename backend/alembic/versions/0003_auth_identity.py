"""Preserve archive ownership and add the authentication transition boundary."""

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from unicodedata import normalize

import sqlalchemy as sa
from argon2 import extract_parameters
from argon2.exceptions import InvalidHashError

from alembic import op

revision = "0003_auth_identity"
down_revision = "0002_public_apps"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    members = bind.execute(sa.text("SELECT * FROM members")).mappings().all()
    corrections = (
        json.loads(Path(os.environ["AUTH_MEMBER_BACKFILL"]).read_text())
        if members and os.environ.get("AUTH_MEMBER_BACKFILL")
        else {}
    )
    backfill = []
    keys = set()
    for member in members:
        login = normalize("NFC", member["login_id"].strip())
        key = login.lower()
        if not re.fullmatch(r"[가-힣A-Za-z0-9_.-]{2,32}", login) or key in keys:
            raise RuntimeError(
                "Authentication migration requires explicit login ID correction."
            )
        keys.add(key)
        record = corrections.get(member["id"])
        if not record:
            raise RuntimeError(
                "Authentication migration requires explicit member history backfill."
            )
        dates = {}
        for field in ("created_at", "updated_at", "first_approved_at"):
            raw = record.get(field)
            if raw is None and field == "first_approved_at":
                dates[field] = None
                continue
            try:
                date = datetime.fromisoformat(raw)
                if date.utcoffset() is None:
                    raise ValueError()
                dates[field] = (
                    date.astimezone(UTC)
                    .isoformat(timespec="microseconds")
                    .replace("+00:00", "Z")
                )
            except (TypeError, ValueError):
                raise RuntimeError(
                    "Authentication migration requires verified UTC history."
                ) from None
        if dates["updated_at"] < dates["created_at"] or (
            dates["first_approved_at"]
            and not dates["created_at"]
            <= dates["first_approved_at"]
            <= dates["updated_at"]
        ):
            raise RuntimeError("Authentication migration history is inconsistent.")
        if (member["approval_status"] == "pending") != (
            dates["first_approved_at"] is None
        ):
            raise RuntimeError("Authentication migration approval history is unknown.")
        if member["password_hash"]:
            try:
                extract_parameters(member["password_hash"])
            except (InvalidHashError, ValueError, TypeError):
                if record.get("password_hash_policy") != "unusable":
                    raise RuntimeError(
                        "Unknown hash requires explicit unusable classification."
                    ) from None
        backfill.append({"id": member["id"], "key": key, **dates})

    for name, type_ in [
        ("login_id_key", sa.String(32)),
        ("created_at", sa.String(40)),
        ("updated_at", sa.String(40)),
        ("first_approved_at", sa.String(40)),
    ]:
        op.add_column("members", sa.Column(name, type_, nullable=True))
    for row in backfill:
        bind.execute(
            sa.text(
                "UPDATE members SET login_id_key=:key, created_at=:created_at, updated_at=:updated_at, first_approved_at=:first_approved_at WHERE id=:id"
            ),
            row,
        )
    with op.batch_alter_table("members") as batch:
        for field in ("login_id_key", "created_at", "updated_at"):
            batch.alter_column(
                field,
                nullable=False,
                existing_type=sa.String(40 if field != "login_id_key" else 32),
            )
        batch.add_column(
            sa.Column(
                "account_version", sa.Integer(), nullable=False, server_default="1"
            )
        )
        batch.add_column(
            sa.Column(
                "must_change_password", sa.Boolean(), nullable=False, server_default="0"
            )
        )
        batch.add_column(
            sa.Column("temporary_password_expires_at", sa.String(40), nullable=True)
        )
        batch.create_unique_constraint("uq_members_login_id_key", ["login_id_key"])
        batch.create_check_constraint(
            "ck_members_account_version", "account_version > 0"
        )
        batch.create_check_constraint(
            "ck_members_change_password", "must_change_password IN (0,1)"
        )
        batch.create_check_constraint(
            "ck_members_approval_history",
            "(approval_status = 'pending' AND first_approved_at IS NULL) OR (approval_status <> 'pending' AND first_approved_at IS NOT NULL)",
        )

    statements = [
        "CREATE TABLE auth_retired_flow_ids (id_hash TEXT PRIMARY KEY NOT NULL)",
        """CREATE TABLE auth_flows (
            id TEXT PRIMARY KEY NOT NULL,
            revision TEXT NOT NULL, issued_seq TEXT NOT NULL,
            current_session_generation TEXT, current_recovery_seq TEXT,
            recovery_ready INTEGER NOT NULL CHECK(recovery_ready IN (0,1)),
            ever_ready INTEGER NOT NULL CHECK(ever_ready IN (0,1)),
            last_identity_change_revision TEXT NOT NULL,
            created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL,
            expires_at TEXT NOT NULL, revoked_at TEXT,
            CHECK(revision = '0' OR (substr(revision,1,1) BETWEEN '1' AND '9' AND revision NOT GLOB '*[^0-9]*')),
            CHECK(issued_seq = '0' OR (substr(issued_seq,1,1) BETWEEN '1' AND '9' AND issued_seq NOT GLOB '*[^0-9]*'))
        )""",
        """CREATE TABLE sessions (
            token_hash TEXT PRIMARY KEY NOT NULL,
            flow_id TEXT NOT NULL REFERENCES auth_flows(id), issued_seq TEXT NOT NULL,
            member_id TEXT REFERENCES members(id),
            kind TEXT NOT NULL CHECK(kind IN ('anonymous','change_only','full')),
            csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, authenticated_at TEXT,
            last_activity_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL,
            expires_at TEXT NOT NULL, revoked_at TEXT,
            UNIQUE(flow_id,issued_seq),
            CHECK((kind='anonymous' AND member_id IS NULL) OR (kind<>'anonymous' AND member_id IS NOT NULL))
        )""",
        "CREATE INDEX ix_sessions_member ON sessions(member_id)",
        "CREATE INDEX ix_sessions_expiry ON sessions(expires_at)",
        """CREATE TABLE recovery_credentials (
            token_hash TEXT PRIMARY KEY NOT NULL, flow_id TEXT NOT NULL REFERENCES auth_flows(id),
            issued_seq TEXT NOT NULL, recovery_csrf_token TEXT NOT NULL,
            created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
            UNIQUE(flow_id,issued_seq)
        )""",
        """CREATE TABLE auth_transitions (
            transition_id TEXT PRIMARY KEY NOT NULL, flow_id TEXT NOT NULL REFERENCES auth_flows(id),
            kind TEXT NOT NULL CHECK(kind IN ('anonymous_session','login','logout','password_change','reauthenticate')),
            source_session_generation TEXT, before_revision TEXT NOT NULL, admitted_revision TEXT NOT NULL,
            permit_expires_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('admitted','executing','succeeded','failed','cancelled','expired')),
            result_session_generation TEXT, failure_code TEXT,
            admitted_at TEXT NOT NULL, terminal_at TEXT,
            CHECK(transition_id = flow_id || '.' || before_revision),
            CHECK((state IN ('admitted','executing') AND terminal_at IS NULL) OR (state NOT IN ('admitted','executing') AND terminal_at IS NOT NULL))
        )""",
        "CREATE UNIQUE INDEX uq_auth_transition_pending ON auth_transitions(flow_id) WHERE state IN ('admitted','executing')",
        "CREATE INDEX ix_auth_transitions_terminal ON auth_transitions(terminal_at)",
        """CREATE TABLE rate_limit_events (
            id INTEGER PRIMARY KEY, purpose TEXT NOT NULL, subject_hash TEXT NOT NULL,
            occurred_at TEXT NOT NULL, expires_at TEXT NOT NULL
        )""",
        "CREATE INDEX ix_rate_limit_window ON rate_limit_events(purpose,subject_hash,occurred_at)",
        """CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY, action TEXT NOT NULL, actor_id TEXT, target_id TEXT,
            occurred_at TEXT NOT NULL, outcome TEXT NOT NULL
        )""",
    ]
    for statement in statements:
        bind.exec_driver_sql(statement)
    if bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Authentication migration violated archive ownership.")


def downgrade():
    raise RuntimeError(
        "Restore a separately verified backup; authentication history cannot be downgraded."
    )
