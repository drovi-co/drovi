"""
Cognee-Style Hybrid Search

Extends the base HybridSearch with Cognee-inspired features:
- Multi-hop reasoning across graph relationships
- Insights search mode with entity expansion
- Contextual synthesis with LLM
- Dynamic search strategy selection

This is part of Phase 5 (Agentic Memory) of the FalkorDB enhancement plan.
"""

from datetime import datetime
from typing import Any, Literal

import structlog

from src.config import get_settings
from src.graph.client import get_graph_client
from src.search.embeddings import generate_embedding
from src.search.hybrid import HybridSearch, get_hybrid_search
from src.kernel.time import utc_now_naive

logger = structlog.get_logger()


SearchType = Literal["similarity", "graph", "hybrid", "insights"]


class CogneeHybridSearch:
    """
    Cognee-inspired hybrid search over FalkorDB.

    Extends basic hybrid search with:
    - Multiple search modes (similarity, graph, hybrid, insights)
    - Multi-hop reasoning for complex queries
    - LLM-powered answer synthesis
    - Entity extraction and expansion
    """

    def __init__(self):
        """Initialize Cognee-style hybrid search."""
        self._base_search: HybridSearch | None = None
        self._graph = None
        self._llm_client = None

    async def _get_base_search(self) -> HybridSearch:
        """Get the base hybrid search instance."""
        if self._base_search is None:
            self._base_search = await get_hybrid_search()
        return self._base_search

    async def _get_graph(self):
        """Get graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    async def _get_llm_client(self):
        """Get LLM client for synthesis."""
        if self._llm_client is None:
            settings = get_settings()
            if settings.together_api_key:
                try:
                    from together import Together
                    self._llm_client = Together(api_key=settings.together_api_key)
                except ImportError:
                    logger.warning("together package not installed")
        return self._llm_client

    async def search(
        self,
        query: str,
        organization_id: str,
        search_type: SearchType = "hybrid",
        types: list[str] | None = None,
        limit: int = 20,
        include_synthesis: bool = False,
    ) -> dict[str, Any]:
        """
        Search knowledge graph with multiple strategies.

        Args:
            query: Search query
            organization_id: Organization scope
            search_type: Search strategy to use
                - "similarity": Pure vector/semantic search
                - "graph": Pure graph traversal
                - "hybrid": Combine vector + fulltext (default)
                - "insights": Multi-hop reasoning with synthesis
            types: Node types to search
            limit: Maximum results
            include_synthesis: Include LLM-synthesized answer

        Returns:
            Dict with results, optional synthesis, and metadata
        """
        start_time = utc_now_naive()

        logger.info(
            "Cognee hybrid search",
            query=query[:50],
            search_type=search_type,
            organization_id=organization_id,
        )

        # Execute appropriate search strategy
        if search_type == "similarity":
            results = await self._similarity_search(query, organization_id, types, limit)
        elif search_type == "graph":
            results = await self._graph_search(query, organization_id, types, limit)
        elif search_type == "insights":
            results = await self._insights_search(query, organization_id, types, limit)
        else:  # hybrid (default)
            results = await self._hybrid_search(query, organization_id, types, limit)

        # Optionally synthesize answer
        synthesis = None
        if include_synthesis and results:
            synthesis = await self._synthesize_answer(query, results)

        duration = (utc_now_naive() - start_time).total_seconds()

        return {
            "query": query,
            "search_type": search_type,
            "organization_id": organization_id,
            "results": results,
            "result_count": len(results),
            "synthesis": synthesis,
            "duration_seconds": duration,
            "timestamp": utc_now_naive().isoformat(),
        }

    async def _similarity_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Pure vector/semantic search."""
        base = await self._get_base_search()
        return await base.vector_search(query, organization_id, types, limit)

    async def _graph_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Pure graph traversal search."""
        graph = await self._get_graph()

        # Extract entities from query
        entities = await self._extract_entities(query)

        if not entities:
            # Fall back to pattern matching
            return await self._pattern_graph_search(query, organization_id, types, limit)

        results = []

        for entity in entities:
            # Find nodes matching entity
            entity_results = await graph.query(
                """
                MATCH (n {organizationId: $orgId})
                WHERE n.name CONTAINS $entity
                   OR n.displayName CONTAINS $entity
                   OR n.title CONTAINS $entity
                RETURN n.id as id, labels(n)[0] as type, n as properties
                LIMIT $limit
                """,
                {
                    "orgId": organization_id,
                    "entity": entity,
                    "limit": limit // len(entities),
                },
            )

            for row in entity_results or []:
                results.append({
                    "id": row.get("id"),
                    "type": row.get("type", "").lower(),
                    "properties": dict(row.get("properties", {})) if row.get("properties") else {},
                    "matched_entity": entity,
                    "match_source": "graph",
                })

        return results[:limit]

    async def _pattern_graph_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Graph search using pattern matching."""
        graph = await self._get_graph()

        # Build type filter
        type_filter = ""
        if types:
            type_labels = " OR ".join([f"n:{t}" for t in types])
            type_filter = f"AND ({type_labels})"

        results = await graph.query(
            f"""
            MATCH (n {{organizationId: $orgId}})
            WHERE (n.name CONTAINS $query
               OR n.displayName CONTAINS $query
               OR n.title CONTAINS $query
               OR n.content CONTAINS $query)
            {type_filter}
            RETURN n.id as id, labels(n)[0] as type, n as properties
            ORDER BY n.createdAt DESC
            LIMIT $limit
            """,
            {
                "orgId": organization_id,
                "query": query,
                "limit": limit,
            },
        )

        return [
            {
                "id": row.get("id"),
                "type": row.get("type", "").lower(),
                "properties": dict(row.get("properties", {})) if row.get("properties") else {},
                "match_source": "graph_pattern",
            }
            for row in (results or [])
        ]

    async def _hybrid_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Hybrid search combining vector + fulltext."""
        base = await self._get_base_search()
        return await base.search(
            query=query,
            organization_id=organization_id,
            types=types,
            limit=limit,
        )

    async def _insights_search(
        self,
        query: str,
        organization_id: str,
        types: list[str] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """
        Multi-hop reasoning search.

        1. Extract entities from query
        2. Find directly matching nodes
        3. Expand through relationships (multi-hop)
        4. Collect and rank all relevant information
        """
        graph = await self._get_graph()

        # Step 1: Extract entities
        entities = await self._extract_entities(query)

        # Step 2: Find seed nodes through hybrid search
        seed_results = await self._hybrid_search(query, organization_id, types, limit // 2)
        seed_ids = [r.get("id") for r in seed_results if r.get("id")]

        if not seed_ids:
            # No seeds found, return hybrid results
            return seed_results

        # Step 3: Multi-hop expansion
        expanded_results = await self._multi_hop_expand(
            seed_ids=seed_ids,
            organization_id=organization_id,
            hops=2,
            limit=limit,
        )

        # Step 4: Combine and dedupe
        all_results = seed_results.copy()
        seen_ids = set(seed_ids)

        for result in expanded_results:
            result_id = result.get("id")
            if result_id and result_id not in seen_ids:
                result["match_source"] = "multi_hop"
                all_results.append(result)
                seen_ids.add(result_id)

        return all_results[:limit]

    async def _multi_hop_expand(
        self,
        seed_ids: list[str],
        organization_id: str,
        hops: int = 2,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Expand from seed nodes through multiple relationship hops."""
        graph = await self._get_graph()

        results = await graph.query(
            f"""
            MATCH (seed {{organizationId: $orgId}})-[r*1..{hops}]-(related)
            WHERE seed.id IN $seedIds
            AND related.organizationId = $orgId
            RETURN DISTINCT related.id as id, labels(related)[0] as type,
                   related as properties,
                   length(shortestPath((seed)-[*]-(related))) as distance
            ORDER BY distance ASC
            LIMIT $limit
            """,
            {
                "orgId": organization_id,
                "seedIds": seed_ids,
                "limit": limit,
            },
        )

        return [
            {
                "id": row.get("id"),
                "type": row.get("type", "").lower(),
                "properties": dict(row.get("properties", {})) if row.get("properties") else {},
                "hop_distance": row.get("distance", 1),
            }
            for row in (results or [])
        ]

    async def _extract_entities(self, query: str) -> list[str]:
        """Extract potential entity names from a query."""
        # Simple extraction: capitalize words, proper nouns, etc.
        stop_words = {
            "who", "what", "when", "where", "why", "how", "is", "are",
            "the", "a", "an", "to", "for", "of", "in", "on", "with",
            "our", "my", "their", "about", "tell", "me", "show", "list",
            "find", "get", "give", "can", "you", "please", "most",
            "important", "influential", "recent", "open", "active",
        }

        words = query.split()
        entities = []

        for word in words:
            # Check for capitalized words (potential names)
            if word and word[0].isupper() and word.lower() not in stop_words:
                entities.append(word)

            # Check for quoted strings
            if word.startswith('"') or word.startswith("'"):
                entities.append(word.strip("\"'"))

        # Also try to find multi-word names
        import re
        quoted = re.findall(r'"([^"]+)"|\'([^\']+)\'', query)
        for match in quoted:
            name = match[0] or match[1]
            if name:
                entities.append(name)

        return list(set(entities))

    async def _synthesize_answer(
        self,
        query: str,
        results: list[dict[str, Any]],
    ) -> str | None:
        """Synthesize a natural language answer from results."""
        llm = await self._get_llm_client()
        if not llm:
            return None

        settings = get_settings()

        # Prepare context from results
        context_parts = []
        for i, result in enumerate(results[:10]):  # Limit context
            props = result.get("properties", {})
            context_parts.append(
                f"{i+1}. [{result.get('type', 'unknown')}] "
                f"{props.get('name') or props.get('title') or props.get('displayName', 'Unknown')}: "
                f"{props.get('content', props.get('summary', ''))[:200]}"
            )

        context = "\n".join(context_parts)

        prompt = f"""Based on the following search results, answer the user's question concisely.

Question: {query}

Search Results:
{context}

Provide a direct answer based on the results. If the results don't contain enough information, say so.

Answer:"""

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_balanced,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning("Synthesis failed", error=str(e))
            return None

    async def find_path_between(
        self,
        source_id: str,
        target_id: str,
        organization_id: str,
        max_hops: int = 4,
    ) -> dict[str, Any]:
        """Find the shortest path between two nodes."""
        graph = await self._get_graph()

        result = await graph.query(
            f"""
            MATCH path = shortestPath(
                (source {{id: $sourceId, organizationId: $orgId}})-[*..{max_hops}]-
                (target {{id: $targetId, organizationId: $orgId}})
            )
            RETURN [n IN nodes(path) | {{
                id: n.id,
                type: labels(n)[0],
                name: n.name
            }}] as path_nodes,
            [r IN relationships(path) | type(r)] as path_relationships,
            length(path) as path_length
            """,
            {
                "orgId": organization_id,
                "sourceId": source_id,
                "targetId": target_id,
            },
        )

        if not result:
            return {
                "found": False,
                "source_id": source_id,
                "target_id": target_id,
                "message": f"No path found within {max_hops} hops",
            }

        row = result[0]
        return {
            "found": True,
            "source_id": source_id,
            "target_id": target_id,
            "path_nodes": row.get("path_nodes", []),
            "path_relationships": row.get("path_relationships", []),
            "path_length": row.get("path_length", 0),
        }

    async def get_related_context(
        self,
        node_id: str,
        organization_id: str,
        relationship_types: list[str] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Get all related context for a node."""
        graph = await self._get_graph()

        rel_filter = ""
        if relationship_types:
            rel_types = "|".join(relationship_types)
            rel_filter = f":{rel_types}"

        result = await graph.query(
            f"""
            MATCH (n {{id: $nodeId, organizationId: $orgId}})-[r{rel_filter}]-(related)
            WHERE related.organizationId = $orgId
            RETURN type(r) as relationship,
                   labels(related)[0] as type,
                   related.id as id,
                   related.name as name,
                   related.title as title,
                   related.displayName as display_name,
                   related.content as content
            LIMIT $limit
            """,
            {
                "orgId": organization_id,
                "nodeId": node_id,
                "limit": limit,
            },
        )

        # Group by relationship type
        grouped: dict[str, list] = {}
        for row in result or []:
            rel_type = row.get("relationship", "UNKNOWN")
            if rel_type not in grouped:
                grouped[rel_type] = []
            grouped[rel_type].append({
                "id": row.get("id"),
                "type": row.get("type"),
                "name": row.get("name") or row.get("title") or row.get("display_name"),
                "content_preview": (row.get("content") or "")[:200],
            })

        return {
            "node_id": node_id,
            "organization_id": organization_id,
            "related_by_type": grouped,
            "total_related": sum(len(v) for v in grouped.values()),
        }


# =============================================================================
# Factory Functions
# =============================================================================

_cognee_search: CogneeHybridSearch | None = None


async def get_cognee_search() -> CogneeHybridSearch:
    """Get singleton CogneeHybridSearch instance."""
    global _cognee_search
    if _cognee_search is None:
        _cognee_search = CogneeHybridSearch()
    return _cognee_search
