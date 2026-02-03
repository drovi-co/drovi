"""
Enrich Contacts Node

Runs contact intelligence pipeline for contacts involved in the current extraction.
This enriches contacts with:
- Relationship metrics (frequency, recency, sentiment)
- Communication profiles
- Role detection (decision-maker, influencer, etc.)
- Lifecycle stage inference
- Graph analytics
- Contact briefs
"""

import asyncio
import time

import structlog

from ..state import IntelligenceState, NodeTiming

logger = structlog.get_logger()


async def enrich_contacts_node(state: IntelligenceState) -> dict:
    """
    Enrich contacts involved in this extraction with intelligence.

    This node:
    1. Collects all contact IDs from the extraction (debtor, creditor, decision_maker, assignee)
    2. Runs the contact intelligence pipeline for each contact
    3. Updates contacts with scores, profiles, and briefs

    The enrichment is lightweight - we skip expensive graph analytics
    and only run essential enrichment on each pipeline run.
    """
    start_time = time.time()

    logger.info(
        "Enriching contacts",
        analysis_id=state.analysis_id,
    )

    # Update trace
    state.trace.current_node = "enrich_contacts"
    state.trace.nodes.append("enrich_contacts")

    # Collect unique contact IDs from extracted intelligence
    contact_ids: set[str] = set()

    # Get contacts from commitments
    for commitment in state.extracted.commitments:
        if hasattr(commitment, "debtor_contact_id") and commitment.debtor_contact_id:
            contact_ids.add(commitment.debtor_contact_id)
        if hasattr(commitment, "creditor_contact_id") and commitment.creditor_contact_id:
            contact_ids.add(commitment.creditor_contact_id)

    # Get contacts from decisions
    for decision in state.extracted.decisions:
        if hasattr(decision, "decision_maker_contact_id") and decision.decision_maker_contact_id:
            contact_ids.add(decision.decision_maker_contact_id)

    # Get contacts from tasks
    for task in state.extracted.tasks:
        if hasattr(task, "assignee_contact_id") and task.assignee_contact_id:
            contact_ids.add(task.assignee_contact_id)
        if hasattr(task, "created_by_contact_id") and task.created_by_contact_id:
            contact_ids.add(task.created_by_contact_id)

    # Also get contacts from the pre-resolved contact context if available
    if state.contact_context and state.contact_context.resolved_contacts:
        for contact in state.contact_context.resolved_contacts.values():
            contact_id = contact.get("id") if isinstance(contact, dict) else None
            if contact_id:
                contact_ids.add(contact_id)

    # Remove any None values
    contact_ids.discard(None)  # type: ignore

    if not contact_ids:
        logger.info("No contacts to enrich", analysis_id=state.analysis_id)
        state.trace.node_timings["enrich_contacts"] = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )
        return {"trace": state.trace}

    logger.info(
        "Found contacts to enrich",
        analysis_id=state.analysis_id,
        contact_count=len(contact_ids),
        contact_ids=list(contact_ids)[:5],  # Log first 5
    )

    # Run contact intelligence for each contact (with concurrency limit)
    try:
        from ..contact_pipeline.graph import run_batch_contact_intelligence

        # Run with reduced settings for per-extraction enrichment:
        # - Skip graph analytics (expensive)
        # - Low concurrency to not overwhelm the system
        await run_batch_contact_intelligence(
            contact_ids=list(contact_ids),
            organization_id=state.input.organization_id,
            include_graph_analytics=False,  # Skip expensive graph metrics
            max_concurrent=3,  # Limit concurrency
        )

        logger.info(
            "Contact enrichment complete",
            analysis_id=state.analysis_id,
            contacts_enriched=len(contact_ids),
        )

    except Exception as e:
        # Don't fail the pipeline if contact enrichment fails
        logger.error(
            "Contact enrichment failed",
            analysis_id=state.analysis_id,
            error=str(e),
            contact_count=len(contact_ids),
        )

    state.trace.node_timings["enrich_contacts"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {"trace": state.trace}
