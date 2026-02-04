"""Evidence hash-chain utilities for tamper-evident provenance."""
from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from typing import Any
from uuid import uuid4

from sqlalchemy import text


def calculate_chain_hash(
    prev_hash: str | None,
    artifact_sha256: str | None,
    artifact_id: str,
    created_at: datetime,
    metadata_json: str | None,
) -> str:
    """Calculate deterministic hash for an evidence artifact chain entry."""
    payload = "|".join(
        [
            prev_hash or "",
            artifact_sha256 or "",
            artifact_id,
            created_at.isoformat(),
            metadata_json or "",
        ]
    )
    return sha256(payload.encode("utf-8")).hexdigest()


async def compute_chain_entry(
    session,
    organization_id: str,
    artifact_id: str,
    artifact_sha256: str | None,
    created_at: datetime,
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return chain metadata for a new evidence artifact."""
    metadata_json = None
    if metadata is not None:
        import json

        metadata_json = json.dumps(metadata, sort_keys=True)

    result = await session.execute(
        text(
            """
            SELECT chain_id, chain_sequence, chain_hash
            FROM evidence_artifact
            WHERE organization_id = :org_id
              AND chain_sequence IS NOT NULL
            ORDER BY chain_sequence DESC
            LIMIT 1
            """
        ),
        {"org_id": organization_id},
    )
    row = result.fetchone()

    if row and row.chain_id:
        chain_id = row.chain_id
        sequence = (row.chain_sequence or 0) + 1
        prev_hash = row.chain_hash
    else:
        chain_id = str(uuid4())
        sequence = 1
        prev_hash = None

    chain_hash = calculate_chain_hash(
        prev_hash=prev_hash,
        artifact_sha256=artifact_sha256,
        artifact_id=artifact_id,
        created_at=created_at,
        metadata_json=metadata_json,
    )

    return {
        "chain_id": chain_id,
        "chain_sequence": sequence,
        "chain_prev_hash": prev_hash,
        "chain_hash": chain_hash,
        "metadata_json": metadata_json,
    }
