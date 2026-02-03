"""
Hybrid Search Engine

Combines vector (semantic), fulltext (keyword), CONTAINS (substring),
and graph (relationship) search using Reciprocal Rank Fusion (RRF).

This provides state-of-the-art search capabilities by leveraging:
- Vector search for semantic similarity
- Fulltext search for exact keyword matches
- CONTAINS search for robust substring matching
- Graph traversal for relationship context
"""

import asyncio

import structlog

from src.config import get_settings
from src.graph.client import get_graph_client
from src.search.embeddings import EmbeddingError, generate_embedding

logger = structlog.get_logger()

# Default node types to search across
DEFAULT_SEARCH_TYPES = [
    "Commitment", "Decision", "Episode", "Entity", "Contact", "Risk", "Task",
]


class HybridSearch:
    """
    Hybrid Search Engine combining vector, fulltext, CONTAINS, and graph search.

    Uses Reciprocal Rank Fusion (RRF) to combine results from multiple
    search strategies into a single ranked list.
    """

    def __init__(self):
        self._graph = None
        settings = get_settings()
        self._rrf_k = settings.hybrid_rrf_k
        self._rrf_weights = {
            "vector": settings.hybrid_weight_vector,
            "fulltext": settings.hybrid_weight_fulltext,
            "contains": settings.hybrid_weight_contains,
        }

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

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
        Perform hybrid search combining vector, fulltext, and CONTAINS.

        Runs all three strategies in parallel with graceful degradation —
        if vector search fails (no embeddings), fulltext + CONTAINS still work.
        """
        logger.info(
            "Performing hybrid search",
            organization_id=organization_id,
            query=query[:50],
            types=types,
        )

        # Run all three search strategies in parallel
        results = await asyncio.gather(
            self.vector_search(query, organization_id, types, limit * 2),
            self.fulltext_search(query, organization_id, types, limit * 2),
            self.contains_search(query, organization_id, types, limit * 2),
            return_exceptions=True,
        )

        vector_results = results[0] if not isinstance(results[0], Exception) else []
        fulltext_results = results[1] if not isinstance(results[1], Exception) else []
        contains_results = results[2] if not isinstance(results[2], Exception) else []

        if isinstance(results[0], Exception):
            logger.warning("Vector search failed in hybrid", error=str(results[0]))
        if isinstance(results[1], Exception):
            logger.warning("Fulltext search failed in hybrid", error=str(results[1]))
        if isinstance(results[2], Exception):
            logger.warning("CONTAINS search failed in hybrid", error=str(results[2]))

        # Combine using multi-list RRF
        combined = self._reciprocal_rank_fusion_multi(
            [vector_results, fulltext_results, contains_results],
            ["vector", "fulltext", "contains"],
            limit,
            k=self._rrf_k,
            weights=self._rrf_weights,
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

        Gracefully returns empty results if embedding generation fails.
        """
        graph = await self._get_graph()

        # Generate embedding — graceful failure
        try:
            embedding = await generate_embedding(query)
        except (EmbeddingError, Exception) as e:
            logger.warning("Embedding generation failed, skipping vector search", error=str(e))
            return []

        results = []
        search_types = types or DEFAULT_SEARCH_TYPES

        for node_type in search_types:
            try:
                type_results = await graph.vector_search(
                    label=node_type,
                    embedding=embedding,
                    organization_id=organization_id,
                    k=limit,
                )
                results.extend(self._parse_search_results(type_results, node_type, "vector"))
            except Exception as e:
                logger.warning(f"Vector search failed for type {node_type}", error=str(e))

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    async def fulltext_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Perform fulltext search for keyword matching."""
        graph = await self._get_graph()
        results = []
        search_types = types or DEFAULT_SEARCH_TYPES

        for node_type in search_types:
            try:
                type_results = await graph.fulltext_search(
                    label=node_type,
                    query_text=query,
                    organization_id=organization_id,
                    limit=limit,
                )
                results.extend(self._parse_search_results(type_results, node_type, "fulltext"))
            except Exception as e:
                logger.warning(f"Fulltext search failed for type {node_type}", error=str(e))

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    async def contains_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Perform CONTAINS-based substring search as a robust fallback."""
        graph = await self._get_graph()
        results = []
        search_types = types or DEFAULT_SEARCH_TYPES

        for node_type in search_types:
            try:
                type_results = await graph.contains_search(
                    label=node_type,
                    query_text=query,
                    organization_id=organization_id,
                    limit=limit,
                )
                results.extend(self._parse_search_results(type_results, node_type, "contains"))
            except Exception as e:
                logger.warning(f"CONTAINS search failed for type {node_type}", error=str(e))

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
        """
        initial_results = await self.search(
            query=query,
            organization_id=organization_id,
            types=types,
            limit=limit // 2,
        )

        expanded_results = await self._expand_with_graph_context(
            initial_results,
            organization_id,
            depth=depth,
        )

        return expanded_results[:limit]

    # =========================================================================
    # Result Parsing
    # =========================================================================

    @staticmethod
    def _parse_search_results(
        type_results: list[dict],
        node_type: str,
        source: str,
    ) -> list[dict]:
        """Parse raw graph results into standardized search result dicts."""
        results = []
        for result in type_results:
            # Graph returns {"node": {props}, "score": float}
            node = result.get("node", result)
            if isinstance(node, dict):
                node_id = node.get("id", result.get("id"))
                properties = node
            else:
                node_id = result.get("id")
                properties = result.get("properties", {})

            if not node_id:
                continue

            title = None
            if isinstance(node, dict):
                title = node.get("title") or node.get("name") or node.get("displayName")

            results.append({
                "id": node_id,
                "type": node_type.lower(),
                "title": title,
                "properties": properties,
                "score": result.get("score", 0),
                "scores": {source: result.get("score", 0)},
                "match_source": source,
            })
        return results

    # =========================================================================
    # Fusion and Scoring
    # =========================================================================

    def _reciprocal_rank_fusion(
        self,
        vector_results: list[dict],
        fulltext_results: list[dict],
        limit: int,
        k: int = 60,
    ) -> list[dict]:
        """Legacy 2-list RRF — delegates to multi-list version."""
        return self._reciprocal_rank_fusion_multi(
            [vector_results, fulltext_results],
            ["vector", "fulltext"],
            limit,
            k=k,
        )

    def _reciprocal_rank_fusion_multi(
        self,
        result_lists: list[list[dict]],
        list_names: list[str],
        limit: int,
        k: int = 60,
        weights: dict[str, float] | None = None,
    ) -> list[dict]:
        """
        Combine results from N ranked lists using Reciprocal Rank Fusion.

        RRF score = sum(1 / (k + rank_i)) for each result list.
        """
        results_map: dict[str, dict] = {}

        for list_idx, result_list in enumerate(result_lists):
            list_name = list_names[list_idx] if list_idx < len(list_names) else f"list_{list_idx}"
            weight = 1.0
            if weights:
                weight = weights.get(list_name, 1.0)
            for rank, result in enumerate(result_list):
                result_id = result.get("id")
                if not result_id:
                    continue

                if result_id not in results_map:
                    results_map[result_id] = {
                        **result,
                        "rrf_score": 0,
                        "scores": {},
                    }

                results_map[result_id]["rrf_score"] += weight / (k + rank + 1)
                results_map[result_id]["scores"][list_name] = result.get("score", 0)

        # Determine match source
        for result in results_map.values():
            scores = result.get("scores", {})
            matched_sources = [name for name in list_names if name in scores]
            if len(matched_sources) > 1:
                result["match_source"] = "both" if set(matched_sources) == {"vector", "fulltext"} else "+".join(matched_sources)
            elif matched_sources:
                result["match_source"] = matched_sources[0]
            else:
                result["match_source"] = "unknown"

            result["score"] = result.pop("rrf_score")

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
                filtered.append(result)
                continue

            if isinstance(created_at, str):
                try:
                    created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                except ValueError:
                    filtered.append(result)
                    continue

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
                connections = await graph.query(
                    """
                    MATCH (n {id: $id, organizationId: $orgId})-[r]-(connected)
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
                logger.warning("Failed to expand graph context", result_id=result_id, error=str(e))
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
