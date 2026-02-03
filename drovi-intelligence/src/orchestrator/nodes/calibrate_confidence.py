"""
Confidence Calibration Node

Normalizes confidence scores by source type and extraction mix.
"""

import time

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


def _avg_conf(items) -> float:
    if not items:
        return 0.0
    return sum(i.confidence for i in items) / len(items)


async def calibrate_confidence_node(state: IntelligenceState) -> dict:
    """
    Calibrate confidence by source type and update overall confidence.
    """
    start_time = time.time()

    state.trace.current_node = "calibrate_confidence"
    state.trace.nodes.append("calibrate_confidence")

    source_type = (state.input.source_type or "email").lower()
    weight = SOURCE_WEIGHTS.get(source_type, 0.95)

    by_type = {
        "claims": _avg_conf(state.extracted.claims),
        "commitments": _avg_conf(state.extracted.commitments),
        "decisions": _avg_conf(state.extracted.decisions),
        "tasks": _avg_conf(state.extracted.tasks),
        "risks": _avg_conf(state.extracted.risks),
    }

    # Apply source weighting and clamp
    for key, value in by_type.items():
        by_type[key] = max(0.0, min(value * weight, 1.0))

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
