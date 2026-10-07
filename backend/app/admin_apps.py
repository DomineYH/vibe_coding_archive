"""Current full administrators read every public and private app, read-only."""

import re

from fastapi import APIRouter, Request
from sqlalchemy import text

from app.admin_approval import administrator
from app.auth import Unlocked
from app.auth_boundary import AuthError, now, read_context, response
from app.auth_reauth import current_admin

router = APIRouter()
DECIMAL = re.compile(r"[0-9]+", re.ASCII)
MAX_OFFSET = 9007199254740991


def decimal(request, name, default, low, high):
    """Strict ASCII decimal query value; absent uses the default, anything else 422."""
    values = request.query_params.getlist(name)
    if not values:
        return default
    if len(values) != 1 or not DECIMAL.fullmatch(values[0]) or len(values[0]) > 40:
        raise AuthError("VALIDATION_ERROR", 422)
    value = int(values[0])
    if not low <= value <= high:
        raise AuthError("VALIDATION_ERROR", 422)
    return value


def paging(request):
    if set(request.query_params) - {"limit", "offset"}:
        raise AuthError("VALIDATION_ERROR", 422)
    return decimal(request, "limit", 24, 1, 100), decimal(
        request, "offset", 0, 0, MAX_OFFSET
    )


def admin_app(row):
    return {
        "id": row["id"],
        "owner": {"id": row["owner_id"], "nickname": row["nickname"]},
        "name": row["name"],
        "url": row["url"],
        "is_public": bool(row["is_public"]),
        "theme_id": row["theme_id"],
        "version": row["version"],
        "url_version": row["url_version"],
        "created_at": row["created_at"],
        "health": {
            "state": row["state"] or "unchecked",
            "checked_at": row["checked_at"],
            "fresh_until": row["fresh_until"],
        },
    }


@router.get("/admin/apps", operation_id="listAdminApps")
def list_admin_apps(request: Request, db=Unlocked):
    read_context(request)
    item, _ = administrator(db, request)
    current_admin(db, request)
    limit, offset = paging(request)
    rows = (
        db.execute(
            text(
                "SELECT apps.id,apps.name,apps.url,apps.is_public,apps.theme_id,"
                "apps.version,apps.url_version,apps.created_at,"
                "members.id AS owner_id,members.nickname,"
                "health_results.state,health_results.checked_at,health_results.fresh_until "
                "FROM apps JOIN members ON members.id=apps.owner_id "
                "LEFT JOIN health_results ON health_results.app_id=apps.id "
                "ORDER BY apps.created_at DESC,apps.id DESC LIMIT :limit OFFSET :offset"
            ),
            {"limit": limit, "offset": offset},
        )
        .mappings()
        .all()
    )
    total = db.execute(text("SELECT count(*) FROM apps")).scalar_one()
    return response(
        db,
        request,
        {
            "items": [admin_app(row) for row in rows],
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": total,
                "has_more": offset + len(rows) < total,
            },
            "server_time": now(),
        },
        private=True,
        metadata=item,
    )
