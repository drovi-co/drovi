"""
Generate Contact Brief Node

Generates an executive summary and talking points for the contact
based on all computed intelligence.
"""

import time
from datetime import datetime
from typing import Any, Literal

import structlog

from ..state import (
    ContactIntelligenceState,
    ContactBrief,
    NodeTiming,
)

logger = structlog.get_logger()


async def generate_contact_brief_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Generate an executive brief for the contact.

    Creates:
    - 2-3 sentence overview
    - Key insights (3-5 bullet points)
    - Suggested actions
    - Talking points for meetings

    Returns:
        State update with brief populated
    """
    start_time = time.time()

    logger.info(
        "Generating contact brief",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "generate_contact_brief"
    state.trace.nodes.append("generate_contact_brief")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    try:
        loaded = state.loaded_data
        metrics = state.relationship_metrics
        role = state.role_detection
        lifecycle = state.lifecycle_detection
        comm = state.communication_profile
        graph = state.graph_analytics

        # =================================================================
        # RELATIONSHIP STATUS
        # =================================================================

        status = _determine_relationship_status(metrics, lifecycle)

        # =================================================================
        # BRIEF SUMMARY
        # =================================================================

        summary_parts = []

        # Contact intro
        name = loaded.contact_name or loaded.contact_email.split("@")[0]
        if loaded.contact_title and loaded.contact_company:
            summary_parts.append(
                f"{name} is {loaded.contact_title} at {loaded.contact_company}."
            )
        elif loaded.contact_company:
            summary_parts.append(f"{name} works at {loaded.contact_company}.")
        else:
            summary_parts.append(f"{name} ({loaded.contact_email}).")

        # Relationship context
        if metrics.days_since_first_interaction:
            months = metrics.days_since_first_interaction // 30
            if months > 12:
                years = months // 12
                summary_parts.append(
                    f"You've been in contact for over {years} year{'s' if years > 1 else ''}."
                )
            elif months > 1:
                summary_parts.append(f"You've been in contact for {months} months.")

        # Status context
        if status == "at_risk":
            summary_parts.append(
                "This relationship needs attention - engagement has dropped significantly."
            )
        elif status == "needs_attention":
            summary_parts.append("Consider reaching out to maintain the relationship.")
        elif status == "strong":
            summary_parts.append("This is a strong, healthy relationship.")

        brief_summary = " ".join(summary_parts)

        # =================================================================
        # KEY INSIGHTS
        # =================================================================

        insights = []

        # Role insight
        if role.role_type.value != "unknown":
            insights.append(
                f"Acts as a {role.role_type.value.replace('_', ' ')} in their organization"
            )

        # Engagement insight
        if metrics.engagement_score > 0.7:
            insights.append("Highly engaged - responds quickly and thoroughly")
        elif metrics.engagement_score < 0.3:
            insights.append("Low engagement - may need different approach")

        # Communication style insight
        if comm.preferred_channel.value != "unknown":
            insights.append(f"Prefers {comm.preferred_channel.value} for communication")

        if comm.formality_level.value == "formal":
            insights.append("Communicates formally - match their tone")
        elif comm.formality_level.value == "casual":
            insights.append("Has a casual communication style")

        # Network insight
        if graph and graph.is_hub:
            insights.append("Well-connected - influences many others in the network")
        elif graph and graph.is_bridge:
            insights.append("Key connector between different groups/teams")

        # Lifecycle insight
        if lifecycle.churn_risk_score > 0.5:
            insights.append(
                f"Churn risk detected: {', '.join(lifecycle.churn_risk_factors[:2])}"
            )
        elif lifecycle.expansion_potential > 0.5:
            insights.append("Shows expansion potential - opportunity to deepen relationship")

        # Commitment insight
        open_commitments = [
            c for c in loaded.commitments if c.status in ["pending", "in_progress"]
        ]
        if open_commitments:
            owed_to = sum(
                1 for c in open_commitments if c.direction == "owed_to_contact"
            )
            owed_by = sum(
                1 for c in open_commitments if c.direction == "owed_by_contact"
            )
            if owed_to > 0:
                insights.append(f"You owe them {owed_to} commitment{'s' if owed_to > 1 else ''}")
            if owed_by > 0:
                insights.append(f"They owe you {owed_by} commitment{'s' if owed_by > 1 else ''}")

        # =================================================================
        # SUGGESTED ACTIONS
        # =================================================================

        actions = []

        # Based on recency
        days_since = metrics.days_since_last_interaction or 0
        if days_since > 30:
            actions.append("Reach out - it's been over a month since last contact")
        elif days_since > 14 and status != "strong":
            actions.append("Consider a quick check-in to maintain relationship")

        # Based on commitments
        overdue = [
            c for c in loaded.commitments
            if c.status in ["pending", "in_progress"]
            and c.due_date
            and c.due_date < datetime.utcnow()
        ]
        if overdue:
            owed_to_overdue = [c for c in overdue if c.direction == "owed_to_contact"]
            if owed_to_overdue:
                actions.append(
                    f"Address {len(owed_to_overdue)} overdue commitment{'s' if len(owed_to_overdue) > 1 else ''} you owe them"
                )

        # Based on churn risk
        if lifecycle.churn_risk_score > 0.6:
            actions.append("Schedule a call to re-engage and understand their needs")

        # Based on expansion
        if lifecycle.expansion_potential > 0.5:
            actions.append("Explore ways to expand the relationship/scope")

        # Based on role
        if role.makes_decisions and not actions:
            actions.append("Keep them informed on key decisions and updates")

        # =================================================================
        # TALKING POINTS
        # =================================================================

        talking_points = []

        # Recent activity
        if loaded.interactions:
            recent = loaded.interactions[0]
            if recent.subject:
                talking_points.append(f"Follow up on: {recent.subject[:50]}")

        # Open commitments
        for commitment in open_commitments[:2]:
            talking_points.append(f"Status of: {commitment.title[:50]}")

        # Recent decisions
        recent_decisions = [
            d for d in loaded.decisions
            if d.decided_at
            and d.decided_at > datetime.utcnow() - __import__("datetime").timedelta(days=30)
        ]
        for decision in recent_decisions[:2]:
            talking_points.append(f"Discuss impact of decision: {decision.title[:50]}")

        # Generic if nothing specific
        if not talking_points:
            talking_points.append("Ask about their current priorities")
            talking_points.append("Share relevant updates from your side")

        # =================================================================
        # COMMITMENT/DECISION SUMMARIES
        # =================================================================

        open_commits_summary = None
        if open_commitments:
            owed_to = sum(
                1 for c in open_commitments if c.direction == "owed_to_contact"
            )
            owed_by = sum(
                1 for c in open_commitments if c.direction == "owed_by_contact"
            )
            parts = []
            if owed_to > 0:
                parts.append(f"{owed_to} owed by you")
            if owed_by > 0:
                parts.append(f"{owed_by} owed to you")
            open_commits_summary = f"{len(open_commitments)} open commitments ({', '.join(parts)})"

        pending_decisions_summary = None
        pending_decisions = [d for d in loaded.decisions if not d.decided_at]
        if pending_decisions:
            pending_decisions_summary = f"{len(pending_decisions)} pending decisions"

        # =================================================================
        # BUILD BRIEF
        # =================================================================

        brief = ContactBrief(
            brief_summary=brief_summary,
            relationship_status=status,
            key_insights=insights[:5],
            suggested_actions=actions[:3],
            open_commitments_summary=open_commits_summary,
            pending_decisions_summary=pending_decisions_summary,
            talking_points=talking_points[:5],
            generated_at=datetime.utcnow(),
        )

        logger.info(
            "Contact brief generated",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            status=status,
            insights_count=len(insights),
        )

        return _complete_node(state, brief, start_time)

    except Exception as e:
        logger.error(
            "Failed to generate contact brief",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        return _error_node(state, start_time, str(e))


def _determine_relationship_status(
    metrics, lifecycle
) -> Literal["strong", "healthy", "neutral", "needs_attention", "at_risk"]:
    """Determine overall relationship status."""
    # Check for at-risk signals
    if lifecycle.churn_risk_score > 0.6:
        return "at_risk"

    if metrics.days_since_last_interaction and metrics.days_since_last_interaction > 45:
        return "at_risk"

    # Check strength
    strength = metrics.strength_score
    if strength > 0.7:
        return "strong"
    elif strength > 0.5:
        return "healthy"
    elif strength > 0.3:
        return "neutral"
    else:
        return "needs_attention"


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
            "current_node": "generate_contact_brief",
            "node_timings": {
                **state.trace.node_timings,
                "generate_contact_brief": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    brief: ContactBrief,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "brief": brief.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "generate_contact_brief",
            "node_timings": {
                **state.trace.node_timings,
                "generate_contact_brief": node_timing,
            },
        },
    }


def _error_node(
    state: ContactIntelligenceState,
    start_time: float,
    error: str,
) -> dict[str, Any]:
    """Return error state update with default brief."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )

    default_brief = ContactBrief(
        brief_summary="Unable to generate brief due to an error.",
        relationship_status="neutral",
        key_insights=[],
        suggested_actions=["Review contact manually"],
        talking_points=[],
    )

    return {
        "brief": default_brief.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "generate_contact_brief",
            "node_timings": {
                **state.trace.node_timings,
                "generate_contact_brief": node_timing,
            },
            "errors": state.trace.errors + [f"generate_contact_brief: {error}"],
        },
    }
