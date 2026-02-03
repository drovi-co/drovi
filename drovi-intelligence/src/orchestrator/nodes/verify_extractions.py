"""
Verification Node

Validates extracted commitments, decisions, tasks, risks, and claims against source text.
"""

import time
from typing import Any

import structlog
from pydantic import BaseModel, Field

from src.llm import get_llm_service
from src.orchestrator.state import IntelligenceState, NodeTiming, LLMCall

logger = structlog.get_logger()


class VerificationItem(BaseModel):
    index: int
    is_valid: bool = True
    corrected_confidence: float | None = None
    reason: str | None = None


class VerificationResult(BaseModel):
    commitments: list[VerificationItem] = Field(default_factory=list)
    decisions: list[VerificationItem] = Field(default_factory=list)
    tasks: list[VerificationItem] = Field(default_factory=list)
    risks: list[VerificationItem] = Field(default_factory=list)
    claims: list[VerificationItem] = Field(default_factory=list)


VERIFY_SYSTEM_PROMPT = """You are a strict verifier for business intelligence extraction.
Check each item against the SOURCE TEXT only. Mark invalid if not explicitly supported.
Return JSON only.
"""


async def verify_extractions_node(state: IntelligenceState) -> dict[str, Any]:
    """
    Verify commitments, decisions, tasks, risks, and claims against source text and adjust confidence.
    """
    start_time = time.time()
    state.trace.current_node = "verify_extractions"
    state.trace.nodes.append("verify_extractions")

    if not state.messages:
        return {}

    content = "\n\n".join([m.content for m in state.messages]).strip()
    if not content:
        return {}

    commitments = state.extracted.commitments or []
    decisions = state.extracted.decisions or []
    tasks = state.extracted.tasks or []
    risks = state.extracted.risks or []
    claims = state.extracted.claims or []

    if not commitments and not decisions and not tasks and not risks and not claims:
        return {}

    items_block = []
    if commitments:
        items_block.append("Commitments:")
        for idx, c in enumerate(commitments):
            items_block.append(
                f"{idx}. title={c.title} quoted={getattr(c, 'quoted_text', None)}"
            )
    if decisions:
        items_block.append("Decisions:")
        for idx, d in enumerate(decisions):
            items_block.append(
                f"{idx}. title={d.title} quoted={getattr(d, 'quoted_text', None)}"
            )
    if tasks:
        items_block.append("Tasks:")
        for idx, t in enumerate(tasks):
            items_block.append(
                f"{idx}. title={t.title} quoted={getattr(t, 'quoted_text', None)}"
            )
    if risks:
        items_block.append("Risks:")
        for idx, r in enumerate(risks):
            items_block.append(
                f"{idx}. title={r.title} quoted={getattr(r, 'quoted_text', None)}"
            )
    if claims:
        items_block.append("Claims:")
        for idx, c in enumerate(claims):
            items_block.append(
                f"{idx}. content={c.content} quoted={getattr(c, 'quoted_text', None)}"
            )

    prompt = [
        {"role": "system", "content": VERIFY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"""SOURCE TEXT:
{content}

EXTRACTED ITEMS:
{chr(10).join(items_block)}

Return JSON with:
- commitments: list of {{index, is_valid, corrected_confidence, reason}}
- decisions: list of {{index, is_valid, corrected_confidence, reason}}
- tasks: list of {{index, is_valid, corrected_confidence, reason}}
- risks: list of {{index, is_valid, corrected_confidence, reason}}
- claims: list of {{index, is_valid, corrected_confidence, reason}}

If an item is valid, keep is_valid=true and you may omit corrected_confidence.
If invalid, set is_valid=false and set corrected_confidence to <= 0.2.
""",
        },
    ]

    llm = get_llm_service()
    try:
        result, llm_call = await llm.complete_structured(
            messages=prompt,
            output_schema=VerificationResult,
            model_tier="fast",
            temperature=0.0,
            node_name="verify_extractions",
        )
    except Exception as exc:
        logger.warning("Verification failed, skipping", error=str(exc))
        return {}

    invalid_commitments: set[int] = set()
    invalid_decisions: set[int] = set()
    invalid_tasks: set[int] = set()
    invalid_risks: set[int] = set()
    invalid_claims: set[int] = set()

    for item in result.commitments:
        if 0 <= item.index < len(commitments):
            commitment = commitments[item.index]
            if not item.is_valid:
                commitment.confidence = min(commitment.confidence, item.corrected_confidence or 0.2)
                if item.reason:
                    commitment.reasoning = f"[invalid] {item.reason}"
                invalid_commitments.add(item.index)
            elif item.corrected_confidence is not None:
                commitment.confidence = max(0.0, min(item.corrected_confidence, 1.0))

    for item in result.decisions:
        if 0 <= item.index < len(decisions):
            decision = decisions[item.index]
            if not item.is_valid:
                decision.confidence = min(decision.confidence, item.corrected_confidence or 0.2)
                if item.reason:
                    decision.reasoning = f"[invalid] {item.reason}"
                invalid_decisions.add(item.index)
            elif item.corrected_confidence is not None:
                decision.confidence = max(0.0, min(item.corrected_confidence, 1.0))

    for item in result.tasks:
        if 0 <= item.index < len(tasks):
            task = tasks[item.index]
            if not item.is_valid:
                task.confidence = min(task.confidence, item.corrected_confidence or 0.2)
                if item.reason:
                    task.reasoning = f"[invalid] {item.reason}"
                invalid_tasks.add(item.index)
            elif item.corrected_confidence is not None:
                task.confidence = max(0.0, min(item.corrected_confidence, 1.0))

    for item in result.risks:
        if 0 <= item.index < len(risks):
            risk = risks[item.index]
            if not item.is_valid:
                risk.confidence = min(risk.confidence, item.corrected_confidence or 0.2)
                if item.reason:
                    risk.reasoning = f"[invalid] {item.reason}"
                invalid_risks.add(item.index)
            elif item.corrected_confidence is not None:
                risk.confidence = max(0.0, min(item.corrected_confidence, 1.0))

    for item in result.claims:
        if 0 <= item.index < len(claims):
            claim = claims[item.index]
            if not item.is_valid:
                claim.confidence = min(claim.confidence, item.corrected_confidence or 0.2)
                if item.reason:
                    claim.content = f"{claim.content} [invalid: {item.reason}]"
                invalid_claims.add(item.index)
            elif item.corrected_confidence is not None:
                claim.confidence = max(0.0, min(item.corrected_confidence, 1.0))

    if invalid_commitments:
        state.extracted.commitments = [
            c for idx, c in enumerate(commitments) if idx not in invalid_commitments
        ]
    if invalid_decisions:
        state.extracted.decisions = [
            d for idx, d in enumerate(decisions) if idx not in invalid_decisions
        ]
    if invalid_tasks:
        state.extracted.tasks = [
            t for idx, t in enumerate(tasks) if idx not in invalid_tasks
        ]
    if invalid_risks:
        state.extracted.risks = [
            r for idx, r in enumerate(risks) if idx not in invalid_risks
        ]
    if invalid_claims:
        state.extracted.claims = [
            c for idx, c in enumerate(claims) if idx not in invalid_claims
        ]

    trace_llm_call = LLMCall(
        node="verify_extractions",
        model=llm_call.model,
        prompt_tokens=llm_call.prompt_tokens,
        completion_tokens=llm_call.completion_tokens,
        duration_ms=llm_call.duration_ms,
    )

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "extracted": state.extracted,
        "trace": {
            **state.trace.model_dump(),
            "current_node": "verify_extractions",
            "node_timings": {
                **state.trace.node_timings,
                "verify_extractions": node_timing,
            },
            "llm_calls": state.trace.llm_calls + [trace_llm_call],
        },
    }
