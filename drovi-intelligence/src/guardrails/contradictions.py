"""Pre-send contradiction checks against existing memory."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

import structlog
from pydantic import BaseModel, Field

from src.config import get_settings
from src.llm import get_llm_service
from src.memory.service import get_memory_service
from .schemas import ContradictionFinding, EvidenceSnippet, SeverityLevel

logger = structlog.get_logger()

_NEGATION_TERMS = ("not", "never", "no longer", "cancel", "reversed", "stop", "avoid")


class ContradictionAssessment(BaseModel):
    is_contradiction: bool = Field(description="Whether draft contradicts memory item")
    contradiction_type: str = Field(default="direct")
    severity: SeverityLevel = Field(default="medium")
    reasoning: str | None = None
    draft_snippet: str | None = None


def _build_query(text: str) -> str:
    tokens = re.findall(r"[A-Za-z0-9]{3,}", text)
    return " ".join(tokens[:12]) if tokens else text[:80]


def _candidate_text(candidate: dict) -> str:
    parts = [
        candidate.get("title"),
        candidate.get("statement"),
        candidate.get("description"),
        candidate.get("summary"),
    ]
    return " ".join([part for part in parts if part])


def _heuristic_contradiction(draft: str, existing: str) -> ContradictionAssessment:
    draft_lower = draft.lower()
    existing_lower = existing.lower()
    similarity = SequenceMatcher(None, draft_lower, existing_lower).ratio()
    if similarity < 0.6:
        return ContradictionAssessment(is_contradiction=False)
    if any(term in draft_lower for term in _NEGATION_TERMS):
        return ContradictionAssessment(
            is_contradiction=True,
            contradiction_type="negation",
            severity="medium",
            reasoning="Draft includes negation terms against similar prior statement.",
            draft_snippet=draft[:200],
        )
    return ContradictionAssessment(is_contradiction=False)


def _build_prompt(draft: str, candidate: dict) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are a strict contradiction detector. "
                "Determine if the draft message contradicts the existing memory item. "
                "Only mark contradiction when there is a clear conflict."
            ),
        },
        {
            "role": "user",
            "content": (
                f"DRAFT MESSAGE:\n{draft}\n\n"
                f"EXISTING MEMORY ({candidate.get('type')}):\n"
                f"Title: {candidate.get('title')}\n"
                f"Details: {_candidate_text(candidate)}\n\n"
                "Return JSON with fields: is_contradiction, contradiction_type, severity, reasoning, draft_snippet."
            ),
        },
    ]


async def _assess_with_llm(draft: str, candidate: dict) -> ContradictionAssessment:
    llm = get_llm_service()
    messages = _build_prompt(draft, candidate)
    output, _ = await llm.complete_structured(
        messages=messages,
        output_schema=ContradictionAssessment,
        model_tier="balanced",
        node_name="guardrails_contradiction",
    )
    return output


async def check_contradictions(
    organization_id: str,
    draft_content: str,
    max_candidates: int | None = None,
) -> list[ContradictionFinding]:
    settings = get_settings()
    max_candidates = max_candidates or settings.guardrails_max_candidates
    memory = await get_memory_service(organization_id)

    query = _build_query(draft_content)
    candidates_raw = await memory.search_uios_as_of(
        query=query,
        uio_types=["decision", "commitment", "claim"],
        limit=max_candidates * 2,
    )

    candidates: list[dict] = []
    for row in candidates_raw:
        candidate = row.get("u") if isinstance(row, dict) and "u" in row else row
        if not isinstance(candidate, dict):
            continue
        if not candidate.get("id"):
            continue
        candidates.append(candidate)
        if len(candidates) >= max_candidates:
            break

    if not candidates:
        return []

    contradictions: list[ContradictionFinding] = []
    evidence_map = await memory.get_uio_evidence([c["id"] for c in candidates], limit_per_uio=3)

    for candidate in candidates:
        candidate_text = _candidate_text(candidate)
        if not candidate_text:
            continue

        assessment: ContradictionAssessment
        if settings.guardrails_use_llm:
            try:
                assessment = await _assess_with_llm(draft_content, candidate)
            except Exception as exc:
                logger.warning("LLM contradiction check failed", error=str(exc))
                assessment = _heuristic_contradiction(draft_content, candidate_text)
        else:
            assessment = _heuristic_contradiction(draft_content, candidate_text)

        if not assessment.is_contradiction:
            continue

        evidence_rows = evidence_map.get(candidate["id"], [])
        evidence = [
            EvidenceSnippet(
                evidence_id=row.get("evidence_id"),
                message_id=row.get("message_id"),
                source_type=row.get("source_type"),
                source_timestamp=row.get("source_timestamp"),
                quoted_text=row.get("quoted_text"),
            )
            for row in evidence_rows
        ]

        contradictions.append(
            ContradictionFinding(
                uio_id=candidate["id"],
                uio_type=candidate.get("type", "uio"),
                title=candidate.get("title"),
                contradiction_type=assessment.contradiction_type,
                severity=assessment.severity,
                reasoning=assessment.reasoning,
                draft_snippet=assessment.draft_snippet,
                evidence=evidence,
            )
        )

    return contradictions
