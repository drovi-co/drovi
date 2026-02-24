"""Persistence helpers for normalized observations (Postgres + lakehouse)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from typing import Any

from src.db.client import get_db_pool
from src.db.rls import rls_context
from src.ingestion.retention import retention_policy_for
from src.lakehouse.writer import write_lake_record


@dataclass(frozen=True)
class ObservationPersistenceResult:
    observation_id: str
    persisted_db: bool
    persisted_lakehouse: bool
    evidence_linked: bool


def _as_utc(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value.strip():
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _hash_observation(content: str, source_fingerprint: str | None) -> str:
    material = f"{source_fingerprint or ''}:{content}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


async def persist_normalized_observation(
    *,
    organization_id: str,
    normalized_id: str,
    source_type: str,
    source_id: str | None,
    event_type: str,
    normalized_payload: dict[str, Any],
    ingest: dict[str, Any] | None,
) -> ObservationPersistenceResult:
    ingest_meta = dict(ingest or {})
    metadata = dict(normalized_payload.get("metadata") or {})
    world_raw = dict(metadata.get("world_observation_raw") or {})
    world_canonical = dict(metadata.get("world_canonical") or {})
    observation_id = str(world_raw.get("observation_id") or source_id or normalized_id)
    observed_at = _as_utc(ingest_meta.get("origin_ts"))
    text_content = str(normalized_payload.get("content") or "")
    source_fingerprint = str(ingest_meta.get("source_fingerprint") or "")
    observation_hash = _hash_observation(text_content, source_fingerprint)

    title = str(normalized_payload.get("subject") or "")[:500] or None
    content_blob = {
        "text": text_content,
        "metadata": metadata,
        "conversation_id": normalized_payload.get("conversation_id"),
        "user_email": normalized_payload.get("user_email"),
        "user_name": normalized_payload.get("user_name"),
        "ingest": ingest_meta,
    }
    artifact_id = world_raw.get("artifact_id") or ingest_meta.get("evidence_artifact_id")
    high_stakes = str(world_canonical.get("family") or "").lower() in {"regulatory", "vulnerability"}
    legal_hold = bool(world_raw.get("legal_hold") or metadata.get("legal_hold"))
    retention_policy = retention_policy_for(
        retention_class="normalized_observation",
        legal_hold=legal_hold,
        high_stakes=high_stakes,
    )
    trace_id = (
        world_raw.get("trace_id")
        or ingest_meta.get("trace_id")
        or hashlib.sha256(f"trace:{organization_id}:{observation_id}".encode("utf-8")).hexdigest()[:32]
    )

    persisted_db = False
    evidence_linked = False
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO observation (
                    id,
                    organization_id,
                    source_event_id,
                    source_type,
                    source_ref,
                    observation_type,
                    title,
                    content,
                    observation_hash,
                    observed_at,
                    valid_from,
                    valid_to,
                    believed_from,
                    believed_to,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1, $2, NULL, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz,
                    $9::timestamptz, NULL, $9::timestamptz, NULL, NOW(), NOW()
                )
                ON CONFLICT (id) DO UPDATE
                SET
                    source_type = EXCLUDED.source_type,
                    source_ref = EXCLUDED.source_ref,
                    observation_type = EXCLUDED.observation_type,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    observation_hash = EXCLUDED.observation_hash,
                    observed_at = EXCLUDED.observed_at,
                    valid_from = EXCLUDED.valid_from,
                    believed_from = EXCLUDED.believed_from,
                    updated_at = NOW()
                """,
                observation_id,
                organization_id,
                source_type,
                source_id,
                event_type,
                title,
                content_blob,
                observation_hash,
                observed_at,
            )
            persisted_db = True

            if artifact_id:
                link_id = hashlib.sha256(
                    f"{organization_id}:{observation_id}:{artifact_id}".encode("utf-8")
                ).hexdigest()[:40]
                await conn.execute(
                    """
                    INSERT INTO observation_evidence_link (
                        id,
                        organization_id,
                        observation_id,
                        evidence_artifact_id,
                        unified_event_id,
                        link_type,
                        quote,
                        confidence,
                        metadata,
                        created_at
                    )
                    VALUES (
                        $1, $2, $3, $4, NULL, 'supporting', NULL, $5, $6::jsonb, NOW()
                    )
                    ON CONFLICT (id) DO UPDATE
                    SET
                        confidence = EXCLUDED.confidence,
                        metadata = EXCLUDED.metadata
                    """,
                    link_id,
                    organization_id,
                    observation_id,
                    str(artifact_id),
                    float(world_raw.get("reliability_score") or ingest_meta.get("source_reliability") or 0.5),
                    {
                        "trace_id": trace_id,
                        "artifact_sha256": world_raw.get("artifact_sha256") or ingest_meta.get("artifact_sha256"),
                        "artifact_storage_path": (
                            world_raw.get("artifact_storage_path") or ingest_meta.get("artifact_storage_path")
                        ),
                        "ingest_run_id": world_raw.get("ingest_run_id") or ingest_meta.get("ingest_run_id"),
                        "retention_class": retention_policy.retention_class,
                    },
                )
                evidence_linked = True

    lake_result = await write_lake_record(
        table_name="silver.observations",
        schema_version="1.0",
        organization_id=organization_id,
        source_key=str(source_type or "normalized"),
        record_key=f"observation:{observation_id}",
        event_time=observed_at,
        payload={
            "observation_id": observation_id,
            "organization_id": organization_id,
            "source_key": str(source_type or "normalized"),
            "observed_at": observed_at.isoformat(),
            "normalized_text": text_content,
            "entities": list((metadata.get("world_canonical") or {}).get("entities") or []),
            "evidence_links": [str(artifact_id)] if artifact_id else [],
            "metadata": {
                "event_type": event_type,
                "trace_id": trace_id,
                "ingest_run_id": world_raw.get("ingest_run_id") or ingest_meta.get("ingest_run_id"),
                "source_fingerprint": source_fingerprint,
                "retention_class": retention_policy.retention_class,
                "legal_hold": retention_policy.legal_hold,
            },
        },
        idempotency_key=f"normalized_observation:{organization_id}:{observation_id}",
        metadata={"pipeline_stage": "normalized.persist"},
        retention_days=retention_policy.retention_days,
    )

    return ObservationPersistenceResult(
        observation_id=observation_id,
        persisted_db=persisted_db,
        persisted_lakehouse=bool(lake_result.accepted),
        evidence_linked=evidence_linked,
    )
