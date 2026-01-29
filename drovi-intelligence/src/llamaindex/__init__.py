"""
LlamaIndex Knowledge Graph Integration

Provides LlamaIndex-based knowledge graph capabilities:
- Document ingestion with automatic knowledge extraction
- Hybrid query engine (text + graph)
- Knowledge graph index over FalkorDB

This is part of Phase 7 of the FalkorDB enhancement plan.
"""

from src.llamaindex.knowledge_graph import (
    DroviLlamaIndex,
    get_llamaindex,
)

__all__ = [
    "DroviLlamaIndex",
    "get_llamaindex",
]
