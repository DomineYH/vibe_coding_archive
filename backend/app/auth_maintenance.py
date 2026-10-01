"""Reconcile before readiness; sweep on a bounded schedule; invalidate restored authority."""

from sqlalchemy import text

from app.auth_boundary import SEQUENCE, advance, after, digest, flow, now, terminalize


def reconcile(factory, *, restored=False):
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
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        timestamp = now()
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
