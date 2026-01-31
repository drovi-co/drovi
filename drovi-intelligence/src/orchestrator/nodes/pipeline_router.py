"""
Pipeline Router Node

Routes content through the appropriate extraction path based on
source intelligence classification.

Routing paths:
- SKIP: Newsletter, automated → end pipeline immediately
- MINIMAL: Transactional → extract dates/contacts only
- STRUCTURED: Calendar events → use structured extraction
- FULL: Human content → full intelligence extraction
"""

import time
from typing import Literal

import structlog

from ..state import (
    IntelligenceState,
    NodeTiming,
)

logger = structlog.get_logger()


# Route types
RouteType = Literal["skip", "minimal", "structured", "full"]


def determine_route(state: IntelligenceState) -> RouteType:
    """
    Determine the pipeline route based on source intelligence.

    Args:
        state: Current intelligence state with source_intelligence

    Returns:
        Route type for conditional edges
    """
    # Get source intelligence from state (set by source_intelligence_node)
    source_intel = getattr(state, "source_intelligence", None)

    if not source_intel:
        # No source intelligence, default to full extraction
        return "full"

    if isinstance(source_intel, dict):
        extraction_level = source_intel.get("extraction_level", "full")
        should_extract = source_intel.get("should_extract", True)
    else:
        extraction_level = getattr(source_intel, "extraction_level", "full")
        should_extract = getattr(source_intel, "should_extract", True)

    if not should_extract:
        return "skip"

    if extraction_level == "minimal":
        return "minimal"

    if extraction_level == "structured":
        return "structured"

    return "full"


async def pipeline_router_node(state: IntelligenceState) -> dict:
    """
    Router node that determines the extraction path.

    This node runs after source_intelligence to set up conditional routing.

    Pipeline position: After source_intelligence, before content_zones

    Args:
        state: Current intelligence state

    Returns:
        Dict with route field for conditional edges
    """
    start_time = time.time()

    route = determine_route(state)

    logger.info(
        "Pipeline route determined",
        analysis_id=state.analysis_id,
        route=route,
        source_type=state.input.source_type,
    )

    # Update trace
    updated_trace = state.trace.model_copy()
    updated_trace.nodes = [*state.trace.nodes, "pipeline_router"]
    updated_trace.current_node = "pipeline_router"
    updated_trace.node_timings["pipeline_router"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "trace": updated_trace,
        "pipeline_route": route,
    }


def route_by_extraction_level(state: IntelligenceState) -> RouteType:
    """
    Conditional edge function for LangGraph routing.

    Use this as the condition function in graph.add_conditional_edges().

    Example:
        graph.add_conditional_edges(
            "pipeline_router",
            route_by_extraction_level,
            {
                "skip": END,
                "minimal": "minimal_extraction",
                "structured": "structured_extraction",
                "full": "content_zones",
            }
        )
    """
    return determine_route(state)
