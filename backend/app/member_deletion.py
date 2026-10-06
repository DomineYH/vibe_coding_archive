"""Transaction-only removal of a member and its existing dependent authority."""

from sqlalchemy import text

from app.auth_boundary import advance, flow, increment, save_flow, terminalize


def delete_member(db, member_id, stamp, *, app_ids=()):
    sessions = (
        db.execute(
            text("SELECT flow_id,issued_seq FROM sessions WHERE member_id=:id"),
            {"id": member_id},
        )
        .mappings()
        .all()
    )
    for flow_id in {row["flow_id"] for row in sessions}:
        item = flow(db, flow_id, live=False)
        terminalize(db, item, "cancelled")
        item["revoked_at"] = item["revoked_at"] or stamp
        item["last_identity_change_revision"] = increment(item["revision"])
        advance(db, item)
        for table in ("sessions", "recovery_credentials"):
            db.execute(
                text(
                    f"UPDATE {table} SET revoked_at=COALESCE(revoked_at,:stamp) WHERE flow_id=:flow"
                ),
                {"stamp": stamp, "flow": flow_id},
            )
        removed = {row["issued_seq"] for row in sessions if row["flow_id"] == flow_id}
        if item["current_session_generation"] in removed:
            item["current_session_generation"] = None
        save_flow(db, item)
    for row in sessions:
        db.execute(
            text(
                "INSERT OR IGNORE INTO auth_retired_credentials(flow_id,kind,issued_seq) VALUES (:flow_id,'session',:issued_seq)"
            ),
            dict(row),
        )
    db.execute(text("DELETE FROM sessions WHERE member_id=:id"), {"id": member_id})
    db.execute(
        text("DELETE FROM write_operations WHERE actor_id=:id"), {"id": member_id}
    )
    for app_id in app_ids:
        db.execute(text("DELETE FROM apps WHERE id=:id"), {"id": app_id})
    db.execute(text("DELETE FROM apps WHERE owner_id=:id"), {"id": member_id})
    db.execute(text("DELETE FROM members WHERE id=:id"), {"id": member_id})
