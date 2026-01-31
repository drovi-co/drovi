"""
Persist Contact Intelligence Node

Saves computed intelligence to PostgreSQL (contact table + snapshot)
and FalkorDB (graph updates).
"""

import time
from datetime import datetime
from typing import Any

import structlog

from src.db import get_db_pool
from src.graph import get_graph_client
from ..state import (
    ContactIntelligenceState,
    ContactIntelligenceOutput,
    NodeTiming,
)

logger = structlog.get_logger()


async def persist_contact_intelligence_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Persist computed intelligence to databases.

    Saves to:
    - PostgreSQL contact table (scores, lifecycle, role)
    - PostgreSQL contact_intelligence_snapshot (historical record)
    - FalkorDB Contact node (graph analytics)

    Returns:
        State update with output populated
    """
    start_time = time.time()

    logger.info(
        "Persisting contact intelligence",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "persist_contact_intelligence"
    state.trace.nodes.append("persist_contact_intelligence")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    try:
        pool = await get_db_pool()

        metrics = state.relationship_metrics
        role = state.role_detection
        lifecycle = state.lifecycle_detection
        comm = state.communication_profile
        graph = state.graph_analytics
        brief = state.brief

        # =================================================================
        # COMPUTE AGGREGATE SCORES
        # =================================================================

        # Health score: combination of relationship metrics
        health_score = (
            metrics.frequency_score * 0.25
            + metrics.recency_score * 0.25
            + metrics.engagement_score * 0.25
            + (1 - lifecycle.churn_risk_score) * 0.25
        )

        # Importance score: based on role and engagement
        importance_base = 0.5
        if role.role_type.value == "decision_maker":
            importance_base = 0.8
        elif role.role_type.value == "influencer":
            importance_base = 0.7
        elif role.role_type.value == "champion":
            importance_base = 0.65
        elif role.role_type.value == "gatekeeper":
            importance_base = 0.6

        if graph:
            importance_score = importance_base * 0.6 + graph.influence_score * 0.4
        else:
            importance_score = importance_base

        # Engagement score
        engagement_score = metrics.engagement_score

        # VIP and at-risk flags
        is_vip = importance_score > 0.7 or (
            role.role_type.value == "decision_maker"
            and metrics.strength_score > 0.5
        )
        is_at_risk = (
            lifecycle.churn_risk_score > 0.5
            or (metrics.days_since_last_interaction or 0) > 45
        )

        # =================================================================
        # UPDATE POSTGRESQL CONTACT
        # =================================================================

        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE contact SET
                    health_score = $2,
                    importance_score = $3,
                    engagement_score = $4,
                    sentiment_score = $5,

                    lifecycle_stage = $6,
                    role_type = $7,
                    seniority_level = $8,

                    influence_score = $9,
                    bridging_score = $10,
                    community_ids = $11,

                    communication_profile = $12,

                    is_vip = COALESCE(user_override_vip, $13),
                    is_at_risk = $14,
                    risk_reason = $15,

                    contact_brief = $16,

                    last_intelligence_at = NOW(),
                    intelligence_version = COALESCE(intelligence_version, 0) + 1,
                    updated_at = NOW()
                WHERE id = $1
                """,
                state.input.contact_id,
                health_score,
                importance_score,
                engagement_score,
                metrics.avg_sentiment,
                lifecycle.stage.value,
                role.role_type.value,
                role.seniority_estimate.value,
                graph.influence_score if graph else None,
                graph.bridging_score if graph else None,
                graph.community_ids if graph else [],
                comm.model_dump_json(),
                is_vip,
                is_at_risk,
                # Risk reason based on churn factors
                ", ".join(lifecycle.churn_risk_factors[:2]) if is_at_risk and lifecycle.churn_risk_factors else None,
                # Contact brief as JSON
                brief.model_dump_json() if brief else None,
            )

        # =================================================================
        # CREATE SNAPSHOT
        # =================================================================

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO contact_intelligence_snapshot (
                    id,
                    contact_id,
                    organization_id,
                    snapshot_at,
                    period_type,

                    health_score,
                    importance_score,
                    engagement_score,
                    sentiment_score,

                    interaction_count,
                    inbound_count,
                    outbound_count,
                    avg_response_time_minutes,
                    response_rate,
                    interactions_per_week,

                    pagerank_score,
                    bridging_score,
                    influence_score,

                    lifecycle_stage,
                    churn_risk_score,
                    role_type,

                    relationship_metrics,
                    communication_profile,
                    role_detection,
                    lifecycle_detection,
                    graph_analytics,
                    brief,

                    analysis_id,
                    analysis_duration_ms
                ) VALUES (
                    gen_random_uuid(),
                    $1, $2, NOW(), 'daily',
                    $3, $4, $5, $6,
                    $7, $8, $9, $10, $11, $12,
                    $13, $14, $15,
                    $16, $17, $18,
                    $19, $20, $21, $22, $23, $24,
                    $25, $26
                )
                """,
                state.input.contact_id,
                state.input.organization_id,
                health_score,
                importance_score,
                engagement_score,
                metrics.avg_sentiment,
                metrics.interaction_count,
                metrics.inbound_count,
                metrics.outbound_count,
                metrics.avg_response_time_minutes,
                metrics.response_rate,
                metrics.interactions_per_week,
                graph.pagerank_score if graph else None,
                graph.bridging_score if graph else None,
                graph.influence_score if graph else None,
                lifecycle.stage.value,
                lifecycle.churn_risk_score,
                role.role_type.value,
                metrics.model_dump_json(),
                comm.model_dump_json(),
                role.model_dump_json(),
                lifecycle.model_dump_json(),
                graph.model_dump_json() if graph else None,
                brief.model_dump_json() if brief else None,
                state.analysis_id,
                int((time.time() - state.trace.started_at) * 1000),
            )

        # =================================================================
        # UPDATE FALKORDB
        # =================================================================

        try:
            from datetime import timezone
            now = datetime.now(timezone.utc).isoformat()

            graph_client = await get_graph_client()
            await graph_client.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                SET c.healthScore = $healthScore,
                    c.importanceScore = $importanceScore,
                    c.engagementScore = $engagementScore,
                    c.lifecycleStage = $lifecycleStage,
                    c.roleType = $roleType,
                    c.influenceScore = $influenceScore,
                    c.bridgingScore = $bridgingScore,
                    c.isVip = $isVip,
                    c.isAtRisk = $isAtRisk,
                    c.lastIntelligenceAt = $now
                """,
                {
                    "contactId": state.input.contact_id,
                    "orgId": state.input.organization_id,
                    "healthScore": health_score,
                    "importanceScore": importance_score,
                    "engagementScore": engagement_score,
                    "lifecycleStage": lifecycle.stage.value,
                    "roleType": role.role_type.value,
                    "influenceScore": graph.influence_score if graph else 0,
                    "bridgingScore": graph.bridging_score if graph else 0,
                    "isVip": is_vip,
                    "isAtRisk": is_at_risk,
                    "now": now,
                },
            )
        except Exception as e:
            logger.warning(
                "Failed to update FalkorDB",
                error=str(e),
            )

        # =================================================================
        # BUILD OUTPUT
        # =================================================================

        duration_ms = int((time.time() - state.trace.started_at) * 1000)

        output = ContactIntelligenceOutput(
            contact_id=state.input.contact_id,
            organization_id=state.input.organization_id,
            relationship_metrics=metrics,
            communication_profile=comm,
            role_detection=role,
            lifecycle_detection=lifecycle,
            graph_analytics=graph,
            brief=brief,
            health_score=health_score,
            importance_score=importance_score,
            engagement_score=engagement_score,
            is_vip=is_vip,
            is_at_risk=is_at_risk,
            needs_attention=brief.relationship_status in ["needs_attention", "at_risk"]
            if brief
            else False,
            analysis_id=state.analysis_id,
            analyzed_at=datetime.utcnow(),
            analysis_duration_ms=duration_ms,
        )

        logger.info(
            "Contact intelligence persisted",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            health_score=round(health_score, 2),
            is_vip=is_vip,
            is_at_risk=is_at_risk,
        )

        return _complete_node(state, output, start_time)

    except Exception as e:
        logger.error(
            "Failed to persist contact intelligence",
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
            "current_node": "persist_contact_intelligence",
            "node_timings": {
                **state.trace.node_timings,
                "persist_contact_intelligence": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    output: ContactIntelligenceOutput,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "output": output.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "persist_contact_intelligence",
            "node_timings": {
                **state.trace.node_timings,
                "persist_contact_intelligence": node_timing,
            },
            "completed_at": time.time(),
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
        "trace": {
            **state.trace.model_dump(),
            "current_node": "persist_contact_intelligence",
            "node_timings": {
                **state.trace.node_timings,
                "persist_contact_intelligence": node_timing,
            },
            "errors": state.trace.errors + [f"persist_contact_intelligence: {error}"],
        },
    }
