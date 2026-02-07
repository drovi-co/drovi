"""
Private Source Visibility Enforcement

Drovi supports "private" connections (sources) that only the connector owner
and org admins can access. Derived intelligence must respect this boundary.

Core rule (enforced at read time):
- Admin/internal: can see everything.
- Session user: cannot see any UIO that has *any* evidence from a private
  connection owned by a different user.
- Non-session API key: cannot see any UIO that has *any* evidence from a private
  connection (because there is no user boundary).
"""

from __future__ import annotations

from collections.abc import Sequence

import structlog
from fastapi import HTTPException
from sqlalchemy import text

from src.auth.middleware import APIKeyContext
from src.auth.scopes import Scope
from src.db.client import get_db_session

logger = structlog.get_logger()


def get_session_user_id(ctx: APIKeyContext) -> str | None:
    """
    Best-effort extraction of the session user_id from APIKeyContext.

    Session auth sets:
      key_id = "session:<user_id>"
    """
    key_id = ctx.key_id
    if not key_id or not isinstance(key_id, str):
        return None
    if not key_id.startswith("session:"):
        return None
    user_id = key_id.split("session:", 1)[1]
    return user_id or None


def is_admin_or_internal(ctx: APIKeyContext) -> bool:
    return bool(ctx.is_internal or ctx.has_scope(Scope.ADMIN))


async def filter_visible_uio_ids(
    organization_id: str,
    uio_ids: Sequence[str],
    ctx: APIKeyContext,
) -> set[str]:
    """
    Return the subset of `uio_ids` that is visible for this auth context.
    """
    if not uio_ids:
        return set()

    return await filter_visible_uio_ids_for_user(
        organization_id=organization_id,
        uio_ids=uio_ids,
        session_user_id=get_session_user_id(ctx),
        is_admin=is_admin_or_internal(ctx),
    )


async def filter_visible_uio_ids_for_user(
    organization_id: str,
    uio_ids: Sequence[str],
    *,
    session_user_id: str | None,
    is_admin: bool,
) -> set[str]:
    """
    Visibility filter that does not require an APIKeyContext.

    Use this from non-FastAPI layers (e.g., GraphRAG) where we only have the
    authenticated user id and an admin flag.
    """
    if not uio_ids:
        return set()

    if is_admin:
        return set(map(str, uio_ids))

    async with get_db_session() as session:
        if session_user_id:
            hidden = await session.execute(
                text(
                    """
                    SELECT DISTINCT uos_priv.unified_object_id AS uio_id
                    FROM unified_object_source uos_priv
                    JOIN connections c_priv
                      ON c_priv.organization_id = :org_id
                     AND c_priv.id::text = uos_priv.source_account_id
                    WHERE uos_priv.unified_object_id = ANY(:uio_ids)
                      AND c_priv.visibility = 'private'
                      AND (c_priv.created_by_user_id IS DISTINCT FROM :current_user_id)
                    """
                ),
                {
                    "org_id": organization_id,
                    "uio_ids": list(map(str, uio_ids)),
                    "current_user_id": session_user_id,
                },
            )
        else:
            hidden = await session.execute(
                text(
                    """
                    SELECT DISTINCT uos_priv.unified_object_id AS uio_id
                    FROM unified_object_source uos_priv
                    JOIN connections c_priv
                      ON c_priv.organization_id = :org_id
                     AND c_priv.id::text = uos_priv.source_account_id
                    WHERE uos_priv.unified_object_id = ANY(:uio_ids)
                      AND c_priv.visibility = 'private'
                    """
                ),
                {
                    "org_id": organization_id,
                    "uio_ids": list(map(str, uio_ids)),
                },
            )

        hidden_ids = {
            str(row.uio_id)
            for row in hidden.fetchall()
            if getattr(row, "uio_id", None)
        }

    return set(map(str, uio_ids)) - hidden_ids


async def require_uio_visible(
    organization_id: str,
    uio_id: str,
    ctx: APIKeyContext,
    *,
    not_found_as_404: bool = True,
) -> None:
    """
    Enforce UIO visibility. Raises HTTPException if not visible.

    When `not_found_as_404` is True, we return 404 for invisible UIOs to avoid
    leaking existence.
    """
    visible = await filter_visible_uio_ids(organization_id, [uio_id], ctx)
    if uio_id in visible:
        return
    status = 404 if not_found_as_404 else 403
    raise HTTPException(status_code=status, detail="Not found" if status == 404 else "Access denied")
