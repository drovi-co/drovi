"""Evidence hash-chain utilities for tamper-evident provenance."""
from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from typing import Any
from uuid import uuid4

from sqlalchemy import text

COGNITIVE_CHAIN_SUBJECT_TYPES = {
    "observation",
    "belief",
    "hypothesis",
    "constraint_violation_candidate",
    "impact_edge",
    "intervention_plan",
    "realized_outcome",
}


def build_cognitive_chain_metadata(
    *,
    subject_type: str,
    subject_id: str,
    subject_hash: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create canonical evidence chain metadata for cognitive object references."""
    if subject_type not in COGNITIVE_CHAIN_SUBJECT_TYPES:
        supported = ", ".join(sorted(COGNITIVE_CHAIN_SUBJECT_TYPES))
        raise ValueError(f"Unsupported subject_type '{subject_type}'. Expected one of: {supported}")

    payload: dict[str, Any] = {
        "subject_type": subject_type,
        "subject_id": subject_id,
    }
    if subject_hash:
        payload["subject_hash"] = subject_hash
    if extra:
        payload["extra"] = extra
    return payload


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
