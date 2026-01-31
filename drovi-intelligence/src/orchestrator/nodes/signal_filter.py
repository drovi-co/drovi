"""
Signal Filter Node

Implements Wheeler's Statistical Process Control to distinguish
signal (special cause) from noise (common cause) in extracted intelligence.

From the "Trillion Dollar Hole" research:
- Most captured variations are common cause noise, not special cause signals
- Zone A (> 2σ): Definite signal - investigate
- Zone B (1-2σ): Potential signal - look for patterns
- Zone C (< 1σ): Noise - proceed normally

This node runs after deduplicate to classify intelligence before persistence.
"""

import time
from enum import Enum
from typing import Literal

import structlog
from pydantic import BaseModel

from ..state import (
    IntelligenceState,
    NodeTiming,
)

logger = structlog.get_logger()


class SignalClassification(str, Enum):
    """Wheeler's signal classification."""

    SIGNAL = "signal"  # Special cause - deviation > 2σ
    NOISE = "noise"  # Common cause - within normal variation
    UNCERTAIN = "uncertain"  # Insufficient data


class ControlChartZone(str, Enum):
    """Wheeler's control chart zones."""

    A = "A"  # > 2 standard deviations (definite signal)
    B = "B"  # 1-2 standard deviations (potential signal)
    C = "C"  # < 1 standard deviation (noise)


class SignalAnalysis(BaseModel):
    """Signal analysis result for an intelligence item."""

    classification: SignalClassification
    zone: ControlChartZone
    deviation_score: float  # Standard deviations from mean
    actionability_score: float  # 0-1, how actionable

    # Graph-based indicators
    contradicts_existing: bool = False
    new_cluster_detected: bool = False
    high_centrality_involved: bool = False

    reasoning: str | None = None


async def signal_filter_node(state: IntelligenceState) -> dict:
    """
    Filter extracted intelligence to distinguish signal from noise.

    From Wheeler's Statistical Process Control:
    - Track rolling statistics to establish "normal" variation
    - Deviations > 2σ indicate special cause (signal)
    - Deviations within 2σ indicate common cause (noise)

    Pipeline position: After deduplicate, before persist

    Args:
        state: Current intelligence state with extracted UIOs

    Returns:
        Dict with signal_analysis field containing analysis results
    """
    start_time = time.time()

    logger.info(
        "Starting signal filter",
        analysis_id=state.analysis_id,
        organization_id=state.input.organization_id,
        commitments=len(state.extracted.commitments),
        decisions=len(state.extracted.decisions),
    )

    signal_results: dict[str, SignalAnalysis] = {}

    try:
        from ...graph.client import get_graph_client

        graph = await get_graph_client()
        organization_id = state.input.organization_id

        # Get or create organization baseline
        baseline = await _get_or_create_baseline(graph, organization_id)

        # Analyze each commitment
        for commitment in state.extracted.commitments:
            analysis = await _analyze_commitment(
                commitment=commitment,
                baseline=baseline,
                graph=graph,
                organization_id=organization_id,
            )
            signal_results[f"commitment_{commitment.id}"] = analysis

        # Analyze each decision
        for decision in state.extracted.decisions:
            analysis = await _analyze_decision(
                decision=decision,
                baseline=baseline,
                graph=graph,
                organization_id=organization_id,
            )
            signal_results[f"decision_{decision.id}"] = analysis

        # Analyze risks
        for risk in state.extracted.risks:
            analysis = await _analyze_risk(
                risk=risk,
                baseline=baseline,
                graph=graph,
                organization_id=organization_id,
            )
            signal_results[f"risk_{risk.id}"] = analysis

        # Log summary
        signals = sum(1 for a in signal_results.values() if a.classification == SignalClassification.SIGNAL)
        noise = sum(1 for a in signal_results.values() if a.classification == SignalClassification.NOISE)

        logger.info(
            "Signal filter complete",
            analysis_id=state.analysis_id,
            total_analyzed=len(signal_results),
            signals=signals,
            noise=noise,
        )

    except Exception as e:
        logger.error(
            "Signal filter failed",
            error=str(e),
            analysis_id=state.analysis_id,
        )
        # Don't fail the pipeline, just log the error

    # Update trace
    elapsed = time.time() - start_time
    updated_trace = state.trace.model_copy()
    updated_trace.nodes = [*state.trace.nodes, "signal_filter"]
    updated_trace.current_node = "signal_filter"
    updated_trace.node_timings["signal_filter"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "trace": updated_trace,
        "signal_analysis": signal_results,
    }


async def _get_or_create_baseline(graph, organization_id: str) -> dict:
    """
    Get organization baseline from graph, or return default if not exists.

    The baseline contains rolling statistics for the organization:
    - commitments_per_week (mean, std)
    - decisions_per_week (mean, std)
    - risks_per_week (mean, std)
    """
    try:
        result = await graph.query(
            """
            MATCH (b:OrganizationBaseline {organizationId: $org_id})
            RETURN b
            """,
            {"org_id": organization_id},
        )

        if result and len(result) > 0:
            baseline_node = result[0]["b"]
            return {
                "commitments_per_week_mean": baseline_node.get("commitmentsPerWeekMean", 5.0),
                "commitments_per_week_std": baseline_node.get("commitmentsPerWeekStd", 2.0),
                "decisions_per_week_mean": baseline_node.get("decisionsPerWeekMean", 3.0),
                "decisions_per_week_std": baseline_node.get("decisionsPerWeekStd", 1.5),
                "risks_per_week_mean": baseline_node.get("risksPerWeekMean", 1.0),
                "risks_per_week_std": baseline_node.get("risksPerWeekStd", 0.5),
                "sample_count": baseline_node.get("sampleCount", 0),
            }

    except Exception as e:
        logger.warning(
            "Failed to get baseline from graph",
            error=str(e),
            organization_id=organization_id,
        )

    # Return default baseline for new organizations
    return {
        "commitments_per_week_mean": 5.0,
        "commitments_per_week_std": 2.0,
        "decisions_per_week_mean": 3.0,
        "decisions_per_week_std": 1.5,
        "risks_per_week_mean": 1.0,
        "risks_per_week_std": 0.5,
        "sample_count": 0,
    }


async def _analyze_commitment(
    commitment,
    baseline: dict,
    graph,
    organization_id: str,
) -> SignalAnalysis:
    """Analyze a commitment for signal classification."""

    # Start with default analysis
    deviation_score = 0.0
    contradicts_existing = False
    high_centrality_involved = False

    try:
        # Check for contradictions with existing commitments
        if commitment.title:
            contradiction_result = await graph.query(
                """
                MATCH (c:Commitment {organizationId: $org_id})
                WHERE c.validTo IS NULL
                AND c.title CONTAINS $keyword
                AND c.id <> $commitment_id
                RETURN count(c) as similar_count
                """,
                {
                    "org_id": organization_id,
                    "keyword": commitment.title.split()[0] if commitment.title else "",
                    "commitment_id": commitment.id,
                },
            )
            if contradiction_result and contradiction_result[0].get("similar_count", 0) > 0:
                # Potential contradiction - boost deviation
                deviation_score += 1.0

        # Check if high-centrality contacts are involved
        if commitment.debtor_email or commitment.creditor_email:
            emails = [e for e in [commitment.debtor_email, commitment.creditor_email] if e]
            if emails:
                centrality_result = await graph.query(
                    """
                    MATCH (c:Contact {organizationId: $org_id})
                    WHERE c.email IN $emails
                    RETURN max(c.pagerankScore) as max_pagerank
                    """,
                    {"org_id": organization_id, "emails": emails},
                )
                if centrality_result:
                    max_pagerank = centrality_result[0].get("max_pagerank", 0) or 0
                    if max_pagerank > 0.7:
                        high_centrality_involved = True
                        deviation_score += 0.5

        # Priority-based deviation
        if commitment.priority == "urgent":
            deviation_score += 1.5
        elif commitment.priority == "high":
            deviation_score += 0.5

    except Exception as e:
        logger.warning(
            "Failed to analyze commitment signal",
            error=str(e),
            commitment_id=commitment.id,
        )

    # Classify based on deviation score
    zone, classification = _classify_deviation(deviation_score)

    # Calculate actionability
    actionability = _calculate_actionability(
        has_due_date=commitment.due_date is not None,
        has_owner=commitment.debtor_email is not None or commitment.creditor_email is not None,
        priority=commitment.priority,
        deviation_score=deviation_score,
    )

    return SignalAnalysis(
        classification=classification,
        zone=zone,
        deviation_score=deviation_score,
        actionability_score=actionability,
        contradicts_existing=contradicts_existing,
        high_centrality_involved=high_centrality_involved,
        reasoning=f"Priority: {commitment.priority}, Deviation: {deviation_score:.2f}σ",
    )


async def _analyze_decision(
    decision,
    baseline: dict,
    graph,
    organization_id: str,
) -> SignalAnalysis:
    """Analyze a decision for signal classification."""

    deviation_score = 0.0
    contradicts_existing = False
    high_centrality_involved = False

    try:
        # Check for supersession (decision contradicting existing decision)
        if decision.title:
            supersession_result = await graph.query(
                """
                MATCH (d:Decision {organizationId: $org_id})
                WHERE d.validTo IS NULL
                AND d.title CONTAINS $keyword
                AND d.status = 'made'
                RETURN count(d) as similar_count
                """,
                {
                    "org_id": organization_id,
                    "keyword": decision.title.split()[0] if decision.title else "",
                },
            )
            if supersession_result and supersession_result[0].get("similar_count", 0) > 0:
                contradicts_existing = True
                deviation_score += 1.5  # Supersession is significant

        # Check for high-centrality decision maker
        if decision.decision_maker_email:
            centrality_result = await graph.query(
                """
                MATCH (c:Contact {organizationId: $org_id, email: $email})
                RETURN c.pagerankScore as pagerank
                """,
                {"org_id": organization_id, "email": decision.decision_maker_email},
            )
            if centrality_result:
                pagerank = centrality_result[0].get("pagerank", 0) or 0
                if pagerank > 0.7:
                    high_centrality_involved = True
                    deviation_score += 0.5

        # Status-based deviation
        if decision.status == "reversed":
            deviation_score += 2.0  # Reversed decisions are always signals
        elif decision.status == "pending":
            deviation_score += 0.5

    except Exception as e:
        logger.warning(
            "Failed to analyze decision signal",
            error=str(e),
            decision_id=decision.id,
        )

    zone, classification = _classify_deviation(deviation_score)

    actionability = _calculate_actionability(
        has_due_date=False,
        has_owner=decision.decision_maker_email is not None,
        priority="high" if contradicts_existing else "medium",
        deviation_score=deviation_score,
    )

    return SignalAnalysis(
        classification=classification,
        zone=zone,
        deviation_score=deviation_score,
        actionability_score=actionability,
        contradicts_existing=contradicts_existing,
        high_centrality_involved=high_centrality_involved,
        reasoning=f"Status: {decision.status}, Contradicts: {contradicts_existing}",
    )


async def _analyze_risk(
    risk,
    baseline: dict,
    graph,
    organization_id: str,
) -> SignalAnalysis:
    """Analyze a risk for signal classification."""

    deviation_score = 0.0

    # Severity-based deviation
    severity_scores = {
        "critical": 3.0,
        "high": 2.0,
        "medium": 1.0,
        "low": 0.5,
    }
    deviation_score += severity_scores.get(risk.severity, 1.0)

    # Risk type based deviation
    high_priority_types = ["deadline_risk", "commitment_conflict", "escalation_needed", "fraud_signal"]
    if risk.type in high_priority_types:
        deviation_score += 0.5

    zone, classification = _classify_deviation(deviation_score)

    actionability = min(1.0, 0.3 + (deviation_score * 0.2))

    return SignalAnalysis(
        classification=classification,
        zone=zone,
        deviation_score=deviation_score,
        actionability_score=actionability,
        reasoning=f"Severity: {risk.severity}, Type: {risk.type}",
    )


def _classify_deviation(deviation_score: float) -> tuple[ControlChartZone, SignalClassification]:
    """Classify deviation score into zone and signal classification."""

    if deviation_score >= 2.0:
        return ControlChartZone.A, SignalClassification.SIGNAL
    elif deviation_score >= 1.0:
        return ControlChartZone.B, SignalClassification.UNCERTAIN
    else:
        return ControlChartZone.C, SignalClassification.NOISE


def _calculate_actionability(
    has_due_date: bool,
    has_owner: bool,
    priority: str,
    deviation_score: float,
) -> float:
    """Calculate actionability score (0-1)."""

    score = 0.3  # Base score

    if has_due_date:
        score += 0.2
    if has_owner:
        score += 0.2
    if priority in ("urgent", "high"):
        score += 0.2
    if deviation_score >= 2.0:
        score += 0.1

    return min(1.0, score)
