"""
Retrieve Context Node

Fetch recent and conversation-linked UIOs for memory-grounded extraction.
"""

from datetime import datetime, timedelta

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
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

    set_rls_context(state.input.organization_id, is_internal=True)

    recent_uios = []
    conversation_uios = []

    async with get_db_session() as session:
        # Recent UIOs (last 90 days, top 10)
        cutoff = datetime.utcnow() - timedelta(days=90)
        result = await session.execute(
            text(
                """
                SELECT id, type, status, canonical_title, canonical_description, last_updated_at
                FROM unified_intelligence_object
                WHERE organization_id = :org_id
                  AND last_updated_at >= :cutoff
                ORDER BY last_updated_at DESC
                LIMIT 10
                """
            ),
            {"org_id": state.input.organization_id, "cutoff": cutoff},
        )
        for row in result.fetchall():
            recent_uios.append(
                {
                    "id": row.id,
                    "type": row.type,
                    "status": row.status,
                    "title": row.canonical_title,
                    "description": row.canonical_description,
                    "last_updated_at": row.last_updated_at.isoformat() if row.last_updated_at else None,
                }
            )

        # Conversation-linked UIOs if conversation_id is present
        if state.input.conversation_id:
            result = await session.execute(
                text(
                    """
                    SELECT u.id, u.type, u.status, u.canonical_title, u.canonical_description, u.last_updated_at
                    FROM unified_intelligence_object u
                    JOIN unified_object_source s ON s.unified_object_id = u.id
                    WHERE u.organization_id = :org_id
                      AND s.conversation_id = :conversation_id
                    ORDER BY u.last_updated_at DESC
                    LIMIT 10
                    """
                ),
                {
                    "org_id": state.input.organization_id,
                    "conversation_id": state.input.conversation_id,
                },
            )
            for row in result.fetchall():
                conversation_uios.append(
                    {
                        "id": row.id,
                        "type": row.type,
                        "status": row.status,
                        "title": row.canonical_title,
                        "description": row.canonical_description,
                        "last_updated_at": row.last_updated_at.isoformat() if row.last_updated_at else None,
                    }
                )

    set_rls_context(None, is_internal=False)

    memory_context = {
        "recent_uios": recent_uios,
        "conversation_uios": conversation_uios,
    }

    return {"memory_context": memory_context}
