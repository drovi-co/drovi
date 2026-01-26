"""
Contact Intelligence Pipeline Graph

LangGraph pipeline for deep contact analysis.
Runs daily for all contacts or on-demand for specific contacts.
"""

from typing import Literal

import structlog
from langgraph.graph import END, StateGraph

from .state import ContactIntelligenceState, ContactIntelligenceInput

logger = structlog.get_logger()


# =============================================================================
# Node Functions
# =============================================================================


async def load_contact_data(state: ContactIntelligenceState) -> dict:
    """Load all data for the contact."""
    from .nodes.load_contact_data import load_contact_data_node

    return await load_contact_data_node(state)


async def calculate_relationship_metrics(state: ContactIntelligenceState) -> dict:
    """Calculate relationship metrics."""
    from .nodes.calculate_relationship_metrics import calculate_relationship_metrics_node

    return await calculate_relationship_metrics_node(state)


async def profile_communication_style(state: ContactIntelligenceState) -> dict:
    """Profile communication style."""
    from .nodes.profile_communication_style import profile_communication_style_node

    return await profile_communication_style_node(state)


async def detect_role_influence(state: ContactIntelligenceState) -> dict:
    """Detect role and influence."""
    from .nodes.detect_role_influence import detect_role_influence_node

    return await detect_role_influence_node(state)


async def infer_lifecycle_stage(state: ContactIntelligenceState) -> dict:
    """Infer lifecycle stage."""
    from .nodes.infer_lifecycle_stage import infer_lifecycle_stage_node

    return await infer_lifecycle_stage_node(state)


async def compute_graph_analytics(state: ContactIntelligenceState) -> dict:
    """Compute graph analytics."""
    from .nodes.compute_graph_analytics import compute_graph_analytics_node

    return await compute_graph_analytics_node(state)


async def generate_contact_brief(state: ContactIntelligenceState) -> dict:
    """Generate contact brief."""
    from .nodes.generate_contact_brief import generate_contact_brief_node

    return await generate_contact_brief_node(state)


async def persist_contact_intelligence(state: ContactIntelligenceState) -> dict:
    """Persist contact intelligence."""
    from .nodes.persist_contact_intelligence import persist_contact_intelligence_node

    return await persist_contact_intelligence_node(state)


# =============================================================================
# Routing Functions
# =============================================================================


def should_continue(state: ContactIntelligenceState) -> Literal["continue", "end"]:
    """Check if pipeline should continue or end early."""
    if state.skip_remaining:
        return "end"
    return "continue"


def after_load(state: ContactIntelligenceState) -> Literal["calculate_metrics", "end"]:
    """Route after loading data."""
    if state.skip_remaining or not state.loaded_data:
        return "end"
    return "calculate_metrics"


def after_lifecycle(
    state: ContactIntelligenceState,
) -> Literal["graph_analytics", "generate_brief"]:
    """Route after lifecycle inference - optionally skip graph analytics."""
    if not state.input.include_graph_analytics:
        return "generate_brief"
    return "graph_analytics"


# =============================================================================
# Graph Construction
# =============================================================================


def create_contact_intelligence_graph() -> StateGraph:
    """
    Create the contact intelligence pipeline graph.

    Pipeline flow:
    1. load_contact_data - Load all interactions from all sources
    2. calculate_relationship_metrics - Frequency, recency, sentiment trends
    3. profile_communication_style - Formal/casual, response times, preferred channel
    4. detect_role_influence - Decision-maker, gatekeeper, champion, end-user
    5. infer_lifecycle_stage - Lead, prospect, customer, churned
    6. compute_graph_analytics - PageRank, centrality, communities (optional)
    7. generate_contact_brief - Executive summary
    8. persist_contact_intelligence - Save to PostgreSQL + FalkorDB
    """
    workflow = StateGraph(ContactIntelligenceState)

    # Add all nodes
    workflow.add_node("load_contact_data", load_contact_data)
    workflow.add_node("calculate_relationship_metrics", calculate_relationship_metrics)
    workflow.add_node("profile_communication_style", profile_communication_style)
    workflow.add_node("detect_role_influence", detect_role_influence)
    workflow.add_node("infer_lifecycle_stage", infer_lifecycle_stage)
    workflow.add_node("compute_graph_analytics", compute_graph_analytics)
    workflow.add_node("generate_contact_brief", generate_contact_brief)
    workflow.add_node("persist_contact_intelligence", persist_contact_intelligence)

    # Set entry point
    workflow.set_entry_point("load_contact_data")

    # Define edges
    # load_contact_data -> calculate_relationship_metrics OR end
    workflow.add_conditional_edges(
        "load_contact_data",
        after_load,
        {
            "calculate_metrics": "calculate_relationship_metrics",
            "end": END,
        },
    )

    # Linear flow through analysis nodes
    workflow.add_edge("calculate_relationship_metrics", "profile_communication_style")
    workflow.add_edge("profile_communication_style", "detect_role_influence")
    workflow.add_edge("detect_role_influence", "infer_lifecycle_stage")

    # infer_lifecycle_stage -> compute_graph_analytics OR generate_contact_brief
    workflow.add_conditional_edges(
        "infer_lifecycle_stage",
        after_lifecycle,
        {
            "graph_analytics": "compute_graph_analytics",
            "generate_brief": "generate_contact_brief",
        },
    )

    # compute_graph_analytics -> generate_contact_brief
    workflow.add_edge("compute_graph_analytics", "generate_contact_brief")

    # generate_contact_brief -> persist_contact_intelligence
    workflow.add_edge("generate_contact_brief", "persist_contact_intelligence")

    # persist_contact_intelligence -> END
    workflow.add_edge("persist_contact_intelligence", END)

    logger.info("Contact intelligence graph created", nodes=list(workflow.nodes.keys()))

    return workflow


def compile_contact_intelligence_graph():
    """Compile the contact intelligence graph for execution."""
    graph = create_contact_intelligence_graph()
    return graph.compile()


# =============================================================================
# Graph Execution
# =============================================================================


async def run_contact_intelligence(
    contact_id: str,
    organization_id: str,
    include_graph_analytics: bool = True,
    force_refresh: bool = False,
) -> ContactIntelligenceState:
    """
    Run the contact intelligence pipeline for a single contact.

    Args:
        contact_id: The contact to analyze
        organization_id: The organization scope
        include_graph_analytics: Whether to compute expensive graph metrics
        force_refresh: Whether to recompute even if recent analysis exists

    Returns:
        The final ContactIntelligenceState with all computed intelligence
    """
    # Create initial state
    initial_input = ContactIntelligenceInput(
        organization_id=organization_id,
        contact_id=contact_id,
        include_graph_analytics=include_graph_analytics,
        force_refresh=force_refresh,
    )

    initial_state = ContactIntelligenceState(input=initial_input)

    # Compile and run
    compiled_graph = compile_contact_intelligence_graph()

    logger.info(
        "Starting contact intelligence analysis",
        analysis_id=initial_state.analysis_id,
        contact_id=contact_id,
        organization_id=organization_id,
    )

    # Execute
    final_state = await compiled_graph.ainvoke(initial_state)

    logger.info(
        "Contact intelligence analysis complete",
        analysis_id=initial_state.analysis_id,
        contact_id=contact_id,
        duration_ms=final_state.output.analysis_duration_ms
        if final_state.output
        else None,
    )

    return final_state


async def run_batch_contact_intelligence(
    contact_ids: list[str],
    organization_id: str,
    include_graph_analytics: bool = True,
    max_concurrent: int = 5,
) -> list[ContactIntelligenceState]:
    """
    Run contact intelligence pipeline for multiple contacts.

    Args:
        contact_ids: List of contact IDs to analyze
        organization_id: The organization scope
        include_graph_analytics: Whether to compute graph metrics
        max_concurrent: Maximum concurrent analyses

    Returns:
        List of final states for each contact
    """
    import asyncio

    semaphore = asyncio.Semaphore(max_concurrent)

    async def analyze_with_semaphore(contact_id: str):
        async with semaphore:
            return await run_contact_intelligence(
                contact_id=contact_id,
                organization_id=organization_id,
                include_graph_analytics=include_graph_analytics,
            )

    logger.info(
        "Starting batch contact intelligence",
        contact_count=len(contact_ids),
        organization_id=organization_id,
        max_concurrent=max_concurrent,
    )

    results = await asyncio.gather(
        *[analyze_with_semaphore(cid) for cid in contact_ids],
        return_exceptions=True,
    )

    # Filter out exceptions
    successful = [r for r in results if isinstance(r, ContactIntelligenceState)]
    failed = [r for r in results if isinstance(r, Exception)]

    logger.info(
        "Batch contact intelligence complete",
        successful=len(successful),
        failed=len(failed),
    )

    return successful
