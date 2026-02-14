"""Evidence audit helpers for UIO source linkage."""

from __future__ import annotations

from src.evidence.audit import record_evidence_audit


async def audit_uio_source(
    *,
    organization_id: str,
    evidence_id: str,
    uio_id: str,
    uio_type: str,
    action: str,
    conversation_id: str | None = None,
    message_id: str | None = None,
) -> None:
    """Record an evidence audit entry for UIO creation/updates."""
    await record_evidence_audit(
        artifact_id=evidence_id,
        organization_id=organization_id,
        action=action,
        actor_type="system",
        metadata={
            "uio_id": uio_id,
            "uio_type": uio_type,
            "conversation_id": conversation_id,
            "message_id": message_id,
        },
    )

