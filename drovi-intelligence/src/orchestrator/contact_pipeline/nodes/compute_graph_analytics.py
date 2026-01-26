"""
Compute Graph Analytics Node

Computes graph-based analytics using FalkorDB including:
- PageRank (influence)
- Betweenness centrality (bridging)
- Community detection
"""

import time
from typing import Any

import structlog

from src.graph import get_graph_client
from ..state import (
    ContactIntelligenceState,
    GraphAnalytics,
    NodeTiming,
)

logger = structlog.get_logger()


async def compute_graph_analytics_node(
    state: ContactIntelligenceState,
) -> dict[str, Any]:
    """
    Compute graph-based analytics for the contact.

    Uses FalkorDB to compute:
    - PageRank score (influence in network)
    - Betweenness centrality (bridge between groups)
    - Degree centrality (direct connections)
    - Community membership

    Returns:
        State update with graph_analytics populated
    """
    start_time = time.time()

    logger.info(
        "Computing graph analytics",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "compute_graph_analytics"
    state.trace.nodes.append("compute_graph_analytics")

    if state.skip_remaining or not state.loaded_data:
        return _skip_node(state, start_time)

    # Check if graph analytics is enabled
    if not state.input.include_graph_analytics:
        logger.info(
            "Graph analytics disabled, skipping",
            analysis_id=state.analysis_id,
        )
        return _skip_node(state, start_time)

    try:
        analytics = GraphAnalytics()
        graph = await get_graph_client()

        contact_id = state.input.contact_id
        org_id = state.input.organization_id

        # =================================================================
        # PAGERANK (Influence)
        # =================================================================

        try:
            pagerank_result = await graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                RETURN c.pagerankScore as pagerank
                """,
                {"contactId": contact_id, "orgId": org_id},
            )

            if pagerank_result and len(pagerank_result) > 0:
                analytics.pagerank_score = pagerank_result[0].get("pagerank", 0.0) or 0.0
        except Exception as e:
            logger.warning("Failed to get PageRank", error=str(e))

        # =================================================================
        # DEGREE CENTRALITY (Direct connections)
        # =================================================================

        try:
            degree_result = await graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                OPTIONAL MATCH (c)-[r:COMMUNICATES_WITH]-(other:Contact)
                RETURN count(DISTINCT other) as degree
                """,
                {"contactId": contact_id, "orgId": org_id},
            )

            if degree_result and len(degree_result) > 0:
                degree = degree_result[0].get("degree", 0) or 0

                # Normalize to 0-1 (assuming max 100 connections is high)
                analytics.degree_centrality = min(degree / 100, 1.0)

                # Determine if hub
                analytics.is_hub = degree > 20
        except Exception as e:
            logger.warning("Failed to get degree centrality", error=str(e))

        # =================================================================
        # BETWEENNESS CENTRALITY (Bridging)
        # =================================================================

        try:
            # Get pre-computed bridging score if available
            bridging_result = await graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                RETURN c.bridgingScore as bridging
                """,
                {"contactId": contact_id, "orgId": org_id},
            )

            if bridging_result and len(bridging_result) > 0:
                analytics.betweenness_centrality = (
                    bridging_result[0].get("bridging", 0.0) or 0.0
                )

                # Determine if bridge
                analytics.is_bridge = analytics.betweenness_centrality > 0.3
        except Exception as e:
            logger.warning("Failed to get betweenness centrality", error=str(e))

        # =================================================================
        # COMMUNITY DETECTION
        # =================================================================

        try:
            community_result = await graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                RETURN c.communityIds as communities
                """,
                {"contactId": contact_id, "orgId": org_id},
            )

            if community_result and len(community_result) > 0:
                communities = community_result[0].get("communities", [])
                if communities:
                    analytics.community_ids = communities
                    analytics.primary_community_id = communities[0] if communities else None
        except Exception as e:
            logger.warning("Failed to get communities", error=str(e))

        # =================================================================
        # COMPUTE DERIVED SCORES
        # =================================================================

        # Influence score: weighted combination of pagerank and degree
        analytics.influence_score = (
            analytics.pagerank_score * 0.6 + analytics.degree_centrality * 0.4
        )

        # Bridging score: from betweenness centrality
        analytics.bridging_score = analytics.betweenness_centrality

        # Peripheral detection: low degree and not a bridge
        analytics.is_peripheral = (
            analytics.degree_centrality < 0.1 and not analytics.is_bridge
        )

        logger.info(
            "Graph analytics computed",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            pagerank=round(analytics.pagerank_score, 3),
            influence=round(analytics.influence_score, 3),
            communities=len(analytics.community_ids),
        )

        return _complete_node(state, analytics, start_time)

    except Exception as e:
        logger.error(
            "Failed to compute graph analytics",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        # Graph analytics failure is not fatal - continue pipeline
        return _complete_node(state, GraphAnalytics(), start_time)


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
            "current_node": "compute_graph_analytics",
            "node_timings": {
                **state.trace.node_timings,
                "compute_graph_analytics": node_timing,
            },
        },
    }


def _complete_node(
    state: ContactIntelligenceState,
    analytics: GraphAnalytics,
    start_time: float,
) -> dict[str, Any]:
    """Return successful completion state update."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
        duration_ms=int((time.time() - start_time) * 1000),
    )
    return {
        "graph_analytics": analytics.model_dump(),
        "trace": {
            **state.trace.model_dump(),
            "current_node": "compute_graph_analytics",
            "node_timings": {
                **state.trace.node_timings,
                "compute_graph_analytics": node_timing,
            },
        },
    }
