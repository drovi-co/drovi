"""
Extract Decisions Node

Extracts decisions (choices made, pending, or reversed) from content.
"""

import time

import structlog

from src.llm import get_llm_service, DecisionExtractionOutput
from src.llm.prompts_v2 import get_decision_extraction_v2_prompt
from src.personalization import get_org_profile
from ..state import (
    IntelligenceState,
    ExtractedDecision,
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

    chunks = build_extraction_chunks(state.messages, max_chunk_chars=4000, overlap=200)
    if not chunks:
        return {}

    # Get LLM service
    llm = get_llm_service()
    org_profile = await get_org_profile(state.input.organization_id)

    try:
        decisions: list[ExtractedDecision] = []
        llm_calls: list[LLMCall] = []

        def is_decision_candidate(decision_obj: ExtractedDecision) -> bool:
            text = (decision_obj.statement or decision_obj.title or "").strip().lower()
            if not text:
                return False
            if text.startswith(("task:", "todo:", "action:", "action item:", "follow up:")):
                return False
            decision_markers = (
                "decision:",
                "decided",
                "approved",
                "approve",
                "agreed",
                "greenlight",
                "selected",
                "chosen",
                "we decided",
                "we agreed",
                "approved to",
            )
            if any(marker in text for marker in decision_markers):
                return True
            # Default: treat "will/should/need to" as commitments/tasks unless explicit decision marker
            if " will " in text or text.startswith("we will") or " need to " in text or " should " in text:
                return False
            return False

        for chunk in chunks:
            messages = get_decision_extraction_v2_prompt(
                content=chunk.content,
                source_type=state.input.source_type,
                user_email=state.input.user_email,
                user_name=state.input.user_name,
                memory_context=state.memory_context,
                org_profile=org_profile.model_dump() if org_profile else None,
            )

            output, llm_call = await llm.complete_structured(
                messages=messages,
                output_schema=DecisionExtractionOutput,
                model_tier="balanced",
                node_name="extract_decisions",
            )

            llm_calls.append(LLMCall(
                node="extract_decisions",
                model=llm_call.model,
                prompt_tokens=llm_call.prompt_tokens,
                completion_tokens=llm_call.completion_tokens,
                duration_ms=llm_call.duration_ms,
            ))

            for decision in output.decisions:
                claim_id = None
                if decision.claim_index is not None and decision.claim_index < len(state.extracted.claims):
                    claim_id = state.extracted.claims[decision.claim_index].id

                start, end = find_quote_span(chunk.content, decision.quoted_text)
                adjusted_start = (start + chunk.chunk_start) if start is not None else None
                adjusted_end = (end + chunk.chunk_start) if end is not None else None

                supporting_evidence: list[EvidenceSpan] = []
                for span in decision.supporting_quotes:
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
                    build_supporting_evidence(state.messages, decision.quoted_text, chunk.message_id)
                )

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
                    quoted_text_start=adjusted_start,
                    quoted_text_end=adjusted_end,
                    confidence=decision.confidence,
                    reasoning=decision.reasoning,
                    claim_id=claim_id,
                    supporting_evidence=_dedupe_evidence(supporting_evidence),
                    source_message_id=chunk.message_id,
                    model_tier="balanced",
                    model_used=llm_call.model,
                ))

        def _merge_decisions(left: ExtractedDecision, right: ExtractedDecision) -> ExtractedDecision:
            primary = left if left.confidence >= right.confidence else right
            secondary = right if primary is left else left
            combined = _dedupe_evidence(primary.supporting_evidence + secondary.supporting_evidence)
            primary.supporting_evidence = combined
            return primary

        decisions = merge_by_key(
            decisions,
            key_fn=lambda item: normalize_key(item.title) or normalize_key(item.statement),
            merge_fn=_merge_decisions,
        )
        filtered_decisions = [d for d in decisions if is_decision_candidate(d)]

        # Update extracted intelligence
        extracted = ExtractedIntelligence(
            claims=state.extracted.claims,
            commitments=state.extracted.commitments,
            decisions=filtered_decisions,
            topics=state.extracted.topics,
            risks=state.extracted.risks,
        )

        logger.info(
            "Decisions extracted",
            analysis_id=state.analysis_id,
            decision_count=len(filtered_decisions),
            filtered_out=len(decisions) - len(filtered_decisions),
            statuses=[d.status for d in filtered_decisions],
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        # Update confidence
        avg_confidence = (
            sum(d.confidence for d in filtered_decisions) / len(filtered_decisions)
            if filtered_decisions
            else 0.0
        )

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
                "llm_calls": state.trace.llm_calls + llm_calls,
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
