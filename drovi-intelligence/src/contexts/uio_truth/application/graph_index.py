"""Derived graph indexing helpers (FalkorDB).

Phase 6 will move all graph writes behind an outbox/worker. For now, these
helpers isolate the raw graph queries so the LangGraph node stays thin.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.contexts.uio_truth.application.persist_utils import temporal_relationship_props
from src.graph.types import GraphNodeType, GraphRelationshipType
from src.kernel.time import utc_now_naive as utc_now
from src.search.embeddings import EmbeddingError, generate_embedding

logger = structlog.get_logger()


def resolve_session_node_type(source_type: str | None) -> GraphNodeType | None:
    if source_type == "meeting":
        return GraphNodeType.MEETING_SESSION
    if source_type == "call":
        return GraphNodeType.CALL_SESSION
    if source_type == "recording":
        return GraphNodeType.RECORDING
    return None


async def link_uio_to_session(
    graph: Any,
    *,
    organization_id: str,
    source_type: str | None,
    source_id: str | None,
    conversation_id: str | None,
    uio_label: str,
    uio_id: str,
) -> None:
    session_id = source_id or conversation_id
    session_node = resolve_session_node_type(source_type)
    if not session_id or not session_node:
        return

    rel = temporal_relationship_props(utc_now())
    await graph.query(
        f"""
        MATCH (u:{uio_label} {{id: $uioId, organizationId: $orgId}})
        MATCH (s:{session_node.value} {{id: $sessionId}})
        MERGE (u)-[r:{GraphRelationshipType.EXTRACTED_FROM.value}]->(s)
        ON CREATE SET r.validFrom = $validFrom,
                      r.validTo = $validTo,
                      r.systemFrom = $systemFrom,
                      r.systemTo = $systemTo,
                      r.createdAt = $createdAt,
                      r.updatedAt = $updatedAt
        """,
        {
            "uioId": uio_id,
            "orgId": organization_id,
            "sessionId": session_id,
            **rel,
        },
    )


async def set_graph_embedding(
    graph: Any,
    *,
    organization_id: str,
    node_label: str,
    node_id: str,
    text: str,
) -> None:
    if not text or not text.strip():
        return
    try:
        embedding = await generate_embedding(text)
    except EmbeddingError:
        return
    try:
        await graph.query(
            f"""
            MATCH (n:{node_label} {{id: $id, organizationId: $orgId}})
            SET n.embedding = vecf32($embedding)
            """,
            {"id": node_id, "orgId": organization_id, "embedding": embedding},
        )
    except Exception as exc:
        logger.warning("Failed to set graph embedding", node_label=node_label, error=str(exc))

