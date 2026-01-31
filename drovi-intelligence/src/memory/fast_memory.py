"""
Fast Memory Retrieval Service

Implements tiered retrieval for sub-400ms response times:
- Tier 1 (< 50ms): Redis cache (pre-computed summaries)
- Tier 2 (< 100ms): FalkorDB HNSW vector search
- Tier 3 (< 300ms): Full hybrid search with graph expansion

From Supermemory research:
- Memory is in the hot path. Agentic discovery is too slow.
- Always returns UserProfile as default context (the "RAM layer")
"""

import time
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class RetrievalTier(str, Enum):
    """Retrieval tier based on latency budget."""

    CACHE = "cache"  # < 50ms - Redis cache
    VECTOR = "vector"  # < 100ms - HNSW vector search
    HYBRID = "hybrid"  # < 300ms - Full hybrid search


class UserContext(BaseModel):
    """
    User's context - the 'RAM layer' always included in context.

    From Supermemory research: This provides default context that should
    ALWAYS be available to the AI, not just retrieved on demand.
    """

    user_id: str
    organization_id: str

    # Static context
    name: str | None = None
    role: str | None = None
    timezone: str | None = None
    priorities: list[str] = Field(default_factory=list)
    vip_contact_emails: list[str] = Field(default_factory=list)

    # Dynamic context (refreshed frequently)
    current_focus: list[str] = Field(default_factory=list)
    recent_topics: list[str] = Field(default_factory=list)
    active_projects: list[str] = Field(default_factory=list)

    # Summary counts
    unread_commitments_count: int = 0
    overdue_commitments_count: int = 0
    pending_decisions_count: int = 0

    # Metadata
    last_refreshed_at: datetime | None = None


class EntitySummary(BaseModel):
    """Cached entity summary for fast lookup."""

    entity_id: str
    entity_type: str
    name: str
    summary: str | None = None

    # Key relationships
    related_contacts: list[str] = Field(default_factory=list)
    related_topics: list[str] = Field(default_factory=list)

    # Metrics
    relevance_score: float = 1.0
    importance_score: float = 0.0


class MemorySearchResult(BaseModel):
    """Result from memory search."""

    # Source information
    source_tier: RetrievalTier
    latency_ms: float

    # User context (always included)
    user_context: UserContext | None = None

    # Retrieved items
    entities: list[EntitySummary] = Field(default_factory=list)
    episodes: list[dict[str, Any]] = Field(default_factory=list)
    commitments: list[dict[str, Any]] = Field(default_factory=list)
    decisions: list[dict[str, Any]] = Field(default_factory=list)

    # Metadata
    total_results: int = 0
    was_truncated: bool = False


class FastMemoryRetrieval:
    """
    Tiered memory retrieval service optimized for speed.

    Uses FalkorDB's underlying Redis for hot memory caching
    (separate keyspace from graph data).
    """

    CACHE_KEY_PREFIX = "drovi:cache:"
    DEFAULT_LATENCY_BUDGET_MS = 400
    CACHE_TTL_SECONDS = 900  # 15 minutes

    def __init__(self, graph_client=None, redis_client=None):
        """
        Initialize fast memory retrieval.

        Args:
            graph_client: FalkorDB graph client
            redis_client: Redis client for caching (can be FalkorDB's underlying Redis)
        """
        self._graph = graph_client
        self._redis = redis_client

    async def _ensure_clients(self):
        """Lazy-load clients if not provided."""
        if self._graph is None:
            from ..graph.client import get_graph_client

            self._graph = await get_graph_client()

    async def search(
        self,
        query: str,
        organization_id: str,
        user_id: str | None = None,
        latency_budget_ms: float = DEFAULT_LATENCY_BUDGET_MS,
        include_user_context: bool = True,
        max_results: int = 10,
    ) -> MemorySearchResult:
        """
        Search memory with tiered retrieval based on latency budget.

        Args:
            query: Search query (text or semantic)
            organization_id: Organization context
            user_id: Optional user ID for personalization
            latency_budget_ms: Maximum allowed latency
            include_user_context: Whether to include user's RAM layer
            max_results: Maximum number of results

        Returns:
            MemorySearchResult with retrieved items and metadata
        """
        start_time = time.time()
        await self._ensure_clients()

        result = MemorySearchResult(
            source_tier=RetrievalTier.CACHE,
            latency_ms=0,
        )

        # Always get user context first (Tier 1 - cache)
        if include_user_context and user_id:
            try:
                result.user_context = await self.get_user_context(user_id, organization_id)
            except Exception as e:
                logger.warning("Failed to get user context", error=str(e))

        elapsed_ms = (time.time() - start_time) * 1000

        # Determine which tier we can afford
        remaining_budget = latency_budget_ms - elapsed_ms

        if remaining_budget < 50:
            # Only cache tier available
            result.source_tier = RetrievalTier.CACHE
            result.latency_ms = elapsed_ms
            return result

        if remaining_budget < 200:
            # Vector search tier
            result.source_tier = RetrievalTier.VECTOR
            try:
                vector_results = await self._vector_search(
                    query=query,
                    organization_id=organization_id,
                    max_results=max_results,
                )
                result.entities = vector_results.get("entities", [])
                result.episodes = vector_results.get("episodes", [])
            except Exception as e:
                logger.warning("Vector search failed", error=str(e))
        else:
            # Full hybrid search tier
            result.source_tier = RetrievalTier.HYBRID
            try:
                hybrid_results = await self._hybrid_search(
                    query=query,
                    organization_id=organization_id,
                    user_context=result.user_context,
                    max_results=max_results,
                )
                result.entities = hybrid_results.get("entities", [])
                result.episodes = hybrid_results.get("episodes", [])
                result.commitments = hybrid_results.get("commitments", [])
                result.decisions = hybrid_results.get("decisions", [])
            except Exception as e:
                logger.warning("Hybrid search failed", error=str(e))

        result.latency_ms = (time.time() - start_time) * 1000
        result.total_results = (
            len(result.entities)
            + len(result.episodes)
            + len(result.commitments)
            + len(result.decisions)
        )

        logger.info(
            "Memory search complete",
            tier=result.source_tier,
            latency_ms=result.latency_ms,
            total_results=result.total_results,
            budget_ms=latency_budget_ms,
        )

        return result

    async def get_user_context(
        self,
        user_id: str,
        organization_id: str,
    ) -> UserContext:
        """
        Get user's context (the 'RAM layer').

        Always returns in < 50ms from cache if available,
        falls back to graph query if not cached.

        Args:
            user_id: User identifier
            organization_id: Organization context

        Returns:
            UserContext with static and dynamic context
        """
        cache_key = f"{self.CACHE_KEY_PREFIX}user:{organization_id}:{user_id}"

        # Try cache first
        if self._redis:
            try:
                cached = await self._redis.get(cache_key)
                if cached:
                    return UserContext.model_validate_json(cached)
            except Exception as e:
                logger.debug("Cache miss for user context", error=str(e))

        # Fall back to graph query
        await self._ensure_clients()

        try:
            result = await self._graph.query(
                """
                MATCH (up:UserProfile {userId: $user_id, organizationId: $org_id})
                OPTIONAL MATCH (up)-[:PROFILE_OF]->(c:Contact)
                RETURN up, c
                """,
                {"user_id": user_id, "org_id": organization_id},
            )

            if result and len(result) > 0:
                profile = result[0].get("up", {})
                contact = result[0].get("c", {})

                context = UserContext(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=profile.get("name") or contact.get("name"),
                    role=profile.get("role"),
                    timezone=profile.get("timezone"),
                    priorities=profile.get("priorities", []),
                    vip_contact_emails=profile.get("vipContactEmails", []),
                    current_focus=profile.get("currentFocus", []),
                    recent_topics=profile.get("recentTopics", []),
                    active_projects=profile.get("activeProjectIds", []),
                    unread_commitments_count=profile.get("unreadCommitmentsCount", 0),
                    overdue_commitments_count=profile.get("overdueCommitmentsCount", 0),
                    pending_decisions_count=profile.get("pendingDecisionsCount", 0),
                    last_refreshed_at=datetime.now(timezone.utc),
                )

                # Cache for next time
                if self._redis:
                    try:
                        await self._redis.setex(
                            cache_key,
                            self.CACHE_TTL_SECONDS,
                            context.model_dump_json(),
                        )
                    except Exception:
                        pass  # Cache write failure is non-critical

                return context

        except Exception as e:
            logger.warning("Failed to get user context from graph", error=str(e))

        # Return empty context if nothing found
        return UserContext(
            user_id=user_id,
            organization_id=organization_id,
        )

    async def get_entity_summary(
        self,
        entity_id: str,
        organization_id: str,
    ) -> EntitySummary | None:
        """
        Get cached entity summary for fast lookup.

        Args:
            entity_id: Entity identifier
            organization_id: Organization context

        Returns:
            EntitySummary or None if not found
        """
        cache_key = f"{self.CACHE_KEY_PREFIX}entity:{organization_id}:{entity_id}"

        # Try cache first
        if self._redis:
            try:
                cached = await self._redis.get(cache_key)
                if cached:
                    return EntitySummary.model_validate_json(cached)
            except Exception:
                pass

        # Fall back to graph query
        await self._ensure_clients()

        try:
            result = await self._graph.query(
                """
                MATCH (e:Entity {id: $entity_id, organizationId: $org_id})
                OPTIONAL MATCH (e)-[:MENTIONED_IN]->(ep:Episode)<-[:MENTIONED_IN]-(c:Contact)
                WITH e, collect(DISTINCT c.email)[0..5] as related_contacts
                OPTIONAL MATCH (e)-[:RELATED_TO]->(t:Topic)
                RETURN e, related_contacts, collect(DISTINCT t.name)[0..5] as related_topics
                """,
                {"entity_id": entity_id, "org_id": organization_id},
            )

            if result and len(result) > 0:
                entity = result[0].get("e", {})
                summary = EntitySummary(
                    entity_id=entity_id,
                    entity_type=entity.get("entityType", "unknown"),
                    name=entity.get("name", ""),
                    summary=entity.get("summary"),
                    related_contacts=result[0].get("related_contacts", []),
                    related_topics=result[0].get("related_topics", []),
                    relevance_score=entity.get("relevanceScore", 1.0),
                    importance_score=entity.get("importanceScore", 0.0),
                )

                # Cache for next time
                if self._redis:
                    try:
                        await self._redis.setex(
                            cache_key,
                            self.CACHE_TTL_SECONDS,
                            summary.model_dump_json(),
                        )
                    except Exception:
                        pass

                return summary

        except Exception as e:
            logger.warning("Failed to get entity summary", error=str(e))

        return None

    async def _vector_search(
        self,
        query: str,
        organization_id: str,
        max_results: int = 10,
    ) -> dict[str, list]:
        """
        Tier 2: Fast vector search using HNSW indexes.

        Target: < 100ms
        """
        from src.search.embeddings import generate_embedding

        # Get query embedding
        query_embedding = await generate_embedding(query)

        # Search entities using vector similarity
        entities_result = await self._graph.query(
            """
            CALL db.idx.vector.queryNodes(
                'Entity',
                'embedding',
                $k,
                vecf32($embedding)
            ) YIELD node, score
            WHERE node.organizationId = $org_id
            AND node.validTo IS NULL
            RETURN node.id as id,
                   node.name as name,
                   node.entityType as entity_type,
                   node.summary as summary,
                   score
            ORDER BY score DESC
            """,
            {
                "embedding": query_embedding,
                "org_id": organization_id,
                "k": max_results,
            },
        )

        entities = [
            EntitySummary(
                entity_id=row["id"],
                entity_type=row["entity_type"],
                name=row["name"],
                summary=row.get("summary"),
            )
            for row in (entities_result or [])
        ]

        # Search episodes
        episodes_result = await self._graph.query(
            """
            CALL db.idx.vector.queryNodes(
                'Episode',
                'embedding',
                $k,
                vecf32($embedding)
            ) YIELD node, score
            WHERE node.organizationId = $org_id
            RETURN node.id as id,
                   node.name as name,
                   node.summary as summary,
                   node.sourceType as source_type,
                   node.referenceTime as reference_time,
                   score
            ORDER BY score DESC
            """,
            {
                "embedding": query_embedding,
                "org_id": organization_id,
                "k": max_results,
            },
        )

        episodes = [
            {
                "id": row["id"],
                "name": row["name"],
                "summary": row.get("summary"),
                "source_type": row.get("source_type"),
                "reference_time": row.get("reference_time"),
                "score": row.get("score"),
            }
            for row in (episodes_result or [])
        ]

        return {
            "entities": entities,
            "episodes": episodes,
        }

    async def _hybrid_search(
        self,
        query: str,
        organization_id: str,
        user_context: UserContext | None = None,
        max_results: int = 10,
    ) -> dict[str, list]:
        """
        Tier 3: Full hybrid search with graph expansion.

        Combines:
        - Vector similarity (semantic)
        - Full-text search (keyword)
        - Graph expansion (relationships)
        - User personalization (VIPs, priorities)

        Target: < 300ms
        """
        # Start with vector search results
        base_results = await self._vector_search(query, organization_id, max_results * 2)

        entities = base_results.get("entities", [])
        episodes = base_results.get("episodes", [])

        # Full-text search for additional matches
        try:
            fulltext_result = await self._graph.query(
                """
                CALL db.idx.fulltext.queryNodes('entity_content', $query)
                YIELD node, score
                WHERE node.organizationId = $org_id
                AND node.validTo IS NULL
                RETURN node.id as id,
                       node.name as name,
                       node.entityType as entity_type,
                       node.summary as summary,
                       score
                LIMIT $limit
                """,
                {
                    "query": query,
                    "org_id": organization_id,
                    "limit": max_results,
                },
            )

            # Merge with vector results (RRF-style fusion)
            existing_ids = {e.entity_id for e in entities}
            for row in (fulltext_result or []):
                if row["id"] not in existing_ids:
                    entities.append(
                        EntitySummary(
                            entity_id=row["id"],
                            entity_type=row["entity_type"],
                            name=row["name"],
                            summary=row.get("summary"),
                        )
                    )

        except Exception as e:
            logger.debug("Full-text search failed", error=str(e))

        # Boost VIP contacts if user context available
        if user_context and user_context.vip_contact_emails:
            for entity in entities:
                if entity.name in user_context.vip_contact_emails:
                    entity.importance_score += 0.5

        # Get related commitments
        commitments = []
        try:
            commitment_result = await self._graph.query(
                """
                MATCH (c:Commitment {organizationId: $org_id})
                WHERE c.validTo IS NULL
                AND (c.title CONTAINS $keyword OR c.description CONTAINS $keyword)
                RETURN c.id as id,
                       c.title as title,
                       c.status as status,
                       c.priority as priority,
                       c.dueDate as due_date
                LIMIT $limit
                """,
                {
                    "org_id": organization_id,
                    "keyword": query.split()[0] if query else "",
                    "limit": max_results // 2,
                },
            )
            commitments = [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "status": row.get("status"),
                    "priority": row.get("priority"),
                    "due_date": row.get("due_date"),
                }
                for row in (commitment_result or [])
            ]
        except Exception as e:
            logger.debug("Commitment search failed", error=str(e))

        # Get related decisions
        decisions = []
        try:
            decision_result = await self._graph.query(
                """
                MATCH (d:Decision {organizationId: $org_id})
                WHERE d.validTo IS NULL
                AND (d.title CONTAINS $keyword OR d.statement CONTAINS $keyword)
                RETURN d.id as id,
                       d.title as title,
                       d.statement as statement,
                       d.status as status
                LIMIT $limit
                """,
                {
                    "org_id": organization_id,
                    "keyword": query.split()[0] if query else "",
                    "limit": max_results // 2,
                },
            )
            decisions = [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "statement": row.get("statement"),
                    "status": row.get("status"),
                }
                for row in (decision_result or [])
            ]
        except Exception as e:
            logger.debug("Decision search failed", error=str(e))

        return {
            "entities": entities[:max_results],
            "episodes": episodes[:max_results],
            "commitments": commitments,
            "decisions": decisions,
        }

    async def warm_cache(self, organization_id: str) -> int:
        """
        Pre-compute and cache hot entities for an organization.

        Should be run during off-peak hours or after significant updates.

        Returns:
            Number of entities cached
        """
        await self._ensure_clients()

        if not self._redis:
            logger.warning("Redis not available for cache warming")
            return 0

        cached_count = 0

        try:
            # Get top entities by relevance/importance
            result = await self._graph.query(
                """
                MATCH (e:Entity {organizationId: $org_id})
                WHERE e.validTo IS NULL
                RETURN e.id as id
                ORDER BY e.relevanceScore DESC, e.accessCount DESC
                LIMIT 100
                """,
                {"org_id": organization_id},
            )

            for row in (result or []):
                entity_id = row["id"]
                summary = await self.get_entity_summary(entity_id, organization_id)
                if summary:
                    cached_count += 1

            logger.info(
                "Cache warming complete",
                organization_id=organization_id,
                cached_count=cached_count,
            )

        except Exception as e:
            logger.error("Cache warming failed", error=str(e))

        return cached_count

    async def invalidate_user_cache(self, user_id: str, organization_id: str):
        """Invalidate user context cache."""
        if self._redis:
            cache_key = f"{self.CACHE_KEY_PREFIX}user:{organization_id}:{user_id}"
            try:
                await self._redis.delete(cache_key)
            except Exception as e:
                logger.warning("Failed to invalidate user cache", error=str(e))

    async def invalidate_entity_cache(self, entity_id: str, organization_id: str):
        """Invalidate entity cache."""
        if self._redis:
            cache_key = f"{self.CACHE_KEY_PREFIX}entity:{organization_id}:{entity_id}"
            try:
                await self._redis.delete(cache_key)
            except Exception as e:
                logger.warning("Failed to invalidate entity cache", error=str(e))


# Singleton instance
_fast_memory: FastMemoryRetrieval | None = None


async def get_fast_memory() -> FastMemoryRetrieval:
    """Get or create the fast memory retrieval service."""
    global _fast_memory
    if _fast_memory is None:
        _fast_memory = FastMemoryRetrieval()
    return _fast_memory
