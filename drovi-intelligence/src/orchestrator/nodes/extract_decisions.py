"""
Extract Decisions Node

Extracts decisions (choices made, pending, or reversed) from content.
"""

import time

import structlog

from src.llm import get_llm_service, DecisionExtractionOutput
from src.llm.prompts_v2 import get_decision_extraction_v2_prompt
from ..state import (
    IntelligenceState,
    ExtractedDecision,
    ExtractedIntelligence,
    NodeTiming,
    LLMCall,
)

logger = structlog.get_logger()


async def extract_decisions_node(state: IntelligenceState) -> dict:
    """
    Extract decisions from content.

    This node:
    1. Extracts all decisions (made, pending, deferred, reversed)
    2. Identifies decision makers and stakeholders
    3. Extracts rationale and implications
    4. Links to source claims

    Returns:
        State update with extracted decisions
    """
    start_time = time.time()

    logger.info(
        "Extracting decisions",
        analysis_id=state.analysis_id,
        claim_count=len(state.extracted.claims),
    )

    # Update trace
    state.trace.current_node = "extract_decisions"
    state.trace.nodes.append("extract_decisions")

    # Combine all message content
    content = "\n\n".join([msg.content for msg in state.messages])

    # Prepare claims context for the prompt
    claims_dicts = [
        {
            "type": c.type,
            "content": c.content,
            "quoted_text": c.quoted_text,
        }
        for c in state.extracted.claims
    ]

    # Get LLM service
    llm = get_llm_service()

    # Build prompt using V2 strict prompts
    messages = get_decision_extraction_v2_prompt(
        content=content,
        source_type=state.input.source_type,
        user_email=state.input.user_email,
        user_name=state.input.user_name,
    )

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=DecisionExtractionOutput,
            model_tier="balanced",
            node_name="extract_decisions",
        )

        # Convert to state decision objects
        decisions = []
        for decision in output.decisions:
            # Link to claim if specified
            claim_id = None
            if decision.claim_index is not None and decision.claim_index < len(state.extracted.claims):
                claim_id = state.extracted.claims[decision.claim_index].id

            decisions.append(ExtractedDecision(
                title=decision.title,
                statement=decision.statement,
                rationale=decision.rationale,
                decision_maker_name=decision.decision_maker_name,
                decision_maker_email=decision.decision_maker_email,
                decision_maker_is_user=decision.decision_maker_is_user,
                status=decision.status,
                stakeholders=decision.stakeholders,
                dependencies=decision.dependencies,
                implications=decision.implications,
                quoted_text=decision.quoted_text,
                confidence=decision.confidence,
                reasoning=decision.reasoning,
                claim_id=claim_id,
            ))

        # Update extracted intelligence
        extracted = ExtractedIntelligence(
            claims=state.extracted.claims,
            commitments=state.extracted.commitments,
            decisions=decisions,
            topics=state.extracted.topics,
            risks=state.extracted.risks,
        )

        logger.info(
            "Decisions extracted",
            analysis_id=state.analysis_id,
            decision_count=len(decisions),
            statuses=[d.status for d in decisions],
        )

        # Record LLM call
        trace_llm_call = LLMCall(
            node="extract_decisions",
            model=llm_call.model,
            prompt_tokens=llm_call.prompt_tokens,
            completion_tokens=llm_call.completion_tokens,
            duration_ms=llm_call.duration_ms,
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        # Update confidence
        avg_confidence = sum(d.confidence for d in decisions) / len(decisions) if decisions else 0.0

        return {
            "extracted": extracted,
            "confidence": {
                **state.confidence.model_dump(),
                "by_type": {
                    **state.confidence.by_type,
                    "decisions": avg_confidence,
                },
            },
            "trace": {
                **state.trace.model_dump(),
                "current_node": "extract_decisions",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_decisions": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Decision extraction failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "trace": {
                **state.trace.model_dump(),
                "current_node": "extract_decisions",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_decisions": node_timing,
                },
                "errors": state.trace.errors + [f"extract_decisions: {str(e)}"],
            },
        }
