"""
Extract Claims Node

Extracts claims (facts, promises, requests, questions, etc.) from content.
"""

import time

import structlog

from src.llm import get_llm_service, ClaimExtractionOutput
from src.llm.prompts_v2 import get_claim_extraction_v2_prompt
from ..state import (
    IntelligenceState,
    ExtractedClaim,
    ExtractedIntelligence,
    ExtractedTopic,
    NodeTiming,
    LLMCall,
)

logger = structlog.get_logger()


async def extract_claims_node(state: IntelligenceState) -> dict:
    """
    Extract claims from content.

    This node:
    1. Extracts all types of claims (facts, promises, requests, etc.)
    2. Links claims to source messages
    3. Updates extracted intelligence
    4. Updates confidence metrics

    Returns:
        State update with extracted claims
    """
    start_time = time.time()

    logger.info(
        "Extracting claims",
        analysis_id=state.analysis_id,
        topics=state.classification.topics,
    )

    # Update trace
    state.trace.current_node = "extract_claims"
    state.trace.nodes.append("extract_claims")

    # Combine all message content
    content = "\n\n".join([msg.content for msg in state.messages])

    # Get LLM service
    llm = get_llm_service()

    # Build prompt using V2 strict prompts
    messages = get_claim_extraction_v2_prompt(
        content=content,
        source_type=state.input.source_type,
        user_email=state.input.user_email,
    )

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=ClaimExtractionOutput,
            model_tier="balanced",
            node_name="extract_claims",
        )

        # Convert to state claim objects
        claims = []
        for i, claim in enumerate(output.claims):
            # Link to source message if possible
            source_msg_id = None
            if claim.source_message_index is not None and claim.source_message_index < len(state.messages):
                source_msg_id = state.messages[claim.source_message_index].id

            claims.append(ExtractedClaim(
                type=claim.type,
                content=claim.content,
                quoted_text=claim.quoted_text,
                confidence=claim.confidence,
                source_message_id=source_msg_id,
                importance=claim.importance,
            ))

        # Extract topics from claims
        topics = []
        for topic_name in state.classification.topics:
            topics.append(ExtractedTopic(
                name=topic_name,
                confidence=0.8,  # From classification
            ))

        # Build updated extracted intelligence
        extracted = ExtractedIntelligence(
            claims=claims,
            commitments=state.extracted.commitments,
            decisions=state.extracted.decisions,
            topics=topics,
            risks=state.extracted.risks,
        )

        logger.info(
            "Claims extracted",
            analysis_id=state.analysis_id,
            claim_count=len(claims),
            claim_types=[c.type for c in claims],
        )

        # Record LLM call
        trace_llm_call = LLMCall(
            node="extract_claims",
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
        avg_confidence = sum(c.confidence for c in claims) / len(claims) if claims else 0.0

        return {
            "extracted": extracted,
            "confidence": {
                **state.confidence.model_dump(),
                "by_type": {
                    **state.confidence.by_type,
                    "claims": avg_confidence,
                },
            },
            "trace": {
                **state.trace.model_dump(),
                "current_node": "extract_claims",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_claims": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Claim extraction failed",
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
                "current_node": "extract_claims",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_claims": node_timing,
                },
                "errors": state.trace.errors + [f"extract_claims: {str(e)}"],
            },
        }
