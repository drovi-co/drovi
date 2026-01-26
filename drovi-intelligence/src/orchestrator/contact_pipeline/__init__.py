"""
Contact Intelligence Pipeline

A dedicated LangGraph pipeline for deep contact analysis.
Runs daily for all contacts or on-demand for specific contacts.

Pipeline flow:
1. load_contact_data - Load all interactions from all sources
2. calculate_relationship_metrics - Frequency, recency, sentiment trends
3. profile_communication_style - Formal/casual, response times, preferred channel
4. detect_role_influence - Decision-maker, gatekeeper, champion, end-user
5. infer_lifecycle_stage - Lead, prospect, customer, churned
6. compute_graph_analytics - PageRank, centrality, communities
7. generate_contact_brief - Executive summary
8. persist_contact_intelligence - Save to PostgreSQL + FalkorDB
"""

from .state import (
    ContactIntelligenceInput,
    ContactIntelligenceOutput,
    ContactIntelligenceState,
    CommunicationProfile,
    ContactBrief,
    GraphAnalytics,
    LifecycleDetection,
    LifecycleStage,
    LoadedContactData,
    RelationshipMetrics,
    RoleDetection,
    RoleType,
    SeniorityLevel,
)
from .graph import (
    run_contact_intelligence,
    run_batch_contact_intelligence,
    compile_contact_intelligence_graph,
)

__all__ = [
    # State
    "ContactIntelligenceState",
    "ContactIntelligenceInput",
    "ContactIntelligenceOutput",
    # Models
    "LoadedContactData",
    "RelationshipMetrics",
    "CommunicationProfile",
    "RoleDetection",
    "LifecycleDetection",
    "GraphAnalytics",
    "ContactBrief",
    # Enums
    "LifecycleStage",
    "RoleType",
    "SeniorityLevel",
    # Graph execution
    "run_contact_intelligence",
    "run_batch_contact_intelligence",
    "compile_contact_intelligence_graph",
]
