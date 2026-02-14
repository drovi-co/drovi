"""Derived index processing for evidence artifacts.

Today evidence artifacts are primarily stored and queried from Postgres + the
object store. We still emit outbox events when an artifact is registered so we
can later add optional graph projections (e.g., link evidence to UIOs, documents,
and audits).

For now, this processor is a no-op that simply validates the payload shape so
the outbox queue does not accumulate failed events.
"""

from __future__ import annotations

from typing import Any


async def process_indexes_evidence_artifact_registered_event(
    *,
    graph: Any,
    payload: dict[str, Any],
) -> dict[str, Any]:
    organization_id = str(payload.get("organization_id") or payload.get("org_id") or payload.get("orgId") or "")
    artifact_id = str(payload.get("artifact_id") or "")
    if not organization_id or not artifact_id:
        raise ValueError("indexes.evidence.artifact.registered payload missing organization_id/artifact_id")

    # Intentionally no graph write yet. Keep this event type as a stable seam.
    return {
        "organization_id": organization_id,
        "artifact_id": artifact_id,
        "ok": True,
    }

