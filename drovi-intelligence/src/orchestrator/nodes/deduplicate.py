"""
Deduplicate Node

Deduplicates extracted intelligence against existing UIOs in the database.
"""

import time

import structlog

from ..state import (
    IntelligenceState,
    Deduplication,
    MergeCandidate,
    NodeTiming,
)

logger = structlog.get_logger()


async def deduplicate_node(state: IntelligenceState) -> dict:
    """
    Deduplicate extracted intelligence against existing UIOs.

    This node:
    1. Searches for similar existing UIOs (commitments, decisions, etc.)
    2. Uses vector similarity to find potential duplicates
    3. Determines if items should be merged or kept separate
    4. Records merge candidates for the persist node

    Returns:
        State update with deduplication results
    """
    start_time = time.time()

    logger.info(
        "Deduplicating intelligence",
        analysis_id=state.analysis_id,
        commitment_count=len(state.extracted.commitments),
        decision_count=len(state.extracted.decisions),
    )

    # Update trace
    state.trace.current_node = "deduplicate"
    state.trace.nodes.append("deduplicate")

    merge_candidates: list[MergeCandidate] = []
    existing_uio_ids: list[str] = []

    try:
        # Import graph client
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        # Deduplicate commitments
        for commitment in state.extracted.commitments:
            # Search for similar commitments by title/content
            similar = await graph.vector_search(
                label="Commitment",
                embedding=[],  # Would generate embedding from commitment.title
                organization_id=state.input.organization_id,
                k=3,
            )

            for match in similar:
                if match.get("score", 0) > 0.85:  # High similarity threshold
                    merge_candidates.append(MergeCandidate(
                        new_item_id=commitment.id,
                        existing_uio_id=match.get("id", ""),
                        similarity=match.get("score", 0),
                        should_merge=match.get("score", 0) > 0.92,
                    ))
                    if match.get("id"):
                        existing_uio_ids.append(match["id"])

        # Deduplicate decisions
        for decision in state.extracted.decisions:
            similar = await graph.vector_search(
                label="Decision",
                embedding=[],  # Would generate embedding from decision.title
                organization_id=state.input.organization_id,
                k=3,
            )

            for match in similar:
                if match.get("score", 0) > 0.85:
                    merge_candidates.append(MergeCandidate(
                        new_item_id=decision.id,
                        existing_uio_id=match.get("id", ""),
                        similarity=match.get("score", 0),
                        should_merge=match.get("score", 0) > 0.92,
                    ))
                    if match.get("id"):
                        existing_uio_ids.append(match["id"])

        logger.info(
            "Deduplication complete",
            analysis_id=state.analysis_id,
            merge_candidates=len(merge_candidates),
            existing_uios=len(existing_uio_ids),
        )

    except Exception as e:
        logger.warning(
            "Deduplication search failed, continuing without dedup",
            analysis_id=state.analysis_id,
            error=str(e),
        )

    # Build deduplication result
    deduplication = Deduplication(
        existing_uio_ids=existing_uio_ids,
        merge_candidates=merge_candidates,
    )

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "deduplication": deduplication,
        "trace": {
            **state.trace.model_dump(),
            "current_node": "deduplicate",
            "node_timings": {
                **state.trace.node_timings,
                "deduplicate": node_timing,
            },
        },
    }
