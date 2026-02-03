"""
Confidence Calibration Node

Calibrates confidence scores using evidence strength, model tier, and source reliability.
"""

import time
import math

import structlog

from src.orchestrator.state import IntelligenceState, NodeTiming, Confidence

logger = structlog.get_logger()


SOURCE_WEIGHTS = {
    "email": 1.0,
    "slack": 0.95,
    "whatsapp": 0.95,
    "meeting": 0.9,
    "call": 0.9,
    "recording": 0.9,
    "calendar": 0.9,
    "notion": 0.95,
    "google_docs": 0.95,
}

MODEL_TIER_WEIGHTS = {
    "fast": 0.9,
    "balanced": 1.0,
    "powerful": 1.05,
}


def _avg_conf(items) -> float:
    if not items:
        return 0.0
    return sum(i.confidence for i in items) / len(items)


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-value))


def _logit(probability: float) -> float:
    epsilon = 1e-4
    clamped = min(max(probability, epsilon), 1 - epsilon)
    return math.log(clamped / (1 - clamped))


def _evidence_metrics(item) -> tuple[int, float, float]:
    quotes: list[str] = []
    quoted_text = getattr(item, "quoted_text", None)
    if quoted_text:
        quotes.append(quoted_text)
    supporting = getattr(item, "supporting_evidence", []) or []
    for span in supporting:
        if getattr(span, "quoted_text", None):
            quotes.append(span.quoted_text)

    count = len(quotes)
    avg_len = sum(len(q) for q in quotes) / count if count else 0.0
    length_score = min(avg_len / 200.0, 1.0)
    evidence_score = min(1.0, 0.5 + 0.2 * min(count, 3) + 0.3 * length_score)
    return count, avg_len, evidence_score


def _calibrate_item(item, source_weight: float) -> float:
    base_confidence = max(0.0, min(float(getattr(item, "confidence", 0.0)), 1.0))
    evidence_count, avg_len, evidence_score = _evidence_metrics(item)
    model_tier = getattr(item, "model_tier", None) or "balanced"
    model_weight = MODEL_TIER_WEIGHTS.get(model_tier, 1.0)

    logit = _logit(base_confidence)
    logit += (evidence_score - 0.5) * 1.2
    logit += (model_weight - 1.0) * 1.0
    logit += (source_weight - 1.0) * 1.0
    calibrated = max(0.0, min(_sigmoid(logit), 1.0))

    reasoning = (
        f"base={base_confidence:.2f}; evidence_count={evidence_count}; "
        f"avg_quote_len={avg_len:.0f}; evidence_score={evidence_score:.2f}; "
        f"model_tier={model_tier}; source_weight={source_weight:.2f}; "
        f"calibrated={calibrated:.2f}"
    )
    item.confidence = calibrated
    setattr(item, "confidence_reasoning", reasoning)
    return calibrated


async def calibrate_confidence_node(state: IntelligenceState) -> dict:
    """
    Calibrate confidence by source type and update overall confidence.
    """
    start_time = time.time()

    state.trace.current_node = "calibrate_confidence"
    state.trace.nodes.append("calibrate_confidence")

    source_type = (state.input.source_type or "email").lower()
    weight = SOURCE_WEIGHTS.get(source_type, 0.95)

    for item in state.extracted.claims:
        _calibrate_item(item, weight)
    for item in state.extracted.commitments:
        _calibrate_item(item, weight)
    for item in state.extracted.decisions:
        _calibrate_item(item, weight)
    for item in state.extracted.tasks:
        _calibrate_item(item, weight)
    for item in state.extracted.risks:
        _calibrate_item(item, weight)

    by_type = {
        "claims": _avg_conf(state.extracted.claims),
        "commitments": _avg_conf(state.extracted.commitments),
        "decisions": _avg_conf(state.extracted.decisions),
        "tasks": _avg_conf(state.extracted.tasks),
        "risks": _avg_conf(state.extracted.risks),
    }

    # Compute overall as average of non-zero types
    non_zero = [v for v in by_type.values() if v > 0]
    overall = sum(non_zero) / len(non_zero) if non_zero else 0.0

    needs_review = any(v < 0.4 for v in non_zero) if non_zero else True
    review_reason = None
    if needs_review:
        review_reason = "Low calibrated confidence on one or more extraction types."

    state.confidence = Confidence(
        overall=overall,
        by_type=by_type,
        needs_review=needs_review,
        review_reason=review_reason,
    )

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    logger.info(
        "Confidence calibrated",
        analysis_id=state.analysis_id,
        overall=overall,
        source_type=source_type,
    )

    return {
        "confidence": state.confidence,
        "trace": {
            **state.trace.model_dump(),
            "current_node": "calibrate_confidence",
            "node_timings": {
                **state.trace.node_timings,
                "calibrate_confidence": node_timing,
            },
        },
    }
