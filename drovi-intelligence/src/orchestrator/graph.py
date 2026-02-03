"""
LangGraph Intelligence Extraction Pipeline

The main orchestrator graph that coordinates all agent nodes
for extracting intelligence from content.

Pipeline Overview:
1. SOURCE TRIAGE (new - eliminates garbage BEFORE LLM calls)
   - source_intelligence: Rule-based source/channel classification
   - pipeline_router: Route to skip/minimal/full extraction
   - content_zones: Remove noise zones (signatures, footers, etc.)

2. EXTRACTION (LLM-based)
   - parse_messages → classify → extract_claims/commitments/decisions

3. POST-PROCESSING
   - entity_resolution → deduplicate → signal_filter → persist
"""

from typing import Literal

import structlog
from langgraph.graph import END, StateGraph

from .state import IntelligenceState, Routing

logger = structlog.get_logger()


# =============================================================================
# Source Triage Nodes (NEW - run BEFORE extraction to eliminate garbage)
# =============================================================================


async def source_intelligence(state: IntelligenceState) -> dict:
    """Classify source to determine content category and extraction level."""
    from .nodes.source_intelligence import source_intelligence_node

    return await source_intelligence_node(state)


async def pipeline_router(state: IntelligenceState) -> dict:
    """Route to appropriate extraction path based on source intelligence."""
    from .nodes.pipeline_router import pipeline_router_node

    return await pipeline_router_node(state)


async def content_zones(state: IntelligenceState) -> dict:
    """Remove noise zones (signatures, footers, etc.) before extraction."""
    from .nodes.content_zones import content_zones_node

    return await content_zones_node(state)


# =============================================================================
# Node Functions (placeholders - will be replaced by actual node implementations)
# =============================================================================


async def parse_messages(state: IntelligenceState) -> dict:
    """Parse raw content into structured messages."""
    from .nodes.parse import parse_messages_node

    return await parse_messages_node(state)


async def persist_raw(state: IntelligenceState) -> dict:
    """Persist raw content to FalkorDB for deeper graph memory."""
    from .nodes.persist_raw import persist_raw_content_node

    return await persist_raw_content_node(state)


async def retrieve_context(state: IntelligenceState) -> dict:
    """Retrieve memory context from prior UIOs."""
    from .nodes.retrieve_context import retrieve_context_node

    return await retrieve_context_node(state)


async def summarize_long_content(state: IntelligenceState) -> dict:
    """Summarize long content into extraction-focused chunks."""
    from .nodes.summarize_long_content import summarize_long_content_node

    return await summarize_long_content_node(state)


async def resolve_contacts_early(state: IntelligenceState) -> dict:
    """Pre-resolve contacts before extraction for rich relationship context."""
    from .nodes.resolve_contacts_early import resolve_contacts_early_node

    return await resolve_contacts_early_node(state)


async def classify(state: IntelligenceState) -> dict:
    """Classify content to determine extraction paths."""
    from .nodes.classify import classify_node

    return await classify_node(state)


async def pattern_match(state: IntelligenceState) -> dict:
    """Match content against learned patterns (Klein's RPD)."""
    from .nodes.pattern_match import pattern_match_node

    return await pattern_match_node(state)


async def extract_claims(state: IntelligenceState) -> dict:
    """Extract claims from content."""
    from .nodes.extract_claims import extract_claims_node

    return await extract_claims_node(state)


async def extract_commitments(state: IntelligenceState) -> dict:
    """Extract commitments from content."""
    from .nodes.extract_commitments import extract_commitments_node

    return await extract_commitments_node(state)


async def extract_decisions(state: IntelligenceState) -> dict:
    """Extract decisions from content."""
    from .nodes.extract_decisions import extract_decisions_node

    return await extract_decisions_node(state)


async def extract_tasks(state: IntelligenceState) -> dict:
    """Extract tasks from content and commitments."""
    from .nodes.extract_tasks import extract_tasks_node

    return await extract_tasks_node(state)


async def detect_risks(state: IntelligenceState) -> dict:
    """Detect risks in extracted intelligence."""
    from .nodes.detect_risks import detect_risks_node

    return await detect_risks_node(state)

async def verify_extractions(state: IntelligenceState) -> dict:
    """Verify commitments/decisions against source text."""
    from .nodes.verify_extractions import verify_extractions_node

    return await verify_extractions_node(state)


async def calibrate_confidence(state: IntelligenceState) -> dict:
    """Calibrate confidence after verification."""
    from .nodes.calibrate_confidence import calibrate_confidence_node

    return await calibrate_confidence_node(state)

async def persist_candidates(state: IntelligenceState) -> dict:
    """Persist extracted candidates for fast retrieval."""
    from .nodes.persist_candidates import persist_candidates_node

    return await persist_candidates_node(state)


async def entity_resolution(state: IntelligenceState) -> dict:
    """Resolve and merge entities across sources."""
    from .nodes.entity_resolution import entity_resolution_node

    return await entity_resolution_node(state)


async def extract_relationships(state: IntelligenceState) -> dict:
    """Extract relationship signals between contacts."""
    from .nodes.extract_relationships import extract_relationships_node

    return await extract_relationships_node(state)


async def extract_communication(state: IntelligenceState) -> dict:
    """Extract communication patterns for relationship intelligence."""
    from .nodes.extract_communication import extract_communication_node

    return await extract_communication_node(state)


async def generate_brief(state: IntelligenceState) -> dict:
    """Generate a brief summary for the conversation."""
    from .nodes.generate_brief import generate_brief_node

    return await generate_brief_node(state)


async def deduplicate(state: IntelligenceState) -> dict:
    """Deduplicate extracted intelligence against existing UIOs."""
    from .nodes.deduplicate import deduplicate_node

    return await deduplicate_node(state)


async def detect_contradictions(state: IntelligenceState) -> dict:
    """Detect contradictions between new extractions and existing graph data."""
    from .nodes.detect_contradictions import detect_contradictions_node

    return await detect_contradictions_node(state)


async def signal_filter(state: IntelligenceState) -> dict:
    """Filter signal from noise using Wheeler's Statistical Process Control."""
    from .nodes.signal_filter import signal_filter_node

    return await signal_filter_node(state)


async def persist(state: IntelligenceState) -> dict:
    """Persist extracted intelligence to databases."""
    from .nodes.persist import persist_node

    return await persist_node(state)


async def link_intelligence(state: IntelligenceState) -> dict:
    """Cross-link intelligence objects for connected knowledge graph."""
    from .nodes.link_intelligence import link_intelligence_node

    return await link_intelligence_node(state)


async def evolve_memory(state: IntelligenceState) -> dict:
    """Evolve memory by detecting updates, deriving knowledge, and managing forgetting."""
    from .nodes.evolve_memory import evolve_memory_node

    return await evolve_memory_node(state)


async def enrich_contacts(state: IntelligenceState) -> dict:
    """Enrich contacts involved in this extraction with full contact intelligence."""
    from .nodes.enrich_contacts import enrich_contacts_node

    return await enrich_contacts_node(state)


async def finalize(state: IntelligenceState) -> dict:
    """Finalize the analysis and prepare output."""
    from .nodes.finalize import finalize_node

    return await finalize_node(state)


# =============================================================================
# Routing Functions
# =============================================================================


def route_after_source_intelligence(
    state: IntelligenceState,
) -> Literal["skip", "minimal", "full"]:
    """Route based on source intelligence classification."""
    from .nodes.pipeline_router import determine_route

    return determine_route(state)


def route_after_pipeline_router(
    state: IntelligenceState,
) -> Literal["skip", "minimal", "structured", "full"]:
    """Route based on pipeline_router decision."""
    from .nodes.pipeline_router import route_by_extraction_level

    return route_by_extraction_level(state)


def should_extract(state: IntelligenceState) -> Literal["pattern_match", "finalize"]:
    """Determine if we should proceed with extraction."""
    if state.routing.skip_remaining_nodes:
        return "finalize"

    if not state.classification.has_intelligence:
        return "finalize"

    return "pattern_match"


def after_pattern_match(state: IntelligenceState) -> Literal["extract_claims"]:
    """Route after pattern matching to extraction."""
    return "extract_claims"


def after_persist_raw(
    state: IntelligenceState,
) -> Literal["summarize_long_content", "finalize"]:
    """Stop early when the pipeline route is skip."""
    if state.pipeline_route == "skip":
        return "finalize"
    return "summarize_long_content"


def after_claims(
    state: IntelligenceState,
) -> Literal["extract_commitments", "detect_risks", "finalize"]:
    """Route after claims extraction."""
    if state.routing.skip_remaining_nodes:
        return "finalize"

    # Check if claims contain promise/request types that indicate commitments
    has_commitment_claims = any(
        c.type in ("promise", "request", "deadline", "action_item")
        for c in state.extracted.claims
    )

    # Extract commitments if classifier says so OR if claims suggest commitments
    if state.routing.should_extract_commitments or state.classification.has_commitments or has_commitment_claims:
        return "extract_commitments"

    if state.routing.should_analyze_risk:
        return "detect_risks"

    return "finalize"


def after_commitments(
    state: IntelligenceState,
) -> Literal["extract_decisions", "detect_risks", "finalize"]:
    """Route after commitments extraction."""
    if state.routing.skip_remaining_nodes:
        return "finalize"

    # Check if claims contain decision types
    has_decision_claims = any(
        c.type in ("decision", "opinion", "fact")
        for c in state.extracted.claims
    )

    # Extract decisions if classifier says so OR if claims suggest decisions
    if state.routing.should_extract_decisions or state.classification.has_decisions or has_decision_claims:
        return "extract_decisions"

    if state.routing.should_analyze_risk:
        return "detect_risks"

    return "finalize"


def after_decisions(
    state: IntelligenceState,
) -> Literal["extract_tasks", "detect_risks", "verify_extractions", "finalize"]:
    """Route after decisions extraction."""
    if state.routing.skip_remaining_nodes:
        return "finalize"

    # Always extract tasks if there are commitments (tasks are derived from them)
    if len(state.extracted.commitments) > 0 or state.classification.has_commitments:
        return "extract_tasks"

    if state.routing.should_analyze_risk and state.classification.has_risks:
        return "detect_risks"

    if state.routing.should_deduplicate:
        return "verify_extractions"

    return "finalize"


def after_tasks(
    state: IntelligenceState,
) -> Literal["detect_risks", "verify_extractions", "finalize"]:
    """Route after task extraction."""
    if state.routing.skip_remaining_nodes:
        return "finalize"

    if state.routing.should_analyze_risk and state.classification.has_risks:
        return "detect_risks"

    return "verify_extractions"


def after_risks(state: IntelligenceState) -> Literal["verify_extractions"]:
    """Route after risk detection."""
    return "verify_extractions"


def after_verification(state: IntelligenceState) -> Literal["calibrate_confidence"]:
    """Route after verification."""
    return "calibrate_confidence"


def after_calibration(state: IntelligenceState) -> Literal["persist_candidates"]:
    """Route after confidence calibration."""
    return "persist_candidates"


def after_persist_candidates(state: IntelligenceState) -> Literal["entity_resolution", "finalize"]:
    """Route after candidate persistence."""
    if state.input.candidate_only or state.routing.candidate_only:
        return "finalize"
    return "entity_resolution"


def after_entity_resolution(state: IntelligenceState) -> Literal["extract_relationships"]:
    """Route after entity resolution - extract relationships next."""
    return "extract_relationships"


def after_extract_relationships(state: IntelligenceState) -> Literal["extract_communication"]:
    """Route after relationship extraction - extract communication patterns next."""
    return "extract_communication"


def after_extract_communication(state: IntelligenceState) -> Literal["generate_brief"]:
    """Route after communication extraction - generate brief next."""
    return "generate_brief"


def after_generate_brief(state: IntelligenceState) -> Literal["deduplicate", "persist"]:
    """Route after brief generation."""
    if state.routing.should_deduplicate:
        return "deduplicate"

    return "persist"


def after_deduplicate(state: IntelligenceState) -> Literal["detect_contradictions"]:
    """Route after deduplication to contradiction detection."""
    return "detect_contradictions"


def after_detect_contradictions(state: IntelligenceState) -> Literal["signal_filter"]:
    """Route after contradiction detection to signal filtering."""
    return "signal_filter"


def after_signal_filter(state: IntelligenceState) -> Literal["persist"]:
    """Route after signal filtering."""
    return "persist"


def after_persist(state: IntelligenceState) -> Literal["link_intelligence"]:
    """Route after persistence to link intelligence."""
    return "link_intelligence"


def after_link_intelligence(state: IntelligenceState) -> Literal["evolve_memory"]:
    """Route after linking intelligence to evolve memory."""
    return "evolve_memory"


def after_evolve_memory(state: IntelligenceState) -> Literal["enrich_contacts"]:
    """Route after memory evolution to contact enrichment."""
    return "enrich_contacts"


def after_enrich_contacts(state: IntelligenceState) -> Literal["finalize"]:
    """Route after contact enrichment to finalize."""
    return "finalize"


# =============================================================================
# Graph Construction
# =============================================================================


def create_intelligence_graph() -> StateGraph:
    """
    Create the LangGraph intelligence extraction pipeline.

    The graph follows this general flow:

    PHASE 0 - SOURCE TRIAGE (eliminates garbage BEFORE LLM calls):
    0a. source_intelligence - Rule-based source/channel classification
    0b. pipeline_router - Route to skip/minimal/full extraction path
    0c. content_zones - Remove noise zones (signatures, footers, etc.)

    PHASE 1 - PARSING:
    1. parse_messages - Parse raw content into structured messages
    2. persist_raw - Persist raw content to FalkorDB (Phase 1 - Deeper Graph)
    3. resolve_contacts_early - Pre-resolve contacts for relationship context

    PHASE 2 - CLASSIFICATION & EXTRACTION:
    4. classify - Classify content to determine what to extract
    5. pattern_match - Match against learned patterns (Klein's RPD)
    6. extract_claims - Extract claims (facts, promises, questions, etc.)
    7. extract_commitments - Extract commitments (if applicable)
    8. extract_decisions - Extract decisions (if applicable)
    9. extract_tasks - Extract tasks from commitments
    10. detect_risks - Detect risks in extracted content
    10b. verify_extractions - Verify commitments/decisions against source text
    10c. calibrate_confidence - Normalize confidence after verification

    PHASE 3 - POST-PROCESSING:
    11. entity_resolution - Resolve and merge entities across sources
    12. extract_relationships - Extract relationship signals between contacts
    13. generate_brief - Generate 3-line summary and suggested actions
    14. deduplicate - Deduplicate against existing UIOs
    15. detect_contradictions - Detect contradictions with existing graph data
    16. signal_filter - Classify signal vs noise (Wheeler's SPC)
    17. persist - Save to PostgreSQL and FalkorDB
    18. evolve_memory - Evolve knowledge (handle updates/supersession)
    19. enrich_contacts - Run contact intelligence for involved contacts
    20. finalize - Prepare final output

    Routing is conditional based on source intelligence and classification.
    """
    # Create the graph with IntelligenceState
    workflow = StateGraph(IntelligenceState)

    # Add source triage nodes (PHASE 0 - run BEFORE any LLM calls)
    workflow.add_node("source_intelligence", source_intelligence)
    workflow.add_node("pipeline_router", pipeline_router)
    workflow.add_node("content_zones", content_zones)

    # Add all other nodes
    workflow.add_node("parse_messages", parse_messages)
    workflow.add_node("persist_raw", persist_raw)  # Raw content layer (Phase 1 - Deeper Graph)
    workflow.add_node("summarize_long_content", summarize_long_content)
    workflow.add_node("retrieve_context", retrieve_context)
    workflow.add_node("resolve_contacts_early", resolve_contacts_early)
    workflow.add_node("classify", classify)
    workflow.add_node("pattern_match", pattern_match)
    workflow.add_node("extract_claims", extract_claims)
    workflow.add_node("extract_commitments", extract_commitments)
    workflow.add_node("extract_decisions", extract_decisions)
    workflow.add_node("extract_tasks", extract_tasks)
    workflow.add_node("detect_risks", detect_risks)
    workflow.add_node("verify_extractions", verify_extractions)
    workflow.add_node("calibrate_confidence", calibrate_confidence)
    workflow.add_node("persist_candidates", persist_candidates)
    workflow.add_node("entity_resolution", entity_resolution)
    workflow.add_node("extract_relationships", extract_relationships)
    workflow.add_node("extract_communication", extract_communication)  # Communication graph (Phase 2)
    workflow.add_node("generate_brief", generate_brief)
    workflow.add_node("deduplicate", deduplicate)
    workflow.add_node("detect_contradictions", detect_contradictions)
    workflow.add_node("signal_filter", signal_filter)
    workflow.add_node("persist", persist)
    workflow.add_node("link_intelligence", link_intelligence)  # Cross-link intelligence (Phase 2)
    workflow.add_node("evolve_memory", evolve_memory)
    workflow.add_node("enrich_contacts", enrich_contacts)  # Contact intelligence enrichment
    workflow.add_node("finalize", finalize)

    # Set entry point - START with source triage
    workflow.set_entry_point("source_intelligence")

    # Define edges

    # PHASE 0: Source Triage (eliminates garbage BEFORE LLM calls)
    # source_intelligence -> pipeline_router -> skip/minimal/structured/full path
    workflow.add_edge("source_intelligence", "pipeline_router")
    workflow.add_conditional_edges(
        "pipeline_router",
        route_after_pipeline_router,
        {
            "skip": "parse_messages",  # Persist UEM, skip LLM extraction
            "minimal": "parse_messages",  # Minimal extraction (transactional)
            "structured": "parse_messages",  # Structured sources (calendar) reuse parsing for now
            "full": "content_zones",  # Full extraction (human content)
        },
    )

    # content_zones -> parse_messages (cleaned content)
    workflow.add_edge("content_zones", "parse_messages")

    # PHASE 1: Parsing
    # parse_messages -> persist_raw -> resolve_contacts_early -> classify (always)
    workflow.add_edge("parse_messages", "persist_raw")
    workflow.add_conditional_edges(
        "persist_raw",
        after_persist_raw,
        {
            "summarize_long_content": "summarize_long_content",
            "finalize": "finalize",
        },
    )
    workflow.add_edge("summarize_long_content", "retrieve_context")
    workflow.add_edge("retrieve_context", "resolve_contacts_early")
    workflow.add_edge("resolve_contacts_early", "classify")

    # classify -> pattern_match OR finalize (conditional)
    workflow.add_conditional_edges(
        "classify",
        should_extract,
        {
            "pattern_match": "pattern_match",
            "finalize": "finalize",
        },
    )

    # pattern_match -> extract_claims (always)
    workflow.add_edge("pattern_match", "extract_claims")

    # extract_claims -> extract_commitments OR detect_risks OR finalize
    workflow.add_conditional_edges(
        "extract_claims",
        after_claims,
        {
            "extract_commitments": "extract_commitments",
            "detect_risks": "detect_risks",
            "finalize": "finalize",
        },
    )

    # extract_commitments -> extract_decisions OR detect_risks OR finalize
    workflow.add_conditional_edges(
        "extract_commitments",
        after_commitments,
        {
            "extract_decisions": "extract_decisions",
            "detect_risks": "detect_risks",
            "finalize": "finalize",
        },
    )

    # extract_decisions -> extract_tasks OR detect_risks OR deduplicate OR finalize
    workflow.add_conditional_edges(
        "extract_decisions",
        after_decisions,
        {
            "extract_tasks": "extract_tasks",
            "detect_risks": "detect_risks",
            "verify_extractions": "verify_extractions",
            "finalize": "finalize",
        },
    )

    # extract_tasks -> detect_risks OR entity_resolution OR deduplicate OR finalize
    workflow.add_conditional_edges(
        "extract_tasks",
        after_tasks,
        {
            "detect_risks": "detect_risks",
            "verify_extractions": "verify_extractions",
            "finalize": "finalize",
        },
    )

    # detect_risks -> entity_resolution OR deduplicate OR persist
    workflow.add_conditional_edges(
        "detect_risks",
        after_risks,
        {
            "verify_extractions": "verify_extractions",
        },
    )

    workflow.add_conditional_edges(
        "verify_extractions",
        after_verification,
        {
            "calibrate_confidence": "calibrate_confidence",
        },
    )

    workflow.add_conditional_edges(
        "calibrate_confidence",
        after_calibration,
        {
            "persist_candidates": "persist_candidates",
        },
    )

    workflow.add_conditional_edges(
        "persist_candidates",
        after_persist_candidates,
        {
            "entity_resolution": "entity_resolution",
            "finalize": "finalize",
        },
    )

    # entity_resolution -> extract_relationships (always)
    workflow.add_conditional_edges(
        "entity_resolution",
        after_entity_resolution,
        {
            "extract_relationships": "extract_relationships",
        },
    )

    # extract_relationships -> extract_communication (always)
    workflow.add_conditional_edges(
        "extract_relationships",
        after_extract_relationships,
        {
            "extract_communication": "extract_communication",
        },
    )

    # extract_communication -> generate_brief (always)
    workflow.add_conditional_edges(
        "extract_communication",
        after_extract_communication,
        {
            "generate_brief": "generate_brief",
        },
    )

    # generate_brief -> deduplicate OR persist
    workflow.add_conditional_edges(
        "generate_brief",
        after_generate_brief,
        {
            "deduplicate": "deduplicate",
            "persist": "persist",
        },
    )

    # deduplicate -> detect_contradictions (always)
    workflow.add_edge("deduplicate", "detect_contradictions")

    # detect_contradictions -> signal_filter (always)
    workflow.add_edge("detect_contradictions", "signal_filter")

    # signal_filter -> persist (always)
    workflow.add_edge("signal_filter", "persist")

    # persist -> link_intelligence (always)
    workflow.add_edge("persist", "link_intelligence")

    # link_intelligence -> evolve_memory (always)
    workflow.add_edge("link_intelligence", "evolve_memory")

    # evolve_memory -> enrich_contacts (always)
    workflow.add_edge("evolve_memory", "enrich_contacts")

    # enrich_contacts -> finalize (always - enriches contacts involved in extraction)
    workflow.add_edge("enrich_contacts", "finalize")

    # finalize -> END
    workflow.add_edge("finalize", END)

    logger.info("Intelligence graph created", nodes=workflow.nodes.keys())

    return workflow


def compile_intelligence_graph():
    """Compile the intelligence graph for execution."""
    graph = create_intelligence_graph()
    return graph.compile()


# =============================================================================
# Graph Execution
# =============================================================================


async def run_intelligence_extraction(
    content: str,
    organization_id: str,
    source_type: str = "api",
    source_id: str | None = None,
    source_account_id: str | None = None,
    conversation_id: str | None = None,
    message_ids: list[str] | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
    metadata: dict | None = None,
    candidate_only: bool = False,
) -> IntelligenceState:
    """
    Run the intelligence extraction pipeline on content.

    Args:
        content: The text content to analyze
        organization_id: The organization ID
        source_type: Type of source (email, slack, etc.)
        source_id: Optional source identifier
        source_account_id: Optional source account ID
        conversation_id: Optional conversation/thread ID
        message_ids: Optional list of message IDs
        user_email: Optional user email for context
        user_name: Optional user name for context
        metadata: Optional source-specific metadata (from, subject, headers for email)

    Returns:
        The final IntelligenceState with all extracted intelligence
    """
    from .state import AnalysisInput

    # Create initial state
    initial_input = AnalysisInput(
        organization_id=organization_id,
        content=content,
        source_type=source_type,
        source_id=source_id,
        source_account_id=source_account_id,
        conversation_id=conversation_id,
        message_ids=message_ids,
        user_email=user_email,
        user_name=user_name,
        metadata=metadata,
        candidate_only=candidate_only,
    )

    initial_state = IntelligenceState(input=initial_input)

    # Compile and run the graph
    compiled_graph = compile_intelligence_graph()

    logger.info(
        "Starting intelligence extraction",
        analysis_id=initial_state.analysis_id,
        organization_id=organization_id,
        source_type=source_type,
        content_length=len(content),
    )

    # Execute the graph
    final_state_dict = await compiled_graph.ainvoke(initial_state)

    # Convert dict result back to IntelligenceState for type safety
    if isinstance(final_state_dict, dict):
        final_state = IntelligenceState(**final_state_dict)
    else:
        final_state = final_state_dict

    # Get extracted counts safely
    extracted = final_state.extracted if hasattr(final_state, 'extracted') else None

    logger.info(
        "Intelligence extraction complete",
        analysis_id=initial_state.analysis_id,
        claims_count=len(extracted.claims) if extracted else 0,
        commitments_count=len(extracted.commitments) if extracted else 0,
        decisions_count=len(extracted.decisions) if extracted else 0,
        tasks_count=len(extracted.tasks) if extracted else 0,
        contacts_count=len(extracted.contacts) if extracted else 0,
        risks_count=len(extracted.risks) if extracted else 0,
    )

    return final_state


async def stream_intelligence_extraction(
    content: str,
    organization_id: str,
    source_type: str = "api",
    **kwargs,
):
    """
    Stream intelligence extraction results as they're generated.

    Yields state updates after each node execution.
    """
    from .state import AnalysisInput

    initial_input = AnalysisInput(
        organization_id=organization_id,
        content=content,
        source_type=source_type,
        **kwargs,
    )

    initial_state = IntelligenceState(input=initial_input)

    compiled_graph = compile_intelligence_graph()

    logger.info(
        "Starting streaming intelligence extraction",
        analysis_id=initial_state.analysis_id,
    )

    # Stream state updates
    async for state_update in compiled_graph.astream(initial_state):
        yield state_update
