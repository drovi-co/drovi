"""
Infer Lifecycle Stage Node

Analyzes engagement patterns to infer the contact's lifecycle stage
(lead, prospect, customer, churned) and churn risk.
"""

import time
from datetime import datetime, timedelta
from typing import Any

import structlog

from ..state import (
    ContactIntelligenceState,
    LifecycleDetection,
    LifecycleStage,
    NodeTiming,
)

logger = structlog.get_logger()


async def infer_lifecycle_stage_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Infer the contact's lifecycle stage.

    Analyzes:
    - Engagement trajectory (increasing, stable, declining)
    - Time since first contact
    - Commitment patterns (fulfilled vs overdue)
    - Communication frequency trends

    Returns:
        State update with lifecycle_detection populated
    """
    start_time = time.time()

    logger.info(
        "Inferring lifecycle stage",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "infer_lifecycle_stage"
    state.trace.nodes.append("infer_lifecycle_stage")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    try:
        detection = LifecycleDetection()
        indicators: list[str] = []
        churn_factors: list[str] = []
        expansion_signals: list[str] = []

        # =================================================================
        # ENGAGEMENT ANALYSIS
        # =================================================================

        metrics = state.relationship_metrics
        loaded = state.loaded_data

        days_since_first = metrics.days_since_first_interaction or 0
        days_since_last = metrics.days_since_last_interaction or 0
        interaction_count = metrics.interaction_count

        # =================================================================
        # STAGE INFERENCE
        # =================================================================

        # New relationship (< 30 days, few interactions)
        if days_since_first < 30 and interaction_count < 5:
            detection.stage = LifecycleStage.LEAD
            detection.confidence = 0.7
            indicators.append("New relationship with limited interactions")

        # Developing relationship (30-90 days, moderate activity)
        elif days_since_first < 90 and interaction_count < 20:
            if metrics.engagement_score > 0.5:
                detection.stage = LifecycleStage.PROSPECT
                detection.confidence = 0.65
                indicators.append("Growing relationship with good engagement")
            else:
                detection.stage = LifecycleStage.LEAD
                detection.confidence = 0.6
                indicators.append("Early stage with moderate engagement")

        # Established relationship (90+ days, good activity)
        elif days_since_first >= 90:
            if interaction_count >= 20 and metrics.engagement_score > 0.4:
                detection.stage = LifecycleStage.CUSTOMER
                detection.confidence = 0.7
                indicators.append("Long-term relationship with consistent engagement")

                # Check for expansion signals
                if metrics.interactions_per_month > 5:
                    expansion_signals.append("High monthly interaction rate")
                    detection.expansion_potential = 0.3

                if len(loaded.commitments) > 5:
                    expansion_signals.append("Many active commitments")
                    detection.expansion_potential += 0.2

            elif days_since_last > 60:
                # Long time since last contact
                detection.stage = LifecycleStage.CHURNED
                detection.confidence = 0.6
                indicators.append("No recent contact despite history")

            else:
                detection.stage = LifecycleStage.CUSTOMER
                detection.confidence = 0.5
                indicators.append("Moderate ongoing relationship")

        # =================================================================
        # CHURN RISK ANALYSIS
        # =================================================================

        churn_score = 0.0

        # Factor 1: Days since last interaction
        if days_since_last > 30:
            risk_contribution = min((days_since_last - 30) / 60, 0.3)
            churn_score += risk_contribution
            churn_factors.append(f"No contact in {days_since_last} days")

        # Factor 2: Declining engagement
        if metrics.sentiment_direction == "declining":
            churn_score += 0.2
            churn_factors.append("Sentiment is declining")

        # Factor 3: Declining frequency
        # Compare recent vs historical interaction rate
        interactions = loaded.interactions
        if len(interactions) >= 10:
            recent = len([i for i in interactions[:5]])  # Last 5
            older = len([i for i in interactions[5:10]])  # Previous 5

            # Get time spans
            if interactions and len(interactions) >= 10:
                recent_span = (
                    interactions[0].timestamp - interactions[4].timestamp
                ).days or 1
                older_span = (
                    interactions[5].timestamp - interactions[9].timestamp
                ).days or 1

                recent_rate = recent / recent_span
                older_rate = older / older_span

                if recent_rate < older_rate * 0.5:
                    churn_score += 0.2
                    churn_factors.append("Interaction frequency declining")

        # Factor 4: Overdue commitments
        commitments = loaded.commitments
        overdue = [
            c for c in commitments
            if c.status in ["pending", "in_progress"]
            and c.due_date
            and c.due_date < datetime.utcnow()
        ]
        if len(overdue) > 2:
            churn_score += 0.15
            churn_factors.append(f"{len(overdue)} overdue commitments")

        # Factor 5: Low response rate
        if metrics.response_rate < 0.3:
            churn_score += 0.1
            churn_factors.append("Low response rate")

        detection.churn_risk_score = min(churn_score, 1.0)
        detection.churn_risk_factors = churn_factors

        # =================================================================
        # EXPANSION ANALYSIS
        # =================================================================

        expansion_score = 0.0

        # Factor 1: High engagement
        if metrics.engagement_score > 0.7:
            expansion_score += 0.2
            expansion_signals.append("High engagement score")

        # Factor 2: Positive sentiment trend
        if metrics.sentiment_direction == "improving":
            expansion_score += 0.15
            expansion_signals.append("Improving sentiment")

        # Factor 3: Decision maker with active decisions
        role = state.role_detection
        if role.role_type.value == "decision_maker":
            decisions = loaded.decisions
            recent_decisions = [
                d for d in decisions
                if d.decided_at
                and d.decided_at > datetime.utcnow() - timedelta(days=30)
            ]
            if recent_decisions:
                expansion_score += 0.2
                expansion_signals.append("Recent decision-making activity")

        # Factor 4: Growing interaction frequency
        if len(interactions) >= 10:
            recent_span = (
                interactions[0].timestamp - interactions[4].timestamp
            ).days or 1
            older_span = (
                interactions[5].timestamp - interactions[9].timestamp
            ).days or 1

            recent_rate = 5 / recent_span
            older_rate = 5 / older_span

            if recent_rate > older_rate * 1.5:
                expansion_score += 0.15
                expansion_signals.append("Increasing interaction frequency")

        detection.expansion_potential = min(expansion_score, 1.0)
        detection.expansion_signals = expansion_signals

        # =================================================================
        # FINALIZE
        # =================================================================

        detection.stage_indicators = indicators

        # Override stage if churned signals are strong
        if detection.churn_risk_score > 0.6 and detection.stage == LifecycleStage.CUSTOMER:
            if days_since_last > 45:
                detection.stage = LifecycleStage.CHURNED
                detection.confidence = 0.6

        logger.info(
            "Lifecycle stage inferred",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            stage=detection.stage.value,
            churn_risk=round(detection.churn_risk_score, 2),
            expansion_potential=round(detection.expansion_potential, 2),
        )

        return _complete_node(state, detection, start_time)

    except Exception as e:
        logger.error(
            "Failed to infer lifecycle stage",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        return _error_node(state, start_time, str(e))


def _skip_node(state: ContactIntelligenceState, start_time: float) -> dict[str, Any]:
    """Return skip state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "trace": {
            **state.trace.model_dump(),
            "current_node": "infer_lifecycle_stage",
            "node_timings": {
                **state.trace.node_timings,
                "infer_lifecycle_stage": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    detection: LifecycleDetection,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "lifecycle_detection": detection.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "infer_lifecycle_stage",
            "node_timings": {
                **state.trace.node_timings,
                "infer_lifecycle_stage": node_timing,
            },
        },
    }


def _error_node(
    state: ContactIntelligenceState,
    start_time: float,
    error: str,
) -> dict[str, Any]:
    """Return error state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "lifecycle_detection": LifecycleDetection().model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "infer_lifecycle_stage",
            "node_timings": {
                **state.trace.node_timings,
                "infer_lifecycle_stage": node_timing,
            },
            "errors": state.trace.errors + [f"infer_lifecycle_stage: {error}"],
        },
    }
