"""Raw observation evidence capture utilities.

Ensures every raw payload is durably persisted as an immutable evidence artifact
before downstream normalization/transforms run.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from src.config import get_settings
from src.evidence.register import register_evidence_artifact
from src.ingestion.retention import retention_policy_for


@dataclass(frozen=True)
class RawObservationArtifact:
    artifact_id: str
    sha256: str
    byte_size: int
    storage_path: str
    observed_at: datetime


def _as_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _artifact_path(*, organization_id: str, observed_at: datetime, artifact_id: str) -> Path:
    settings = get_settings()
    root = Path(settings.evidence_storage_path).expanduser()
    return (
        root
        / "raw_observations"
        / organization_id
        / f"{observed_at.year:04d}"
        / f"{observed_at.month:02d}"
        / f"{observed_at.day:02d}"
        / f"{artifact_id}.json"
    )


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


async def persist_raw_observation_payload(
    *,
    organization_id: str,
    source_type: str,
    source_id: str | None,
    payload: dict[str, Any],
    artifact_id: str | None = None,
    observed_at: datetime | None = None,
    metadata: dict[str, Any] | None = None,
    retention_days: int | None = None,
    immutable: bool | None = None,
    legal_hold: bool = False,
    high_stakes: bool = False,
) -> RawObservationArtifact:
    """
    Persist raw observation payload to object/evidence storage and register it.
    """
    observed_ts = _as_utc(observed_at)
    resolved_artifact_id = artifact_id or f"obsraw-{uuid4()}"
    body = _json_bytes(payload)
    sha256 = hashlib.sha256(body).hexdigest()
    storage_path = _artifact_path(
        organization_id=organization_id,
        observed_at=observed_ts,
        artifact_id=resolved_artifact_id,
    )
    storage_path.parent.mkdir(parents=True, exist_ok=True)
    storage_path.write_bytes(body)

    register_metadata = {
        "capture_kind": "raw_observation",
        "source_type": source_type,
        "observed_at": observed_ts.isoformat(),
        **(metadata or {}),
    }
    policy = retention_policy_for(
        retention_class="raw_observation",
        legal_hold=bool(legal_hold),
        high_stakes=bool(high_stakes),
    )
    resolved_retention_days = retention_days if retention_days is not None else policy.retention_days
    resolved_immutable = bool(policy.immutable if immutable is None else immutable)
    resolved_legal_hold = bool(policy.legal_hold or legal_hold)

    await register_evidence_artifact(
        organization_id=organization_id,
        artifact_id=resolved_artifact_id,
        artifact_type="raw_observation",
        mime_type="application/json",
        storage_backend="filesystem",
        storage_path=str(storage_path),
        byte_size=len(body),
        sha256=sha256,
        metadata=register_metadata,
        retention_days=resolved_retention_days,
        immutable=resolved_immutable,
        legal_hold=resolved_legal_hold,
        source_type=source_type,
        source_id=source_id,
        actor_type="system",
        actor_id="kafka_producer",
    )

    return RawObservationArtifact(
        artifact_id=resolved_artifact_id,
        sha256=sha256,
        byte_size=len(body),
        storage_path=str(storage_path),
        observed_at=observed_ts,
    )


async def register_existing_raw_observation_artifact(
    *,
    organization_id: str,
    source_type: str,
    source_id: str | None,
    storage_path: str,
    payload_sha256: str,
    payload_size_bytes: int,
    artifact_id: str | None = None,
    observed_at: datetime | None = None,
    metadata: dict[str, Any] | None = None,
    retention_days: int | None = None,
    immutable: bool | None = None,
    legal_hold: bool = False,
    high_stakes: bool = False,
) -> RawObservationArtifact:
    """
    Register an already persisted payload (e.g. crawler snapshots) as evidence.
    """
    observed_ts = _as_utc(observed_at)
    resolved_artifact_id = artifact_id or f"obsraw-{uuid4()}"
    policy = retention_policy_for(
        retention_class="raw_observation",
        legal_hold=bool(legal_hold),
        high_stakes=bool(high_stakes),
    )
    resolved_retention_days = retention_days if retention_days is not None else policy.retention_days
    resolved_immutable = bool(policy.immutable if immutable is None else immutable)
    resolved_legal_hold = bool(policy.legal_hold or legal_hold)
    await register_evidence_artifact(
        organization_id=organization_id,
        artifact_id=resolved_artifact_id,
        artifact_type="raw_observation",
        mime_type="application/octet-stream",
        storage_backend="filesystem",
        storage_path=storage_path,
        byte_size=int(max(0, payload_size_bytes)),
        sha256=payload_sha256,
        metadata={
            "capture_kind": "raw_observation_existing",
            "source_type": source_type,
            "observed_at": observed_ts.isoformat(),
            **(metadata or {}),
        },
        retention_days=resolved_retention_days,
        immutable=resolved_immutable,
        legal_hold=resolved_legal_hold,
        source_type=source_type,
        source_id=source_id,
        actor_type="system",
        actor_id="crawler_pipeline",
    )
    return RawObservationArtifact(
        artifact_id=resolved_artifact_id,
        sha256=payload_sha256,
        byte_size=int(max(0, payload_size_bytes)),
        storage_path=storage_path,
        observed_at=observed_ts,
    )
