"""
Extract Commitments Node

Extracts commitments (promises, obligations, agreements) from content.
"""

import time
import re

import structlog

from src.llm import get_llm_service, CommitmentExtractionOutput
from src.llm.prompts_v2 import get_commitment_extraction_v2_prompt
from src.personalization import get_org_profile
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


_COMMITMENT_VERB_HINTS = (
    "will ",
    "need to",
    "must ",
    "please ",
    "follow up",
    "send ",
    "deliver ",
    "review ",
    "complete ",
    "renew ",
    "share ",
    "prepare ",
)


def _normalize_title_from_claim(content: str) -> str:
    base = re.sub(r"\s+", " ", (content or "").strip())
    base = base.rstrip(".")
    if len(base) <= 96:
        return base or "Follow up"
    return f"{base[:93].rstrip()}..."


def _is_commitment_like_claim(claim) -> bool:
    claim_type = (getattr(claim, "type", "") or "").strip().lower()
    if claim_type in {"promise", "request", "action_item", "deadline"}:
        return True
    text = (getattr(claim, "content", "") or "").lower()
    return any(hint in text for hint in _COMMITMENT_VERB_HINTS)


def _derive_commitments_from_claims(state: IntelligenceState) -> list[ExtractedCommitment]:
    """Heuristic fallback when LLM commitment extraction returns nothing."""
    by_message_id = {m.id: m for m in state.messages}
    derived: list[ExtractedCommitment] = []

    for claim in state.extracted.claims:
        if not _is_commitment_like_claim(claim):
            continue

        source_message = by_message_id.get(getattr(claim, "source_message_id", "") or "")
        is_from_user = bool(getattr(source_message, "is_from_user", False))
        direction = "owed_by_me" if is_from_user else "owed_to_me"

        user_email = state.input.user_email
        user_name = state.input.user_name
        sender_email = getattr(source_message, "sender_email", None)
        sender_name = getattr(source_message, "sender_name", None)

        debtor_email = user_email if direction == "owed_by_me" else sender_email
        debtor_name = user_name if direction == "owed_by_me" else sender_name
        debtor_is_user = direction == "owed_by_me"

        creditor_email = sender_email if direction == "owed_by_me" else user_email
        creditor_name = sender_name if direction == "owed_by_me" else user_name
        creditor_is_user = direction == "owed_to_me"

        content = (getattr(claim, "content", "") or "").strip()
        quoted_text = (getattr(claim, "quoted_text", "") or "").strip() or content
        due_text = content if (getattr(claim, "type", "") or "").lower() == "deadline" else None

        derived.append(
            ExtractedCommitment(
                title=_normalize_title_from_claim(content),
                description=content,
                direction=direction,
                priority="high" if due_text else "medium",
                debtor_name=debtor_name,
                debtor_email=debtor_email,
                debtor_is_user=debtor_is_user,
                creditor_name=creditor_name,
                creditor_email=creditor_email,
                creditor_is_user=creditor_is_user,
                due_date=None,
                due_date_text=due_text,
                due_date_confidence=0.55 if due_text else 0.0,
                due_date_is_explicit=bool(due_text),
                is_conditional=False,
                condition=None,
                quoted_text=quoted_text,
                quoted_text_start=getattr(claim, "quoted_text_start", None),
                quoted_text_end=getattr(claim, "quoted_text_end", None),
                confidence=min(0.85, max(0.45, (getattr(claim, "confidence", 0.5) or 0.5) * 0.82)),
                reasoning="Heuristic fallback derived from commitment-like claim",
                supporting_evidence=[
                    EvidenceSpan(
                        quoted_text=quoted_text,
                        source_message_id=getattr(claim, "source_message_id", None),
                        quoted_text_start=getattr(claim, "quoted_text_start", None),
                        quoted_text_end=getattr(claim, "quoted_text_end", None),
                    )
                ],
                source_message_id=getattr(claim, "source_message_id", None),
                model_tier="heuristic",
                model_used="claim_fallback",
                claim_id=getattr(claim, "id", None),
            )
        )

    return derived


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
    org_profile = await get_org_profile(state.input.organization_id)

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
                org_profile=org_profile.model_dump() if org_profile else None,
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

        if not commitments and state.extracted.claims:
            fallback_commitments = _derive_commitments_from_claims(state)
            if fallback_commitments:
                commitments = merge_by_key(
                    fallback_commitments,
                    key_fn=lambda item: normalize_key(item.title) or normalize_key(item.description),
                    merge_fn=_merge_commitments,
                )
                logger.info(
                    "Commitment fallback generated commitments from claims",
                    analysis_id=state.analysis_id,
                    fallback_count=len(commitments),
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
