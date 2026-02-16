"""Episode graph persistence.

Episodes are a derived graph construct used for temporal/audit exploration.
Phase 6 will move this behind an outbox.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import structlog

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_utils import (
    serialize_for_graph,
    temporal_graph_props,
    temporal_relationship_props,
)
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


async def persist_episode(
    *,
    graph: Any,
    envelope: PersistEnvelope,
    uios_created: list[dict[str, Any]],
) -> str | None:
    """Create an Episode node and link it to created UIOs. Returns episode id."""
    try:
        episode_id = str(uuid4())
        episode_now = utc_now()
        await graph.query(
            """
            CREATE (e:Episode {
                id: $id,
                organizationId: $orgId,
                sourceType: $sourceType,
                sourceId: $sourceId,
                analysisId: $analysisId,
                createdAt: $createdAt,
                validFrom: $validFrom,
                validTo: $validTo,
                systemFrom: $systemFrom,
                systemTo: $systemTo
            })
            RETURN e
            """,
            {
                "id": episode_id,
                "orgId": serialize_for_graph(envelope.organization_id),
                "sourceType": serialize_for_graph(envelope.source_type),
                "sourceId": serialize_for_graph(envelope.source_id),
                "analysisId": serialize_for_graph(envelope.analysis_id),
                "createdAt": episode_now.isoformat(),
                **temporal_graph_props(episode_now),
            },
        )

        rel = temporal_relationship_props(episode_now)
        for uio in uios_created:
            uio_id = uio.get("id")
            if not uio_id:
                continue
            try:
                await graph.query(
                    """
                    MATCH (e:Episode {id: $episodeId})
                    MATCH (u {id: $uioId})
                    CREATE (e)-[r:EXTRACTED]->(u)
                    SET r.validFrom = $validFrom,
                        r.validTo = $validTo,
                        r.systemFrom = $systemFrom,
                        r.systemTo = $systemTo,
                        r.createdAt = $createdAt,
                        r.updatedAt = $updatedAt
                    """,
                    {
                        "episodeId": episode_id,
                        "uioId": uio_id,
                        **rel,
                    },
                )
            except Exception as exc:
                logger.warning("Failed to link episode to UIO", episode_id=episode_id, uio_id=uio_id, error=str(exc))

        return episode_id
    except Exception as exc:
        logger.warning("Failed to persist episode", error=str(exc))
        return None

