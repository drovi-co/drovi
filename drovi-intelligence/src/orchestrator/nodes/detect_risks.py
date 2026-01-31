"""
Detect Risks Node

Detects potential risks and issues in the extracted intelligence.
"""

import time

import structlog

from src.llm import get_llm_service, RiskDetectionOutput
from src.llm.prompts_v2 import get_risk_detection_v2_prompt
from ..state import (
    IntelligenceState,
    DetectedRisk,
    ExtractedIntelligence,
    NodeTiming,
    LLMCall,
)

logger = structlog.get_logger()


async def detect_risks_node(state: IntelligenceState) -> dict:
    """
    Detect risks in extracted intelligence.

    This node:
    1. Analyzes commitments and decisions for risks
    2. Identifies deadline conflicts, ownership issues, etc.
    3. Suggests mitigation actions
    4. Links risks to related items

    Returns:
        State update with detected risks
    """
    start_time = time.time()

    logger.info(
        "Detecting risks",
        analysis_id=state.analysis_id,
        commitment_count=len(state.extracted.commitments),
        decision_count=len(state.extracted.decisions),
    )

    # Update trace
    state.trace.current_node = "detect_risks"
    state.trace.nodes.append("detect_risks")

    # Combine all message content
    content = "\n\n".join([msg.content for msg in state.messages])

    # Prepare context for the prompt
    commitments_dicts = [
        {
            "title": c.title,
            "description": c.description,
            "direction": c.direction,
            "priority": c.priority,
            "due_date_text": c.due_date_text,
            "is_conditional": c.is_conditional,
        }
        for c in state.extracted.commitments
    ]

    decisions_dicts = [
        {
            "title": d.title,
            "statement": d.statement,
            "status": d.status,
            "stakeholders": d.stakeholders,
        }
        for d in state.extracted.decisions
    ]

    # Get LLM service
    llm = get_llm_service()

    # Build prompt using V2 strict prompts
    messages = get_risk_detection_v2_prompt(
        content=content,
        commitments=commitments_dicts,
        decisions=decisions_dicts,
        source_type=state.input.source_type,
    )

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=RiskDetectionOutput,
            model_tier="balanced",
            node_name="detect_risks",
        )

        # Convert to state risk objects
        risks = []
        for risk in output.risks:
            # Build related items references
            related_to = []

            for idx in risk.related_commitment_indices:
                if idx < len(state.extracted.commitments):
                    related_to.append({
                        "type": "commitment",
                        "reference": state.extracted.commitments[idx].id,
                    })

            for idx in risk.related_decision_indices:
                if idx < len(state.extracted.decisions):
                    related_to.append({
                        "type": "decision",
                        "reference": state.extracted.decisions[idx].id,
                    })

            risks.append(DetectedRisk(
                type=risk.type,
                title=risk.title,
                description=risk.description,
                severity=risk.severity,
                related_to=related_to,
                suggested_action=risk.suggested_action,
                quoted_text=risk.quoted_text,
                confidence=risk.confidence,
                reasoning=risk.reasoning,
            ))

        # Update extracted intelligence
        extracted = ExtractedIntelligence(
            claims=state.extracted.claims,
            commitments=state.extracted.commitments,
            decisions=state.extracted.decisions,
            topics=state.extracted.topics,
            risks=risks,
        )

        logger.info(
            "Risks detected",
            analysis_id=state.analysis_id,
            risk_count=len(risks),
            severities=[r.severity for r in risks],
            types=[r.type for r in risks],
        )

        # Record LLM call
        trace_llm_call = LLMCall(
            node="detect_risks",
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
        avg_confidence = sum(r.confidence for r in risks) / len(risks) if risks else 0.0

        # Check if human review is needed based on risk severity
        needs_review = any(r.severity in ["high", "critical"] for r in risks)

        return {
            "extracted": extracted,
            "confidence": {
                **state.confidence.model_dump(),
                "by_type": {
                    **state.confidence.by_type,
                    "risks": avg_confidence,
                },
                "needs_review": needs_review or state.confidence.needs_review,
                "review_reason": "High severity risks detected" if needs_review else state.confidence.review_reason,
            },
            "trace": {
                **state.trace.model_dump(),
                "current_node": "detect_risks",
                "node_timings": {
                    **state.trace.node_timings,
                    "detect_risks": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Risk detection failed",
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
                "current_node": "detect_risks",
                "node_timings": {
                    **state.trace.node_timings,
                    "detect_risks": node_timing,
                },
                "errors": state.trace.errors + [f"detect_risks: {str(e)}"],
            },
        }
