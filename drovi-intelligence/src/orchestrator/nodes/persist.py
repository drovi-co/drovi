"""
Persist Node

LangGraph adapter over the UIO Truth persistence use-case.
"""

from __future__ import annotations

import time

import structlog

from ..state import IntelligenceState, Output, NodeTiming
from src.contexts.uio_truth.application.persist_batch import persist_extraction_batch
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.monitoring import get_metrics
from src.orchestrator.context_cache import get_context_cache

logger = structlog.get_logger()


async def persist_node(state: IntelligenceState) -> dict:
    """Persist extracted intelligence to canonical truth (and derived indexes for now)."""
    start_time = time.time()

    logger.info(
        "Persisting intelligence",
        analysis_id=state.analysis_id,
        commitment_count=len(state.extracted.commitments),
        decision_count=len(state.extracted.decisions),
        task_count=len(state.extracted.tasks),
        claim_count=len(state.extracted.claims),
        risk_count=len(state.extracted.risks),
    )

    state.trace.current_node = "persist"
    state.trace.nodes.append("persist")

    envelope = PersistEnvelope(
        organization_id=state.input.organization_id,
        source_type=state.input.source_type,
        source_account_id=state.input.source_account_id,
        conversation_id=state.input.conversation_id,
        source_id=state.input.source_id,
        analysis_id=state.analysis_id,
        messages=state.messages or [],
        input_content=state.input.content,
    )

    results = PersistResults()
    metrics = get_metrics()

    try:
        # Infrastructure wiring belongs in the node; the use-case stays pure(ish).
        from src.db.client import init_db

        await init_db()

        results, errors = await persist_extraction_batch(
            envelope=envelope,
            commitments=state.extracted.commitments,
            decisions=state.extracted.decisions,
            risks=state.extracted.risks,
            tasks=state.extracted.tasks,
            claims=state.extracted.claims,
            contacts=state.extracted.contacts,
            merge_candidates=state.deduplication.merge_candidates,
            candidates_persisted=state.candidates_persisted,
            pattern_confidence_boost=state.pattern_confidence_boost or 0.0,
            brief=state.brief,
            classification=state.classification,
            contradiction_pairs=getattr(state, "contradiction_pairs", None),
            sender_email=getattr(state.input, "user_email", None),
            metrics=metrics,
        )
        state.trace.errors.extend(errors)

        # Invalidate context cache for this conversation/org when updates occur.
        if (
            results.uios_created
            or results.uios_merged
            or results.tasks_created
            or results.claims_created
            or results.contacts_created
        ):
            try:
                cache = await get_context_cache()
                if state.input.conversation_id:
                    await cache.invalidate_conversation(
                        state.input.organization_id,
                        state.input.conversation_id,
                    )
                else:
                    await cache.invalidate_org(state.input.organization_id)
            except Exception as exc:
                logger.warning("Context cache invalidation failed", error=str(exc))

    except Exception as exc:
        logger.error(
            "Persistence failed",
            analysis_id=state.analysis_id,
            error=str(exc),
        )
        state.trace.errors.append(f"persist: {str(exc)}")

    output = Output(
        uios_created=results.uios_created,
        uios_merged=results.uios_merged,
        tasks_created=results.tasks_created,
        claims_created=results.claims_created,
        contacts_created=results.contacts_created,
    )

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "output": output,
        "trace": {
            **state.trace.model_dump(),
            "current_node": "persist",
            "node_timings": {
                **state.trace.node_timings,
                "persist": node_timing,
            },
        },
    }
