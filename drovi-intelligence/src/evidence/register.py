"""Register already-uploaded objects as evidence artifacts.

Used by Smart Drive uploads (multipart to S3/R2/MinIO) where the bytes do not
flow through the /evidence/artifacts base64 API.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session
from src.evidence.audit import record_evidence_audit
from src.evidence.chain import compute_chain_entry

logger = structlog.get_logger()


async def register_evidence_artifact(
    *,
    organization_id: str,
    artifact_id: str,
    artifact_type: str,
    mime_type: str | None,
    storage_backend: str,
    storage_path: str,
    byte_size: int | None,
    sha256: str | None,
    metadata: dict[str, Any] | None = None,
    retention_days: int | None = None,
    immutable: bool | None = None,
    legal_hold: bool | None = None,
    session_id: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    actor_type: str = "system",
    actor_id: str | None = None,
) -> bool:
    """
    Insert an evidence_artifact row if it does not exist.

    Returns True when a new artifact was created, False when it already existed.
    """
    settings = get_settings()
    created_at = datetime.utcnow()

    effective_retention_days = retention_days if retention_days is not None else settings.evidence_default_retention_days
    retention_until = None
    if effective_retention_days:
        retention_until = created_at + timedelta(days=int(effective_retention_days))

    immutable_flag = immutable if immutable is not None else settings.evidence_immutable_by_default
    legal_hold_flag = legal_hold if legal_hold is not None else settings.evidence_legal_hold_by_default

    meta = dict(metadata or {})
    meta.setdefault("storage_backend", storage_backend)
    meta.setdefault("storage_path", storage_path)
    if sha256:
        meta.setdefault("sha256", sha256)
    meta.setdefault("created_at", created_at.isoformat())

    async with get_db_session() as session:
        exists = await session.execute(
            text(
                """
                SELECT 1 FROM evidence_artifact
                WHERE id = :id AND organization_id = :org_id
                """
            ),
            {"id": artifact_id, "org_id": organization_id},
        )
        if exists.fetchone():
            return False

        chain = await compute_chain_entry(
            session=session,
            organization_id=organization_id,
            artifact_id=artifact_id,
            artifact_sha256=sha256,
            created_at=created_at,
            metadata=meta,
        )
        chain.pop("metadata_json", None)

        await session.execute(
            text(
                """
                INSERT INTO evidence_artifact (
                    id, organization_id, session_id, source_type, source_id,
                    artifact_type, mime_type, storage_backend, storage_path,
                    byte_size, sha256, metadata, created_at,
                    retention_until, immutable, legal_hold,
                    chain_id, chain_sequence, chain_prev_hash, chain_hash
                ) VALUES (
                    :id, :org_id, :session_id, :source_type, :source_id,
                    :artifact_type, :mime_type, :storage_backend, :storage_path,
                    :byte_size, :sha256, CAST(:metadata AS jsonb), :created_at,
                    :retention_until, :immutable, :legal_hold,
                    :chain_id, :chain_sequence, :chain_prev_hash, :chain_hash
                )
                """
            ),
            {
                "id": artifact_id,
                "org_id": organization_id,
                "session_id": session_id,
                "source_type": source_type,
                "source_id": source_id,
                "artifact_type": artifact_type,
                "mime_type": mime_type,
                "storage_backend": storage_backend,
                "storage_path": storage_path,
                "byte_size": byte_size,
                "sha256": sha256,
                # evidence_artifact.metadata is JSONB. Serialize explicitly for raw SQL.
                "metadata": json.dumps(meta) if meta is not None else None,
                "created_at": created_at,
                "retention_until": retention_until,
                "immutable": immutable_flag,
                "legal_hold": legal_hold_flag,
                "chain_id": chain.get("chain_id"),
                "chain_sequence": chain.get("chain_sequence"),
                "chain_prev_hash": chain.get("chain_prev_hash"),
                "chain_hash": chain.get("chain_hash"),
            },
        )
        await session.commit()

    try:
        await record_evidence_audit(
            artifact_id=artifact_id,
            organization_id=organization_id,
            action="created",
            actor_type=actor_type,
            actor_id=actor_id,
            metadata={"artifact_type": artifact_type},
        )
    except Exception as exc:
        logger.warning("Failed to record evidence audit for registered artifact", error=str(exc))

    return True
