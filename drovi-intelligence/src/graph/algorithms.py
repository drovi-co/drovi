"""
FalkorDB Graph Algorithms

Provides powerful graph algorithms for intelligence extraction:
- PageRank: Identify influential people/entities
- Betweenness Centrality: Find connector nodes bridging teams
- CDLP (Community Detection): Auto-cluster topics/conversations
- Single Source Shortest Path: Find relationship paths

These algorithms leverage FalkorDB's built-in graph algorithm support.
"""

from dataclasses import dataclass
from typing import Literal

import structlog

from .client import get_graph_client

logger = structlog.get_logger()


@dataclass
class AlgorithmResult:
    """Result from a graph algorithm execution."""

    node_id: str
    node_name: str | None
    node_type: str
    score: float
    metadata: dict | None = None


@dataclass
class CommunityResult:
    """Result from community detection."""

    community_id: int
    nodes: list[str]
    node_names: list[str]
    size: int


class GraphAlgorithms:
    """
    FalkorDB graph algorithms for intelligence extraction.

    Uses FalkorDB's built-in algorithm support for efficient
    large-scale graph analysis.
    """

    def __init__(self):
        self._graph = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    # =========================================================================
    # PageRank - Find Influential Nodes
    # =========================================================================

    async def pagerank(
        self,
        organization_id: str,
        node_label: str = "Contact",
        relationship_types: list[str] | None = None,
        damping_factor: float = 0.85,
        max_iterations: int = 100,
        tolerance: float = 0.0001,
        limit: int = 50,
    ) -> list[AlgorithmResult]:
        """
        Calculate PageRank to identify influential nodes.

        PageRank measures the importance of nodes based on the quantity
        and quality of links to them. Higher scores indicate more
        influential entities.

        Use cases:
        - Find the most influential people in communication
        - Identify key topics or projects
        - Detect central entities in the knowledge graph

        Args:
            organization_id: Organization to analyze
            node_label: Node type to analyze (Contact, Topic, etc.)
            relationship_types: Relationship types to consider
            damping_factor: PageRank damping factor (default 0.85)
            max_iterations: Maximum iterations (default 100)
            tolerance: Convergence tolerance
            limit: Maximum results to return

        Returns:
            List of nodes with PageRank scores, sorted descending
        """
        graph = await self._get_graph()

        rel_types = relationship_types or ["MENTIONS", "SENT", "RECEIVED", "INVOLVES"]
        rel_pattern = "|".join(rel_types)

        logger.info(
            "Calculating PageRank",
            organization_id=organization_id,
            node_label=node_label,
            relationship_types=rel_types,
        )

        try:
            # FalkorDB PageRank query
            # Note: FalkorDB supports the algo.pageRank procedure
            query = f"""
                CALL algo.pageRank({{
                    nodeQuery: 'MATCH (n:{node_label}) WHERE n.organizationId = $orgId RETURN id(n) as id',
                    relationshipQuery: 'MATCH (n:{node_label})-[r:{rel_pattern}]-(m:{node_label}) WHERE n.organizationId = $orgId AND m.organizationId = $orgId RETURN id(n) as source, id(m) as target',
                    dampingFactor: $damping,
                    maxIterations: $maxIter,
                    tolerance: $tolerance
                }})
                YIELD nodeId, score
                MATCH (n) WHERE id(n) = nodeId
                RETURN n.id as id, n.name as name, labels(n)[0] as type, score
                ORDER BY score DESC
                LIMIT $limit
            """

            results = await graph.query(
                query,
                {
                    "orgId": organization_id,
                    "damping": damping_factor,
                    "maxIter": max_iterations,
                    "tolerance": tolerance,
                    "limit": limit,
                },
            )

            return [
                AlgorithmResult(
                    node_id=r.get("id", ""),
                    node_name=r.get("name"),
                    node_type=r.get("type", node_label),
                    score=r.get("score", 0.0),
                )
                for r in results
            ]

        except Exception as e:
            logger.warning(
                "PageRank via algo.pageRank failed, falling back to manual calculation",
                error=str(e),
            )
            # Fallback: Simple degree-based approximation
            return await self._pagerank_fallback(
                organization_id, node_label, rel_pattern, limit
            )

    async def _pagerank_fallback(
        self,
        organization_id: str,
        node_label: str,
        rel_pattern: str,
        limit: int,
    ) -> list[AlgorithmResult]:
        """
        Fallback PageRank using degree centrality.

        When the native algorithm isn't available, we approximate
        PageRank using in-degree (weighted by sender importance).
        """
        graph = await self._get_graph()

        query = f"""
            MATCH (n:{node_label} {{organizationId: $orgId}})
            OPTIONAL MATCH (n)-[r:{rel_pattern}]-(m)
            WHERE m.organizationId = $orgId
            WITH n, count(DISTINCT m) as connections
            RETURN n.id as id, n.name as name, labels(n)[0] as type,
                   toFloat(connections) / 100.0 as score
            ORDER BY connections DESC
            LIMIT $limit
        """

        results = await graph.query(
            query,
            {"orgId": organization_id, "limit": limit},
        )

        return [
            AlgorithmResult(
                node_id=r.get("id", ""),
                node_name=r.get("name"),
                node_type=r.get("type", node_label),
                score=r.get("score", 0.0),
            )
            for r in results
        ]

    # =========================================================================
    # Betweenness Centrality - Find Bridge Nodes
    # =========================================================================

    async def betweenness_centrality(
        self,
        organization_id: str,
        node_label: str = "Contact",
        relationship_types: list[str] | None = None,
        limit: int = 50,
    ) -> list[AlgorithmResult]:
        """
        Calculate betweenness centrality to find connector nodes.

        Betweenness centrality measures how often a node lies on the
        shortest path between other nodes. High scores indicate nodes
        that bridge different groups/teams.

        Use cases:
        - Find people who connect different teams
        - Identify key information brokers
        - Detect critical points in communication flow

        Args:
            organization_id: Organization to analyze
            node_label: Node type to analyze
            relationship_types: Relationship types to consider
            limit: Maximum results to return

        Returns:
            List of nodes with betweenness scores, sorted descending
        """
        graph = await self._get_graph()

        rel_types = relationship_types or ["MENTIONS", "SENT", "RECEIVED", "INVOLVES"]
        rel_pattern = "|".join(rel_types)

        logger.info(
            "Calculating betweenness centrality",
            organization_id=organization_id,
            node_label=node_label,
        )

        try:
            # Try FalkorDB's built-in betweenness centrality
            query = f"""
                CALL algo.betweennessCentrality({{
                    nodeQuery: 'MATCH (n:{node_label}) WHERE n.organizationId = $orgId RETURN id(n) as id',
                    relationshipQuery: 'MATCH (n:{node_label})-[r:{rel_pattern}]-(m:{node_label}) WHERE n.organizationId = $orgId AND m.organizationId = $orgId RETURN id(n) as source, id(m) as target'
                }})
                YIELD nodeId, score
                MATCH (n) WHERE id(n) = nodeId
                RETURN n.id as id, n.name as name, labels(n)[0] as type, score
                ORDER BY score DESC
                LIMIT $limit
            """

            results = await graph.query(
                query,
                {"orgId": organization_id, "limit": limit},
            )

            return [
                AlgorithmResult(
                    node_id=r.get("id", ""),
                    node_name=r.get("name"),
                    node_type=r.get("type", node_label),
                    score=r.get("score", 0.0),
                )
                for r in results
            ]

        except Exception as e:
            logger.warning(
                "Betweenness centrality via algo failed, using fallback",
                error=str(e),
            )
            return await self._betweenness_fallback(
                organization_id, node_label, rel_pattern, limit
            )

    async def _betweenness_fallback(
        self,
        organization_id: str,
        node_label: str,
        rel_pattern: str,
        limit: int,
    ) -> list[AlgorithmResult]:
        """
        Fallback betweenness using connection diversity.

        Approximates betweenness by counting unique connection groups.
        """
        graph = await self._get_graph()

        query = f"""
            MATCH (n:{node_label} {{organizationId: $orgId}})
            OPTIONAL MATCH (n)-[r:{rel_pattern}]-(m:{node_label})
            WHERE m.organizationId = $orgId
            WITH n, collect(DISTINCT m.email) as connections,
                 count(DISTINCT m) as conn_count
            RETURN n.id as id, n.name as name, labels(n)[0] as type,
                   toFloat(conn_count) / 50.0 as score
            ORDER BY conn_count DESC
            LIMIT $limit
        """

        results = await graph.query(
            query,
            {"orgId": organization_id, "limit": limit},
        )

        return [
            AlgorithmResult(
                node_id=r.get("id", ""),
                node_name=r.get("name"),
                node_type=r.get("type", node_label),
                score=r.get("score", 0.0),
            )
            for r in results
        ]

    # =========================================================================
    # Community Detection (CDLP)
    # =========================================================================

    async def community_detection(
        self,
        organization_id: str,
        node_label: str = "Topic",
        relationship_types: list[str] | None = None,
        max_iterations: int = 10,
    ) -> list[CommunityResult]:
        """
        Detect communities using Label Propagation Algorithm (CDLP).

        Groups related nodes into communities based on their connections.
        Useful for automatically clustering topics, conversations, or
        contacts into logical groups.

        Use cases:
        - Group related conversations into topics
        - Cluster contacts by team/project
        - Identify conversation threads

        Args:
            organization_id: Organization to analyze
            node_label: Node type to cluster
            relationship_types: Relationship types to consider
            max_iterations: Maximum LPA iterations

        Returns:
            List of communities with their member nodes
        """
        graph = await self._get_graph()

        rel_types = relationship_types or ["RELATED_TO", "MENTIONS", "INVOLVES"]
        rel_pattern = "|".join(rel_types)

        logger.info(
            "Detecting communities",
            organization_id=organization_id,
            node_label=node_label,
        )

        try:
            # Try FalkorDB's Label Propagation Community Detection
            query = f"""
                CALL algo.labelPropagation({{
                    nodeQuery: 'MATCH (n:{node_label}) WHERE n.organizationId = $orgId RETURN id(n) as id',
                    relationshipQuery: 'MATCH (n:{node_label})-[r:{rel_pattern}]-(m:{node_label}) WHERE n.organizationId = $orgId AND m.organizationId = $orgId RETURN id(n) as source, id(m) as target',
                    maxIterations: $maxIter
                }})
                YIELD nodeId, communityId
                MATCH (n) WHERE id(n) = nodeId
                RETURN communityId, collect(n.id) as nodeIds, collect(n.name) as nodeNames
                ORDER BY size(nodeIds) DESC
            """

            results = await graph.query(
                query,
                {"orgId": organization_id, "maxIter": max_iterations},
            )

            return [
                CommunityResult(
                    community_id=r.get("communityId", 0),
                    nodes=r.get("nodeIds", []),
                    node_names=r.get("nodeNames", []),
                    size=len(r.get("nodeIds", [])),
                )
                for r in results
            ]

        except Exception as e:
            logger.warning(
                "Community detection via algo failed, using fallback",
                error=str(e),
            )
            return await self._community_fallback(
                organization_id, node_label, rel_pattern
            )

    async def _community_fallback(
        self,
        organization_id: str,
        node_label: str,
        rel_pattern: str,
    ) -> list[CommunityResult]:
        """
        Fallback community detection using connected components.
        """
        graph = await self._get_graph()

        # Find connected components as a simple community approximation
        query = f"""
            MATCH (n:{node_label} {{organizationId: $orgId}})
            OPTIONAL MATCH path = (n)-[:{rel_pattern}*1..2]-(connected:{node_label})
            WHERE connected.organizationId = $orgId
            WITH n, collect(DISTINCT connected.id) + [n.id] as community_nodes,
                 collect(DISTINCT connected.name) + [n.name] as community_names
            WITH community_nodes, community_names
            WHERE size(community_nodes) > 1
            RETURN community_nodes as nodeIds, community_names as nodeNames
            LIMIT 20
        """

        results = await graph.query(query, {"orgId": organization_id})

        communities = []
        seen_nodes = set()

        for i, r in enumerate(results):
            nodes = r.get("nodeIds", [])
            # Skip if we've already seen these nodes
            new_nodes = [n for n in nodes if n not in seen_nodes]
            if new_nodes:
                seen_nodes.update(new_nodes)
                communities.append(
                    CommunityResult(
                        community_id=i,
                        nodes=nodes,
                        node_names=r.get("nodeNames", []),
                        size=len(nodes),
                    )
                )

        return communities

    # =========================================================================
    # Shortest Path - Find Relationship Paths
    # =========================================================================

    async def shortest_path(
        self,
        organization_id: str,
        source_id: str,
        target_id: str,
        max_depth: int = 5,
    ) -> list[dict] | None:
        """
        Find the shortest path between two nodes.

        Args:
            organization_id: Organization ID
            source_id: Starting node ID
            target_id: Destination node ID
            max_depth: Maximum path length

        Returns:
            Path as list of nodes and relationships, or None if no path
        """
        graph = await self._get_graph()

        logger.info(
            "Finding shortest path",
            organization_id=organization_id,
            source_id=source_id,
            target_id=target_id,
        )

        query = f"""
            MATCH (source {{id: $sourceId, organizationId: $orgId}})
            MATCH (target {{id: $targetId, organizationId: $orgId}})
            MATCH path = shortestPath((source)-[*1..{max_depth}]-(target))
            UNWIND nodes(path) as n
            UNWIND relationships(path) as r
            RETURN collect(DISTINCT {{id: n.id, name: n.name, type: labels(n)[0]}}) as nodes,
                   collect(DISTINCT {{type: type(r), source: startNode(r).id, target: endNode(r).id}}) as relationships
        """

        results = await graph.query(
            query,
            {"sourceId": source_id, "targetId": target_id, "orgId": organization_id},
        )

        if results:
            return {
                "nodes": results[0].get("nodes", []),
                "relationships": results[0].get("relationships", []),
            }
        return None

    # =========================================================================
    # Influence Analysis - Combined Metrics
    # =========================================================================

    async def analyze_influence(
        self,
        organization_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """
        Comprehensive influence analysis combining multiple metrics.

        Combines PageRank, betweenness, and degree centrality into
        a single influence score for contacts.

        Args:
            organization_id: Organization to analyze
            limit: Maximum results

        Returns:
            List of contacts with combined influence metrics
        """
        logger.info(
            "Analyzing influence",
            organization_id=organization_id,
        )

        # Get all metrics in parallel (sort of)
        pagerank_results = await self.pagerank(organization_id, limit=limit * 2)
        betweenness_results = await self.betweenness_centrality(organization_id, limit=limit * 2)

        # Build combined scores
        scores = {}

        for pr in pagerank_results:
            if pr.node_id not in scores:
                scores[pr.node_id] = {
                    "id": pr.node_id,
                    "name": pr.node_name,
                    "type": pr.node_type,
                    "pagerank": 0,
                    "betweenness": 0,
                }
            scores[pr.node_id]["pagerank"] = pr.score

        for bc in betweenness_results:
            if bc.node_id not in scores:
                scores[bc.node_id] = {
                    "id": bc.node_id,
                    "name": bc.node_name,
                    "type": bc.node_type,
                    "pagerank": 0,
                    "betweenness": 0,
                }
            scores[bc.node_id]["betweenness"] = bc.score

        # Calculate combined influence score
        # Weighted average: 60% PageRank, 40% Betweenness
        for node_id, data in scores.items():
            data["influence_score"] = (
                0.6 * data["pagerank"] + 0.4 * data["betweenness"]
            )

        # Sort by influence score
        sorted_results = sorted(
            scores.values(),
            key=lambda x: x["influence_score"],
            reverse=True,
        )

        return sorted_results[:limit]


# =============================================================================
# Singleton
# =============================================================================

_graph_algorithms: GraphAlgorithms | None = None


async def get_graph_algorithms() -> GraphAlgorithms:
    """Get the singleton GraphAlgorithms instance."""
    global _graph_algorithms
    if _graph_algorithms is None:
        _graph_algorithms = GraphAlgorithms()
    return _graph_algorithms
