"""
Extract Commitments Node

Extracts commitments (promises, obligations, agreements) from content.
"""

import time

import structlog

from src.llm import get_llm_service, CommitmentExtractionOutput
from src.llm.prompts_v2 import get_commitment_extraction_v2_prompt
from ..state import (
    IntelligenceState,
    ExtractedCommitment,
    ExtractedIntelligence,
    NodeTiming,
    LLMCall,
)

logger = structlog.get_logger()


async def extract_commitments_node(state: IntelligenceState) -> dict:
    """
    Extract commitments from content.

    This node:
    1. Extracts all commitments (promises, agreements, obligations)
    2. Determines direction (owed_by_me vs owed_to_me)
    3. Extracts due dates and conditions
    4. Links to source claims

    Returns:
        State update with extracted commitments
    """
    start_time = time.time()

    logger.info(
        "Extracting commitments",
        analysis_id=state.analysis_id,
        claim_count=len(state.extracted.claims),
    )

    # Update trace
    state.trace.current_node = "extract_commitments"
    state.trace.nodes.append("extract_commitments")

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
    messages = get_commitment_extraction_v2_prompt(
        content=content,
        source_type=state.input.source_type,
        user_email=state.input.user_email,
        user_name=state.input.user_name,
        contact_context=state.contact_context.resolved_contacts if state.contact_context else None,
        memory_context=state.memory_context,
    )

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=CommitmentExtractionOutput,
            model_tier="balanced",
            node_name="extract_commitments",
        )

        # Convert to state commitment objects
        commitments = []
        for commitment in output.commitments:
            # Link to claim if specified
            claim_id = None
            if commitment.claim_index is not None and commitment.claim_index < len(state.extracted.claims):
                claim_id = state.extracted.claims[commitment.claim_index].id

            commitments.append(ExtractedCommitment(
                title=commitment.title,
                description=commitment.description,
                direction=commitment.direction,
                priority=commitment.priority,
                debtor_name=commitment.debtor_name,
                debtor_email=commitment.debtor_email,
                debtor_is_user=commitment.debtor_is_user,
                creditor_name=commitment.creditor_name,
                creditor_email=commitment.creditor_email,
                creditor_is_user=commitment.creditor_is_user,
                due_date=commitment.due_date,
                due_date_text=commitment.due_date_text,
                due_date_confidence=commitment.due_date_confidence,
                due_date_is_explicit=commitment.due_date_is_explicit,
                is_conditional=commitment.is_conditional,
                condition=commitment.condition,
                quoted_text=commitment.quoted_text,
                confidence=commitment.confidence,
                reasoning=commitment.reasoning,
                claim_id=claim_id,
            ))

        # Update extracted intelligence
        extracted = ExtractedIntelligence(
            claims=state.extracted.claims,
            commitments=commitments,
            decisions=state.extracted.decisions,
            topics=state.extracted.topics,
            risks=state.extracted.risks,
        )

        logger.info(
            "Commitments extracted",
            analysis_id=state.analysis_id,
            commitment_count=len(commitments),
            owed_by_me=sum(1 for c in commitments if c.direction == "owed_by_me"),
            owed_to_me=sum(1 for c in commitments if c.direction == "owed_to_me"),
        )

        # Record LLM call
        trace_llm_call = LLMCall(
            node="extract_commitments",
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
        avg_confidence = sum(c.confidence for c in commitments) / len(commitments) if commitments else 0.0

        return {
            "extracted": extracted,
            "confidence": {
                **state.confidence.model_dump(),
                "by_type": {
                    **state.confidence.by_type,
                    "commitments": avg_confidence,
                },
            },
            "trace": {
                **state.trace.model_dump(),
                "current_node": "extract_commitments",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_commitments": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Commitment extraction failed",
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
                "current_node": "extract_commitments",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_commitments": node_timing,
                },
                "errors": state.trace.errors + [f"extract_commitments: {str(e)}"],
            },
        }
