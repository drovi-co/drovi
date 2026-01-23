"""
Hybrid Search Engine

Combines vector (semantic), fulltext (keyword), and graph (relationship) search
using Reciprocal Rank Fusion (RRF) for result combination.

This provides state-of-the-art search capabilities by leveraging:
- Vector search for semantic similarity
- Fulltext search for exact keyword matches
- Graph traversal for relationship context
"""

import asyncio
from typing import Literal

import structlog

from src.graph.client import get_graph_client
from src.search.embeddings import EmbeddingError, generate_embedding

logger = structlog.get_logger()


class HybridSearch:
    """
    Hybrid Search Engine combining vector, fulltext, and graph search.

    Uses Reciprocal Rank Fusion (RRF) to combine results from multiple
    search strategies into a single ranked list.
    """

    def __init__(self):
        self._graph = None
        self._embedding_model = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    async def _generate_embedding(self, text: str) -> list[float]:
        """Generate embedding for text using the EmbeddingService."""
        try:
            return await generate_embedding(text)
        except EmbeddingError as e:
            logger.error("Embedding generation failed", error=str(e))
            raise  # Don't silently fail - propagate the error

    # =========================================================================
    # Core Search Methods
    # =========================================================================

    async def search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None = None,
        source_types: list[str] | None = None,
        time_range: dict | None = None,
        include_graph_context: bool = False,
        limit: int = 20,
    ) -> list[dict]:
        """
        Perform hybrid search combining vector and fulltext.

        Args:
            query: Search query
            organization_id: Organization to search within
            types: Node types to search (commitment, decision, etc.)
            source_types: Filter by source types
            time_range: Optional time range filter {from, to}
            include_graph_context: Include connected nodes in results
            limit: Maximum results to return

        Returns:
            List of search results with combined scores
        """
        logger.info(
            "Performing hybrid search",
            organization_id=organization_id,
            query=query[:50],
            types=types,
        )

        # Run vector and fulltext searches in parallel
        vector_task = self.vector_search(query, organization_id, types, limit * 2)
        fulltext_task = self.fulltext_search(query, organization_id, types, limit * 2)

        vector_results, fulltext_results = await asyncio.gather(
            vector_task,
            fulltext_task,
        )

        # Combine using RRF
        combined = self._reciprocal_rank_fusion(
            vector_results,
            fulltext_results,
            limit,
        )

        # Apply additional filters
        if source_types:
            combined = [
                r for r in combined
                if r.get("properties", {}).get("sourceType") in source_types
            ]

        if time_range:
            combined = self._filter_by_time_range(combined, time_range)

        # Optionally expand with graph context
        if include_graph_context:
            combined = await self._expand_with_graph_context(
                combined,
                organization_id,
            )

        return combined[:limit]

    async def vector_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """
        Perform vector-only search for semantic similarity.

        Args:
            query: Search query
            organization_id: Organization to search within
            types: Node types to search
            limit: Maximum results

        Returns:
            List of results with vector similarity scores
        """
        graph = await self._get_graph()

        # Generate embedding for query
        embedding = await self._generate_embedding(query)

        results = []

        # Search each type
        search_types = types or ["Commitment", "Decision", "Episode", "Entity", "Contact"]

        for node_type in search_types:
            try:
                type_results = await graph.vector_search(
                    label=node_type,
                    embedding=embedding,
                    organization_id=organization_id,
                    k=limit,
                )

                for result in type_results:
                    results.append({
                        "id": result.get("id"),
                        "type": node_type.lower(),
                        "properties": result.get("properties", {}),
                        "score": result.get("score", 0),
                        "scores": {"vector": result.get("score", 0)},
                        "match_source": "vector",
                    })

            except Exception as e:
                logger.warning(
                    f"Vector search failed for type {node_type}",
                    error=str(e),
                )

        # Sort by score
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]

    async def fulltext_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """
        Perform fulltext search for keyword matching.

        Args:
            query: Search query
            organization_id: Organization to search within
            types: Node types to search
            limit: Maximum results

        Returns:
            List of results with fulltext match scores
        """
        graph = await self._get_graph()

        results = []

        # Search each type
        search_types = types or ["Commitment", "Decision", "Episode", "Entity", "Contact"]

        for node_type in search_types:
            try:
                type_results = await graph.fulltext_search(
                    label=node_type,
                    query_text=query,
                    organization_id=organization_id,
                    limit=limit,
                )

                for result in type_results:
                    results.append({
                        "id": result.get("id"),
                        "type": node_type.lower(),
                        "properties": result.get("properties", {}),
                        "score": result.get("score", 0),
                        "scores": {"fulltext": result.get("score", 0)},
                        "match_source": "fulltext",
                    })

            except Exception as e:
                logger.warning(
                    f"Fulltext search failed for type {node_type}",
                    error=str(e),
                )

        # Sort by score
        results.sort(key=lambda x: x["score"], reverse=True)

        return results[:limit]

    async def graph_aware_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None = None,
        depth: int = 1,
        limit: int = 20,
    ) -> list[dict]:
        """
        Perform search with graph context expansion.

        Finds matching nodes and expands to connected nodes.

        Args:
            query: Search query
            organization_id: Organization to search within
            types: Node types to search
            depth: How many hops to expand
            limit: Maximum results

        Returns:
            List of results with connection information
        """
        # First, do hybrid search
        initial_results = await self.search(
            query=query,
            organization_id=organization_id,
            types=types,
            limit=limit // 2,  # Leave room for expanded results
        )

        # Expand each result with graph context
        expanded_results = await self._expand_with_graph_context(
            initial_results,
            organization_id,
            depth=depth,
        )

        return expanded_results[:limit]

    # =========================================================================
    # Fusion and Scoring
    # =========================================================================

    def _reciprocal_rank_fusion(
        self,
        vector_results: list[dict],
        fulltext_results: list[dict],
        limit: int,
        k: int = 60,  # RRF constant
    ) -> list[dict]:
        """
        Combine results using Reciprocal Rank Fusion.

        RRF score = sum(1 / (k + rank_i)) for each result list

        This is a proven technique for combining ranked lists that:
        - Doesn't require score normalization
        - Handles missing results gracefully
        - Produces robust rankings
        """
        # Build ID to result mapping
        results_map: dict[str, dict] = {}

        # Process vector results
        for rank, result in enumerate(vector_results):
            result_id = result.get("id")
            if not result_id:
                continue

            if result_id not in results_map:
                results_map[result_id] = {
                    **result,
                    "rrf_score": 0,
                    "scores": {},
                }

            results_map[result_id]["rrf_score"] += 1 / (k + rank + 1)
            results_map[result_id]["scores"]["vector"] = result.get("score", 0)

        # Process fulltext results
        for rank, result in enumerate(fulltext_results):
            result_id = result.get("id")
            if not result_id:
                continue

            if result_id not in results_map:
                results_map[result_id] = {
                    **result,
                    "rrf_score": 0,
                    "scores": {},
                }

            results_map[result_id]["rrf_score"] += 1 / (k + rank + 1)
            results_map[result_id]["scores"]["fulltext"] = result.get("score", 0)

        # Determine match source
        for result in results_map.values():
            scores = result.get("scores", {})
            if "vector" in scores and "fulltext" in scores:
                result["match_source"] = "both"
            elif "vector" in scores:
                result["match_source"] = "vector"
            else:
                result["match_source"] = "fulltext"

            # Use RRF score as the main score
            result["score"] = result.pop("rrf_score")

        # Sort by RRF score
        combined = list(results_map.values())
        combined.sort(key=lambda x: x["score"], reverse=True)

        return combined[:limit]

    def _filter_by_time_range(
        self,
        results: list[dict],
        time_range: dict,
    ) -> list[dict]:
        """Filter results by time range."""
        from datetime import datetime

        filtered = []

        from_date = time_range.get("from")
        to_date = time_range.get("to")

        for result in results:
            props = result.get("properties", {})
            created_at = props.get("createdAt") or props.get("referenceTime")

            if not created_at:
                # Include results without dates
                filtered.append(result)
                continue

            # Parse date if string
            if isinstance(created_at, str):
                try:
                    created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                except ValueError:
                    filtered.append(result)
                    continue

            # Check range
            if from_date and isinstance(from_date, str):
                from_date = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            if to_date and isinstance(to_date, str):
                to_date = datetime.fromisoformat(to_date.replace("Z", "+00:00"))

            if from_date and created_at < from_date:
                continue
            if to_date and created_at > to_date:
                continue

            filtered.append(result)

        return filtered

    async def _expand_with_graph_context(
        self,
        results: list[dict],
        organization_id: str,
        depth: int = 1,
    ) -> list[dict]:
        """Expand results with connected nodes from the graph."""
        graph = await self._get_graph()

        for result in results:
            result_id = result.get("id")
            if not result_id:
                continue

            try:
                # Get connected nodes
                connections = await graph.query(
                    f"""
                    MATCH (n {{id: $id, organizationId: $orgId}})-[r]-(connected)
                    WHERE connected.organizationId = $orgId
                    RETURN type(r) as relationship, labels(connected)[0] as type, connected.id as id, connected.name as name
                    LIMIT 10
                    """,
                    {"id": result_id, "orgId": organization_id},
                )

                result["connections"] = [
                    {
                        "relationship": conn.get("relationship"),
                        "type": conn.get("type"),
                        "id": conn.get("id"),
                        "name": conn.get("name"),
                    }
                    for conn in connections
                ]

            except Exception as e:
                logger.warning(
                    "Failed to expand graph context",
                    result_id=result_id,
                    error=str(e),
                )
                result["connections"] = []

        return results


# =============================================================================
# Singleton
# =============================================================================

_hybrid_search: HybridSearch | None = None


async def get_hybrid_search() -> HybridSearch:
    """Get the singleton HybridSearch instance."""
    global _hybrid_search
    if _hybrid_search is None:
        _hybrid_search = HybridSearch()
    return _hybrid_search
