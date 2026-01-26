"""
Calculate Relationship Metrics Node

Computes frequency, recency, sentiment trends, and engagement metrics
from loaded interaction data.
"""

import time
from datetime import datetime, timedelta
from typing import Any, Literal

import structlog

from ..state import (
    ContactIntelligenceState,
    RelationshipMetrics,
    NodeTiming,
)

logger = structlog.get_logger()


async def calculate_relationship_metrics_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Calculate relationship metrics from loaded interaction data.

    Computes:
    - Volume metrics (total, inbound, outbound)
    - Response metrics (avg time, rate)
    - Frequency metrics (per week, per month)
    - Recency metrics (days since last)
    - Sentiment trends
    - Engagement scores

    Returns:
        State update with relationship_metrics populated
    """
    start_time = time.time()

    logger.info(
        "Calculating relationship metrics",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "calculate_relationship_metrics"
    state.trace.nodes.append("calculate_relationship_metrics")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    try:
        interactions = state.loaded_data.interactions
        metrics = RelationshipMetrics()

        if not interactions:
            logger.info(
                "No interactions to analyze",
                analysis_id=state.analysis_id,
            )
            return _complete_node(state, metrics, start_time)

        # =================================================================
        # VOLUME METRICS
        # =================================================================

        metrics.interaction_count = len(interactions)
        metrics.inbound_count = sum(1 for i in interactions if i.direction == "inbound")
        metrics.outbound_count = sum(
            1 for i in interactions if i.direction == "outbound"
        )

        # =================================================================
        # FREQUENCY METRICS
        # =================================================================

        # Get time range
        timestamps = [i.timestamp for i in interactions]
        oldest = min(timestamps)
        newest = max(timestamps)
        days_span = max((newest - oldest).days, 1)
        weeks_span = max(days_span / 7, 1)
        months_span = max(days_span / 30, 1)

        metrics.interactions_per_week = metrics.interaction_count / weeks_span
        metrics.interactions_per_month = metrics.interaction_count / months_span

        # =================================================================
        # RECENCY METRICS
        # =================================================================

        now = datetime.utcnow()
        metrics.days_since_last_interaction = (now - newest).days
        metrics.days_since_first_interaction = (now - oldest).days

        # =================================================================
        # RESPONSE METRICS
        # =================================================================

        # Calculate response times by analyzing conversation flow
        response_times: list[float] = []
        responses_received = 0
        outbound_awaiting_response = 0

        # Group interactions by thread
        thread_interactions: dict[str, list] = {}
        for interaction in interactions:
            thread_id = interaction.thread_id or interaction.id
            if thread_id not in thread_interactions:
                thread_interactions[thread_id] = []
            thread_interactions[thread_id].append(interaction)

        # Analyze each thread for response patterns
        for thread_id, thread_msgs in thread_interactions.items():
            # Sort by timestamp
            sorted_msgs = sorted(thread_msgs, key=lambda x: x.timestamp)

            for i in range(1, len(sorted_msgs)):
                prev_msg = sorted_msgs[i - 1]
                curr_msg = sorted_msgs[i]

                # If outbound followed by inbound = they responded to us
                if prev_msg.direction == "outbound" and curr_msg.direction == "inbound":
                    response_time = (
                        curr_msg.timestamp - prev_msg.timestamp
                    ).total_seconds() / 60  # minutes
                    if response_time > 0 and response_time < 10080:  # < 7 days
                        response_times.append(response_time)
                        responses_received += 1

        # Count outbound messages that might be awaiting response
        # (last message in thread was outbound)
        for thread_id, thread_msgs in thread_interactions.items():
            sorted_msgs = sorted(thread_msgs, key=lambda x: x.timestamp)
            if sorted_msgs and sorted_msgs[-1].direction == "outbound":
                outbound_awaiting_response += 1

        if response_times:
            metrics.avg_response_time_minutes = sum(response_times) / len(response_times)

        # Response rate: what proportion of our outbound messages got responses
        total_outbound = metrics.outbound_count
        if total_outbound > 0:
            metrics.response_rate = min(responses_received / total_outbound, 1.0)

        # =================================================================
        # SENTIMENT TRENDS
        # =================================================================

        # Get sentiment scores where available
        sentiments = [i.sentiment_score for i in interactions if i.sentiment_score is not None]

        if sentiments:
            metrics.avg_sentiment = sum(sentiments) / len(sentiments)

            # Calculate trend over time (divide into periods)
            period_sentiments: list[list[float]] = [[], [], [], []]  # 4 periods
            for i, interaction in enumerate(reversed(interactions)):
                if interaction.sentiment_score is not None:
                    period_idx = min(i // (len(interactions) // 4 + 1), 3)
                    period_sentiments[period_idx].append(interaction.sentiment_score)

            metrics.sentiment_trend = [
                sum(p) / len(p) if p else 0.0 for p in period_sentiments
            ]

            # Determine trend direction
            if len(metrics.sentiment_trend) >= 2:
                first_half = sum(metrics.sentiment_trend[:2]) / 2
                second_half = sum(metrics.sentiment_trend[2:]) / 2
                diff = second_half - first_half

                if diff > 0.1:
                    metrics.sentiment_direction = "improving"
                elif diff < -0.1:
                    metrics.sentiment_direction = "declining"
                else:
                    metrics.sentiment_direction = "stable"

        # =================================================================
        # ENGAGEMENT METRICS
        # =================================================================

        # Thread participation rate
        total_threads = len(thread_interactions)
        threads_with_contact_response = sum(
            1 for thread_msgs in thread_interactions.values()
            if any(m.direction == "inbound" for m in thread_msgs)
        )
        if total_threads > 0:
            metrics.thread_participation_rate = threads_with_contact_response / total_threads

        # Average message length
        word_counts = [i.word_count for i in interactions if i.word_count > 0]
        if word_counts:
            metrics.avg_message_length = sum(word_counts) / len(word_counts)

        # =================================================================
        # COMPUTED SCORES (0-1)
        # =================================================================

        # Frequency score (higher = more frequent)
        # Benchmark: 1+ interactions/week = high frequency
        metrics.frequency_score = min(metrics.interactions_per_week / 2, 1.0)

        # Recency score (higher = more recent)
        # Decay: 0 days = 1.0, 30 days = 0.5, 90+ days = ~0
        days = metrics.days_since_last_interaction or 0
        metrics.recency_score = max(0, 1 - (days / 90))

        # Engagement score
        # Combination of response rate, thread participation, and message quality
        engagement_factors = [
            metrics.response_rate,
            metrics.thread_participation_rate,
            min(metrics.avg_message_length / 100, 1.0) if metrics.avg_message_length else 0.5,
        ]
        metrics.engagement_score = sum(engagement_factors) / len(engagement_factors)

        # Strength score (overall relationship health)
        # Weighted combination of all factors
        metrics.strength_score = (
            metrics.frequency_score * 0.25
            + metrics.recency_score * 0.25
            + metrics.engagement_score * 0.25
            + (metrics.avg_sentiment + 1) / 2 * 0.25  # Normalize sentiment to 0-1
        )

        logger.info(
            "Relationship metrics calculated",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            interaction_count=metrics.interaction_count,
            strength_score=round(metrics.strength_score, 3),
        )

        return _complete_node(state, metrics, start_time)

    except Exception as e:
        logger.error(
            "Failed to calculate relationship metrics",
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
            "current_node": "calculate_relationship_metrics",
            "node_timings": {
                **state.trace.node_timings,
                "calculate_relationship_metrics": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    metrics: RelationshipMetrics,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "relationship_metrics": metrics.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "calculate_relationship_metrics",
            "node_timings": {
                **state.trace.node_timings,
                "calculate_relationship_metrics": node_timing,
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
        "relationship_metrics": RelationshipMetrics().model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "calculate_relationship_metrics",
            "node_timings": {
                **state.trace.node_timings,
                "calculate_relationship_metrics": node_timing,
            },
            "errors": state.trace.errors + [f"calculate_relationship_metrics: {error}"],
        },
    }
