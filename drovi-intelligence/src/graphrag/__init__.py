"""
GraphRAG Integration

Natural language query interface over the Drovi knowledge graph.
Uses GraphRAG-SDK for intelligent query generation and response synthesis.

Features:
- Natural language question answering
- Automatic Cypher query generation
- Source citation with evidence links
- Multi-hop reasoning
- Context-aware responses

Example:
    >>> graphrag = await get_graphrag()
    >>> result = await graphrag.query(
    ...     "Who are the most influential people in our network?",
    ...     organization_id="org-123"
    ... )
    >>> print(result["answer"])
    "Based on PageRank analysis, the most influential contacts are..."
"""

from .query import (
    DroviGraphRAG,
    get_graphrag,
    query_graph,
)

__all__ = [
    "DroviGraphRAG",
    "get_graphrag",
    "query_graph",
]
