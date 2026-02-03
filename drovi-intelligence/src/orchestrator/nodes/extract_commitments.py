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
    EvidenceSpan,
    NodeTiming,
    LLMCall,
)
from src.orchestrator.utils.extraction import (
    build_extraction_chunks,
    find_quote_span,
    merge_by_key,
    normalize_key,
    build_supporting_evidence,
)

logger = structlog.get_logger()


def _dedupe_evidence(evidence: list[EvidenceSpan]) -> list[EvidenceSpan]:
    seen: set[tuple] = set()
    deduped: list[EvidenceSpan] = []
    for span in evidence:
        key = (span.quoted_text, span.source_message_id, span.quoted_text_start, span.quoted_text_end)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(span)
    return deduped


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

    chunks = build_extraction_chunks(state.messages, max_chunk_chars=4000, overlap=200)
    if not chunks:
        return {}

    # Get LLM service
    llm = get_llm_service()

    try:
        commitments: list[ExtractedCommitment] = []
        llm_calls: list[LLMCall] = []

        for chunk in chunks:
            messages = get_commitment_extraction_v2_prompt(
                content=chunk.content,
                source_type=state.input.source_type,
                user_email=state.input.user_email,
                user_name=state.input.user_name,
                contact_context=state.contact_context.resolved_contacts if state.contact_context else None,
                memory_context=state.memory_context,
            )

            output, llm_call = await llm.complete_structured(
                messages=messages,
                output_schema=CommitmentExtractionOutput,
                model_tier="balanced",
                node_name="extract_commitments",
            )

            llm_calls.append(LLMCall(
                node="extract_commitments",
                model=llm_call.model,
                prompt_tokens=llm_call.prompt_tokens,
                completion_tokens=llm_call.completion_tokens,
                duration_ms=llm_call.duration_ms,
            ))

            for commitment in output.commitments:
                claim_id = None
                if commitment.claim_index is not None and commitment.claim_index < len(state.extracted.claims):
                    claim_id = state.extracted.claims[commitment.claim_index].id

                start, end = find_quote_span(chunk.content, commitment.quoted_text)
                adjusted_start = (start + chunk.chunk_start) if start is not None else None
                adjusted_end = (end + chunk.chunk_start) if end is not None else None

                supporting_evidence: list[EvidenceSpan] = []
                for span in commitment.supporting_quotes:
                    span_start = span.quoted_text_start
                    span_end = span.quoted_text_end
                    if span_start is None or span_end is None:
                        span_start, span_end = find_quote_span(chunk.content, span.quoted_text)
                    if span_start is not None:
                        supporting_evidence.append(EvidenceSpan(
                            quoted_text=span.quoted_text,
                            source_message_id=chunk.message_id,
                            quoted_text_start=span_start + chunk.chunk_start,
                            quoted_text_end=(span_end + chunk.chunk_start) if span_end is not None else None,
                        ))

                supporting_evidence.extend(
                    build_supporting_evidence(state.messages, commitment.quoted_text, chunk.message_id)
                )

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
                    quoted_text_start=adjusted_start,
                    quoted_text_end=adjusted_end,
                    confidence=commitment.confidence,
                    reasoning=commitment.reasoning,
                    claim_id=claim_id,
                    supporting_evidence=_dedupe_evidence(supporting_evidence),
                    source_message_id=chunk.message_id,
                    model_tier="balanced",
                    model_used=llm_call.model,
                ))

        def _merge_commitments(left: ExtractedCommitment, right: ExtractedCommitment) -> ExtractedCommitment:
            primary = left if left.confidence >= right.confidence else right
            secondary = right if primary is left else left
            combined = _dedupe_evidence(primary.supporting_evidence + secondary.supporting_evidence)
            primary.supporting_evidence = combined
            return primary

        commitments = merge_by_key(
            commitments,
            key_fn=lambda item: normalize_key(item.title) or normalize_key(item.description),
            merge_fn=_merge_commitments,
        )

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
                "llm_calls": state.trace.llm_calls + llm_calls,
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
