"""Evidence audit logging for chain-of-custody."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def record_evidence_audit(
    artifact_id: str,
    organization_id: str,
    action: str,
    actor_type: str = "system",
    actor_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert an audit log entry for evidence access or mutation."""
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO evidence_audit_log (
                    id, evidence_artifact_id, organization_id,
                    action, actor_type, actor_id, metadata, created_at
                ) VALUES (
                    gen_random_uuid(), :artifact_id, :org_id,
                    :action, :actor_type, :actor_id, CAST(:metadata AS jsonb), :created_at
                )
                """
            ),
            {
                "artifact_id": artifact_id,
                "org_id": organization_id,
                "action": action,
                "actor_type": actor_type,
                "actor_id": actor_id,
                # evidence_audit_log.metadata is JSONB. Serialize explicitly for raw SQL.
                "metadata": json.dumps(metadata or {}),
                "created_at": utc_now(),
            },
        )
