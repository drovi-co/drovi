"""
Extract Claims Node

Extracts claims (facts, promises, requests, questions, etc.) from content.
"""

import time

import structlog

from src.llm import get_llm_service, ClaimExtractionOutput
from src.llm.prompts_v2 import get_claim_extraction_v2_prompt
from src.personalization import get_org_profile
from ..state import (
    IntelligenceState,
    ExtractedClaim,
    ExtractedIntelligence,
    ExtractedTopic,
    NodeTiming,
    LLMCall,
)
from src.orchestrator.utils.extraction import (
    build_extraction_chunks,
    find_quote_span,
    merge_by_key,
    normalize_key,
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

    chunks = build_extraction_chunks(state.messages, max_chunk_chars=4000, overlap=200)
    if not chunks:
        return {}

    # Get LLM service
    llm = get_llm_service()
    org_profile = await get_org_profile(state.input.organization_id)

    try:
        claims = []
        llm_calls: list[LLMCall] = []

        for chunk in chunks:
            messages = get_claim_extraction_v2_prompt(
                content=chunk.content,
                source_type=state.input.source_type,
                user_email=state.input.user_email,
                memory_context=state.memory_context,
                org_profile=org_profile.model_dump() if org_profile else None,
            )

            output, llm_call = await llm.complete_structured(
                messages=messages,
                output_schema=ClaimExtractionOutput,
                model_tier="balanced",
                node_name="extract_claims",
            )

            llm_calls.append(LLMCall(
                node="extract_claims",
                model=llm_call.model,
                prompt_tokens=llm_call.prompt_tokens,
                completion_tokens=llm_call.completion_tokens,
                duration_ms=llm_call.duration_ms,
            ))

            for claim in output.claims:
                start, end = find_quote_span(chunk.content, claim.quoted_text)
                adjusted_start = (start + chunk.chunk_start) if start is not None else None
                adjusted_end = (end + chunk.chunk_start) if end is not None else None

                claims.append(ExtractedClaim(
                    type=claim.type,
                    content=claim.content,
                    quoted_text=claim.quoted_text,
                    quoted_text_start=adjusted_start,
                    quoted_text_end=adjusted_end,
                    confidence=claim.confidence,
                    source_message_id=chunk.message_id,
                    importance=claim.importance,
                    model_tier="balanced",
                    model_used=llm_call.model,
                ))

        def _merge_claims(left: ExtractedClaim, right: ExtractedClaim) -> ExtractedClaim:
            primary = left if left.confidence >= right.confidence else right
            secondary = right if primary is left else left
            if not primary.quoted_text and secondary.quoted_text:
                primary.quoted_text = secondary.quoted_text
                primary.quoted_text_start = secondary.quoted_text_start
                primary.quoted_text_end = secondary.quoted_text_end
            return primary

        claims = merge_by_key(
            claims,
            key_fn=lambda item: normalize_key(item.content) or normalize_key(item.quoted_text),
            merge_fn=_merge_claims,
        )

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
                "llm_calls": state.trace.llm_calls + llm_calls,
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
