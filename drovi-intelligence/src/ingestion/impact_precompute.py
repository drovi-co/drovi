"""Lightweight impact precompute features for normalized observations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.lakehouse.writer import write_lake_record


def _as_utc(value: str | datetime | None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, str) and value.strip():
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


async def precompute_impact_features(
    *,
    organization_id: str,
    observation_id: str,
    source_type: str,
    normalized_payload: dict[str, Any],
    ingest: dict[str, Any] | None,
) -> dict[str, Any]:
    metadata = dict(normalized_payload.get("metadata") or {})
    canonical = dict(metadata.get("world_canonical") or {})
    entities = list(canonical.get("entities") or [])
    family = str(canonical.get("family") or "generic")
    ingest_meta = dict(ingest or {})
    event_time = _as_utc(ingest_meta.get("origin_ts"))
    source_reliability = float(ingest_meta.get("source_reliability") or 0.5)
    priority = int(ingest_meta.get("priority") or 5)

    feature_vector = {
        "family": family,
        "entity_count": len(entities),
        "text_length": len(str(normalized_payload.get("content") or "")),
        "source_reliability": source_reliability,
        "priority": priority,
        "has_evidence": bool(
            ingest_meta.get("evidence_artifact_id")
            or (metadata.get("world_observation_raw") or {}).get("artifact_id")
        ),
    }

    result = await write_lake_record(
        table_name="gold.impact_features",
        schema_version="1.0",
        organization_id=organization_id,
        source_key=str(source_type or "normalized"),
        record_key=f"impact_precompute:{observation_id}",
        event_time=event_time,
        payload={
            "feature_key": f"impact_precompute:{observation_id}",
            "organization_id": organization_id,
            "source_key": str(source_type or "normalized"),
            "event_time": event_time.isoformat(),
            "feature_vector": feature_vector,
            "labels": {
                "family": family,
                "observation_id": observation_id,
            },
        },
        idempotency_key=f"impact_precompute:{organization_id}:{observation_id}",
        metadata={"pipeline_stage": "impact.precompute"},
    )

    return {
        "observation_id": observation_id,
        "family": family,
        "entity_count": len(entities),
        "accepted": bool(result.accepted),
    }
