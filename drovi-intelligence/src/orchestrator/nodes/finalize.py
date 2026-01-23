"""
Finalize Node

Finalizes the analysis and prepares the output.
Also triggers graph algorithm updates when new contacts are created.
"""

import time

import structlog

from ..state import (
    IntelligenceState,
    Confidence,
    NodeTiming,
)

logger = structlog.get_logger()


async def _update_contact_scores(organization_id: str) -> None:
    """
    Update contact PageRank and community scores.

    This is called when new contacts or relationships are created
    to keep the social graph metrics up to date.
    """
    try:
        from src.graph.algorithms import GraphAlgorithms
        from src.graph.client import get_graph_client

        graph = await get_graph_client()
        algorithms = GraphAlgorithms()

        # Run PageRank on contacts
        pagerank_results = await algorithms.pagerank(
            organization_id=organization_id,
            node_label="Contact",
            relationship_types=["COMMUNICATES_WITH", "PARTICIPATED_IN"],
            limit=1000,  # Update top 1000 contacts
        )

        # Update contact nodes with PageRank scores
        for result in pagerank_results:
            await graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                SET c.pagerankScore = $score
                """,
                {
                    "contactId": result.node_id,
                    "orgId": organization_id,
                    "score": result.score,
                },
            )

        logger.info(
            "Contact scores updated",
            organization_id=organization_id,
            contacts_updated=len(pagerank_results),
        )

    except Exception as e:
        # Non-fatal - just log the error
        logger.warning(
            "Failed to update contact scores",
            organization_id=organization_id,
            error=str(e),
        )


async def finalize_node(state: IntelligenceState) -> dict:
    """
    Finalize the analysis and prepare output.

    This node:
    1. Calculates overall confidence scores
    2. Determines if human review is needed
    3. Completes the execution trace
    4. Prepares the final response

    Returns:
        State update with finalized results
    """
    start_time = time.time()

    logger.info(
        "Finalizing analysis",
        analysis_id=state.analysis_id,
    )

    # Update trace
    state.trace.current_node = "finalize"
    state.trace.nodes.append("finalize")

    # Calculate overall confidence
    confidence_values = list(state.confidence.by_type.values())
    overall_confidence = (
        sum(confidence_values) / len(confidence_values)
        if confidence_values
        else 0.0
    )

    # Update contact graph scores if new contacts were created
    if len(state.output.contacts_created) > 0:
        await _update_contact_scores(state.input.organization_id)

    # Determine if human review is needed
    needs_review = (
        overall_confidence < 0.5
        or state.routing.escalate_to_human
        or len(state.trace.errors) > 0
        or any(r.severity in ["high", "critical"] for r in state.extracted.risks)
    )

    review_reason = None
    if needs_review:
        if overall_confidence < 0.5:
            review_reason = "Low overall confidence"
        elif state.routing.escalate_to_human:
            review_reason = "Escalation requested during processing"
        elif len(state.trace.errors) > 0:
            review_reason = f"Processing errors: {', '.join(state.trace.errors)}"
        elif any(r.severity in ["high", "critical"] for r in state.extracted.risks):
            review_reason = "High severity risks detected"

    # Build final confidence
    confidence = Confidence(
        overall=overall_confidence,
        by_type=state.confidence.by_type,
        needs_review=needs_review,
        review_reason=review_reason,
    )

    # Complete trace
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    trace_completed_at = time.time()

    # Calculate total processing time
    total_time_ms = int((trace_completed_at - state.trace.started_at) * 1000)

    # Calculate total LLM tokens
    total_prompt_tokens = sum(call.prompt_tokens for call in state.trace.llm_calls)
    total_completion_tokens = sum(call.completion_tokens for call in state.trace.llm_calls)

    logger.info(
        "Analysis finalized",
        analysis_id=state.analysis_id,
        overall_confidence=overall_confidence,
        needs_review=needs_review,
        total_time_ms=total_time_ms,
        total_prompt_tokens=total_prompt_tokens,
        total_completion_tokens=total_completion_tokens,
        claims_count=len(state.extracted.claims),
        commitments_count=len(state.extracted.commitments),
        decisions_count=len(state.extracted.decisions),
        risks_count=len(state.extracted.risks),
        uios_created=len(state.output.uios_created),
        uios_merged=len(state.output.uios_merged),
    )

    return {
        "confidence": confidence,
        "trace": {
            **state.trace.model_dump(),
            "current_node": None,
            "completed_at": trace_completed_at,
            "node_timings": {
                **state.trace.node_timings,
                "finalize": node_timing,
            },
        },
    }
