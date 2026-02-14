"""Derived index outbox dispatcher.

The canonical truth spine lives in Postgres. Any derived views (graph indexes,
vector embeddings, fulltext projections) are built asynchronously from the
`outbox_event` table.

This module is intentionally small: it dispatches outbox event types to focused
processors so each stays under the LOC cap.
"""

from __future__ import annotations

from typing import Any

from src.contexts.uio_truth.infrastructure.derived_indexer_documents import (
    process_indexes_documents_processed_event,
)
from src.contexts.uio_truth.infrastructure.derived_indexer_evidence import (
    process_indexes_evidence_artifact_registered_event,
)
from src.contexts.uio_truth.infrastructure.derived_indexer_uio import (
    process_indexes_derived_batch_event,
)
from src.contexts.uio_truth.infrastructure.console_preaggregates import (
    refresh_console_preaggregates,
)


async def process_outbox_event(
    *,
    graph: Any,
    event_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Process a single outbox event.

    Returns a small stats dict for observability.
    """
    if event_type == "indexes.derived.batch":
        return await process_indexes_derived_batch_event(graph=graph, payload=payload)
    if event_type == "indexes.evidence.artifact.registered":
        return await process_indexes_evidence_artifact_registered_event(graph=graph, payload=payload)
    if event_type == "indexes.documents.processed":
        return await process_indexes_documents_processed_event(graph=graph, payload=payload)
    if event_type == "indexes.console.preaggregate.refresh":
        organization_id = str(payload.get("organization_id") or "")
        if not organization_id:
            raise ValueError("indexes.console.preaggregate.refresh missing organization_id")
        lookback_days = int(payload.get("lookback_days") or 90)
        return await refresh_console_preaggregates(
            organization_id=organization_id,
            lookback_days=lookback_days,
        )

    raise ValueError(f"Unknown outbox event_type: {event_type}")
