"""
Agent Module

Provides:
- Context session management for AI agent interactions
- AG2 (AutoGen) multi-agent integration with Drovi knowledge graph
- LangGraph agentic workflows for intelligence operations
"""

from src.agents.sessions import (
    AgentSession,
    SessionManager,
    get_session_manager,
)
from src.agents.context import (
    AgentContext,
    ContextEntry,
    ContextType,
)
from src.agents.ag2_integration import (
    DroviAG2Integration,
    get_ag2_integration,
    get_together_llm_config,
)
from src.agents.langgraph_workflows import (
    DroviWorkflows,
    get_workflows,
    ResearchState,
    RiskAnalysisState,
    IntelligenceBriefState,
)

__all__ = [
    # Session management
    "AgentSession",
    "AgentContext",
    "ContextEntry",
    "ContextType",
    "SessionManager",
    "get_session_manager",
    # AG2 multi-agent integration
    "DroviAG2Integration",
    "get_ag2_integration",
    "get_together_llm_config",
    # LangGraph workflows
    "DroviWorkflows",
    "get_workflows",
    "ResearchState",
    "RiskAnalysisState",
    "IntelligenceBriefState",
]
