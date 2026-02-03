"""General audit logging for sensitive actions."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def record_audit_event(
    organization_id: str,
    action: str,
    actor_type: str,
    actor_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO audit_log (
                    id, organization_id, action, actor_type, actor_id,
                    resource_type, resource_id, metadata, created_at
                ) VALUES (
                    gen_random_uuid(), :org_id, :action, :actor_type, :actor_id,
                    :resource_type, :resource_id, CAST(:metadata AS JSONB), :created_at
                )
                """
            ),
            {
                "org_id": organization_id,
                "action": action,
                "actor_type": actor_type,
                "actor_id": actor_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "metadata": json.dumps(metadata or {}),
                "created_at": utc_now(),
            },
        )
