"""Contradiction persistence and supersession side-effects.

Contradictions are recorded via the UIO manager (domain service). Some contradiction
types also imply explicit supersession in the bi-temporal truth spine.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.supersession import apply_supersession
from src.kernel.time import utc_now_naive as utc_now
from src.uio.manager import get_uio_manager

logger = structlog.get_logger()


async def persist_contradictions(
    *,
    envelope: PersistEnvelope,
    contradiction_pairs: list[dict[str, Any]] | None,
    created_uio_by_extracted_id: dict[str, dict[str, Any]],
) -> None:
    if not contradiction_pairs:
        return

    supersession_types = {
        "explicit_negation",
        "policy_change",
        "reversal",
        "supersedes",
    }

    manager = await get_uio_manager(envelope.organization_id)

    for pair in contradiction_pairs:
        mapping = created_uio_by_extracted_id.get(pair.get("new_id"))
        if not mapping:
            continue

        new_uio_id = mapping.get("uio_id")
        existing_uio_id = pair.get("existing_id")
        if not new_uio_id or not existing_uio_id:
            continue

        contradiction_type = pair.get("contradiction_type", "content_conflict")
        severity = pair.get("severity", "medium")
        evidence_id = mapping.get("evidence_id")
        evidence_quote = pair.get("evidence") or None

        try:
            await manager.record_contradiction(
                uio_a_id=new_uio_id,
                uio_b_id=existing_uio_id,
                contradiction_type=contradiction_type,
                severity=severity,
                evidence_quote=evidence_quote,
                evidence_artifact_id=evidence_id,
                detected_by="system",
                sync_graph=False,
            )
        except Exception as exc:
            logger.warning("Failed to record contradiction", error=str(exc))

        if contradiction_type in supersession_types:
            try:
                from src.db.client import get_db_session

                async with get_db_session() as session:
                    await apply_supersession(
                        session,
                        now=utc_now(),
                        organization_id=envelope.organization_id,
                        existing_uio_id=existing_uio_id,
                        new_uio_id=new_uio_id,
                        uio_type=mapping.get("type", "decision"),
                        evidence_id=evidence_id,
                        source_type=envelope.source_type or "email",
                        conversation_id=envelope.conversation_id,
                        message_id=None,
                    )
            except Exception as exc:
                logger.warning("Failed to apply supersession for contradiction", error=str(exc))
