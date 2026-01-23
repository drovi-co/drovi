"""FalkorDB graph database module."""

from .client import DroviGraph, get_graph_client, close_graph_client
from .types import (
    GraphNodeType,
    GraphRelationshipType,
    SourceType,
    EpisodeNode,
    EntityNode,
    ContactNode,
    CommitmentNode,
    DecisionNode,
)
from .algorithms import GraphAlgorithms, get_graph_algorithms, AlgorithmResult, CommunityResult
from .schema import GraphSchema, get_graph_schema, setup_graph_schema

__all__ = [
    # Client
    "DroviGraph",
    "get_graph_client",
    "close_graph_client",
    # Types
    "GraphNodeType",
    "GraphRelationshipType",
    "SourceType",
    "EpisodeNode",
    "EntityNode",
    "ContactNode",
    "CommitmentNode",
    "DecisionNode",
    # Algorithms
    "GraphAlgorithms",
    "get_graph_algorithms",
    "AlgorithmResult",
    "CommunityResult",
    # Schema
    "GraphSchema",
    "get_graph_schema",
    "setup_graph_schema",
]
