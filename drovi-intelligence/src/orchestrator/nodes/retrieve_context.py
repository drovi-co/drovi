"""
Retrieve Context Node

Fetch recent and conversation-linked UIOs for memory-grounded extraction.
"""

import structlog

from src.memory import get_memory_service
from src.orchestrator.state import IntelligenceState

logger = structlog.get_logger()


async def retrieve_context_node(state: IntelligenceState) -> dict:
    """
    Retrieve recent UIOs and conversation-linked UIOs for context grounding.
    """
    logger.info(
        "Retrieving memory context",
        analysis_id=state.analysis_id,
        organization_id=state.input.organization_id,
    )

    state.trace.current_node = "retrieve_context"
    state.trace.nodes.append("retrieve_context")

    memory = await get_memory_service(state.input.organization_id)

    recent_uios = await memory.get_recent_uios(limit=10, days=90)
    conversation_uios = []
    if state.input.conversation_id:
        conversation_uios = await memory.get_conversation_uios(
            conversation_id=state.input.conversation_id,
            limit=10,
        )

    memory_context = {
        "recent_uios": recent_uios,
        "conversation_uios": conversation_uios,
    }

    return {"memory_context": memory_context}
