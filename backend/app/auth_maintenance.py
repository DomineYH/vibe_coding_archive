"""Reconcile before readiness; sweep on a bounded schedule; invalidate restored authority."""

from sqlalchemy import text

from app.app_deletion_ledger import prepare, replay, retry_delivery
from app.auth_boundary import (
    SEQUENCE,
    advance,
    after,
    digest,
    flow,
    now,
    save_flow,
    terminalize,
)
from app.pending_retention import sweep_pending


def reconcile(factory, *, restored=False):
    if restored:
        events = prepare(factory, restored=True)
        replay(factory, events)
    else:
        retry_delivery(factory)
    sweep_pending(factory, restored=restored)
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        if db.execute(text("PRAGMA foreign_key_check")).all():
            raise RuntimeError("Authentication foreign key verification failed.")
        for row in db.execute(text("SELECT * FROM auth_flows")).mappings().all():
            if any(
                not SEQUENCE.fullmatch(row[key])
                for key in ("revision", "issued_seq", "last_identity_change_revision")
            ):
                raise RuntimeError("Authentication sequence verification failed.")
            for key, table in [
                ("current_session_generation", "sessions"),
                ("current_recovery_seq", "recovery_credentials"),
            ]:
                if (
                    row[key] is not None
                    and not db.execute(
                        text(
                            f"SELECT 1 FROM {table} WHERE flow_id=:id AND issued_seq=:seq"
                        ),
                        {"id": row["id"], "seq": row[key]},
                    ).first()
                ):
                    raise RuntimeError(
                        "Authentication current credential verification failed."
                    )
            item = dict(row)
            if terminalize(db, item):
                advance(db, item)
        if restored:
            timestamp = now()
            # Restored business keys must never regain execution or result authority.
            db.execute(text("DELETE FROM write_operations"))
            for table in ("auth_flows", "sessions", "recovery_credentials"):
                db.execute(
                    text(
                        f"UPDATE {table} SET revoked_at=:now WHERE revoked_at IS NULL"
                    ),
                    {"now": timestamp},
                )
            db.execute(
                text(
                    "INSERT INTO audit_logs(action,occurred_at,outcome) VALUES ('invalidate_restored_auth',:now,'succeeded')"
                ),
                {"now": timestamp},
            )
        db.commit()


def sweep(factory):
    retry_delivery(factory)
    sweep_pending(factory)
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        timestamp = now()
        db.execute(
            text("DELETE FROM write_operations WHERE expires_at<=:now"),
            {"now": timestamp},
        )
        expired = (
            db.execute(
                text(
                    "SELECT id FROM auth_flows WHERE expires_at<=:now OR revoked_at IS NOT NULL"
                ),
                {"now": timestamp},
            )
            .scalars()
            .all()
        )
        for flow_id in expired:
            item = flow(db, flow_id, live=False)
            if terminalize(db, item, "expired"):
                advance(db, item)
        db.execute(
            text("DELETE FROM auth_transitions WHERE terminal_at<=:cutoff"),
            {"cutoff": after(timestamp, -1800)},
        )
        db.execute(
            text("DELETE FROM rate_limit_events WHERE expires_at<=:now"),
            {"now": timestamp},
        )
        # R9 Q18 also bounds old generations in a flow that remains active.
        # Preserve only exact issued names, never tokens, CSRF or member data.
        changed = {}
        for kind, table, reference in (
            ("session", "sessions", "current_session_generation"),
            ("recovery", "recovery_credentials", "current_recovery_seq"),
        ):
            absolute = " OR absolute_expires_at<=:cutoff" if kind == "session" else ""
            rows = (
                db.execute(
                    text(
                        f"SELECT flow_id,issued_seq FROM {table} "
                        f"WHERE revoked_at<=:cutoff OR expires_at<=:cutoff{absolute}"
                    ),
                    {"cutoff": after(timestamp, -1800)},
                )
                .mappings()
                .all()
            )
            for row in rows:
                db.execute(
                    text(
                        "INSERT OR IGNORE INTO auth_retired_credentials(flow_id,kind,issued_seq) "
                        "VALUES (:flow_id,:kind,:issued_seq)"
                    ),
                    dict(row, kind=kind),
                )
                item = changed.get(row["flow_id"]) or flow(
                    db, row["flow_id"], live=False
                )
                if item[reference] == row["issued_seq"]:
                    item[reference] = None
                    changed[row["flow_id"]] = item
                    if kind == "recovery":
                        item["recovery_ready"] = 0
                db.execute(
                    text(
                        f"DELETE FROM {table} WHERE flow_id=:flow_id AND issued_seq=:issued_seq"
                    ),
                    dict(row),
                )
        for item in changed.values():
            # Cleared references and the replay fence persist in the same commit.
            save_flow(db, item)
        old = (
            db.execute(
                text(
                    "SELECT id FROM auth_flows WHERE expires_at<=:cutoff OR revoked_at<=:cutoff"
                ),
                {"cutoff": after(timestamp, -1800)},
            )
            .scalars()
            .all()
        )
        for flow_id in old:
            # ponytail: non-reuse hashes grow with retired flows; compact only with an equivalent permanent replay fence.
            db.execute(
                text(
                    "INSERT OR IGNORE INTO auth_retired_flow_ids(id_hash) VALUES (:hash)"
                ),
                {"hash": digest(flow_id)},
            )
            for table in ("sessions", "recovery_credentials", "auth_transitions"):
                db.execute(
                    text(f"DELETE FROM {table} WHERE flow_id=:id"), {"id": flow_id}
                )
            db.execute(text("DELETE FROM auth_flows WHERE id=:id"), {"id": flow_id})
        db.commit()
