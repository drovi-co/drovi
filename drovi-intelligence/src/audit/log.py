"""General audit logging for sensitive actions."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import rls_context
from src.kernel.hashing import sha256_hexdigest
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now


async def record_audit_event(
    organization_id: str,
    action: str,
    actor_type: str,
    actor_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            now = utc_now()
            metadata_payload = metadata or {}

            head = await session.execute(
                text(
                    """
                    SELECT organization_id, last_sequence, last_hash
                    FROM audit_ledger_head
                    WHERE organization_id = :org_id
                    FOR UPDATE
                    """
                ),
                {"org_id": organization_id},
            )
            head_row = head.fetchone()
            if not head_row:
                await session.execute(
                    text(
                        """
                        INSERT INTO audit_ledger_head (
                            organization_id, last_sequence, last_hash, updated_at
                        ) VALUES (:org_id, 0, NULL, :updated_at)
                        """
                    ),
                    {"org_id": organization_id, "updated_at": now},
                )
                last_sequence = 0
                last_hash = None
            else:
                last_sequence = int(head_row.last_sequence or 0)
                last_hash = head_row.last_hash

            sequence = last_sequence + 1
            entry_payload = {
                "organization_id": organization_id,
                "sequence": sequence,
                "action": action,
                "actor_type": actor_type,
                "actor_id": actor_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "metadata": metadata_payload,
                "created_at": now.isoformat(),
                "prev_hash": last_hash,
            }
            serialized = json_dumps_canonical(entry_payload)
            entry_hash = sha256_hexdigest(serialized.encode("utf-8"))

            await session.execute(
                text(
                    """
                    INSERT INTO audit_log (
                        id, organization_id, action, actor_type, actor_id,
                        resource_type, resource_id, metadata, created_at,
                        sequence, prev_hash, entry_hash
                    ) VALUES (
                        gen_random_uuid(), :org_id, :action, :actor_type, :actor_id,
                        :resource_type, :resource_id, CAST(:metadata AS JSONB), :created_at,
                        :sequence, :prev_hash, :entry_hash
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
                    "metadata": json.dumps(metadata_payload),
                    "created_at": now,
                    "sequence": sequence,
                    "prev_hash": last_hash,
                    "entry_hash": entry_hash,
                },
            )

            await session.execute(
                text(
                    """
                    UPDATE audit_ledger_head
                    SET last_sequence = :sequence,
                        last_hash = :entry_hash,
                        updated_at = :updated_at
                    WHERE organization_id = :org_id
                    """
                ),
                {
                    "sequence": sequence,
                    "entry_hash": entry_hash,
                    "updated_at": now,
                    "org_id": organization_id,
                },
            )
