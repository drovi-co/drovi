"""Derived communication graph relationships.

This is a best-effort derived index today; Phase 6 will move it behind an outbox.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_utils import temporal_relationship_props
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


async def persist_communications_graph(
    *,
    graph: Any,
    envelope: PersistEnvelope,
    contacts: list[Any],
    sender_email: str | None,
) -> None:
    if not sender_email:
        return
    if not contacts or len(contacts) < 2:
        return

    now = utc_now()
    rel = temporal_relationship_props(now)

    for contact in contacts:
        receiver_email = getattr(contact, "email", None)
        if not receiver_email or receiver_email == sender_email:
            continue

        try:
            await graph.query(
                """
                MATCH (sender:Contact {email: $senderEmail, organizationId: $orgId})
                MATCH (receiver:Contact {email: $receiverEmail, organizationId: $orgId})
                MERGE (sender)-[r:COMMUNICATES_WITH]->(receiver)
                ON CREATE SET r.firstContact = $now,
                              r.lastContact = $now,
                              r.messageCount = 1,
                              r.validFrom = $validFrom,
                              r.validTo = $validTo,
                              r.systemFrom = $systemFrom,
                              r.systemTo = $systemTo,
                              r.createdAt = $createdAt,
                              r.updatedAt = $updatedAt
                ON MATCH SET r.lastContact = $now,
                             r.messageCount = r.messageCount + 1,
                             r.updatedAt = $updatedAt
                """,
                {
                    "senderEmail": sender_email,
                    "receiverEmail": receiver_email,
                    "orgId": envelope.organization_id,
                    "now": now.isoformat(),
                    **rel,
                },
            )
        except Exception as exc:
            logger.warning(
                "Failed to update COMMUNICATES_WITH relationship",
                sender_email=sender_email,
                receiver_email=receiver_email,
                error=str(exc),
            )

