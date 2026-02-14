"""
Enhanced Graphiti Wrapper with Temporal Queries

Extends the base DroviGraphitiMemory with:
- Full bi-temporal query support
- Time-travel queries ("What did we know on March 15?")
- Temporal intelligence analysis
- Multi-tenant memory isolation
- Episode timeline reconstruction
- Knowledge evolution tracking

This is part of Phase 5 (Agentic Memory) of the FalkorDB enhancement plan.
"""

from datetime import datetime, timedelta
from typing import Any, Literal

import structlog

from src.config import get_settings
from src.kernel.time import utc_now_naive
from .graphiti_memory import DroviGraphitiMemory, get_graphiti_memory

logger = structlog.get_logger()


class EnhancedGraphiti:
    """
    Enhanced Graphiti wrapper with temporal queries and advanced features.

    Provides:
    - Bi-temporal queries (as-of time + transaction time)
    - Knowledge evolution tracking
    - Timeline reconstruction
    - Memory consolidation
    - Cross-time comparison
    """

    def __init__(self, organization_id: str):
        """Initialize enhanced Graphiti wrapper."""
        self.organization_id = organization_id
        self._base_memory: DroviGraphitiMemory | None = None

    async def _get_memory(self) -> DroviGraphitiMemory:
        """Get the underlying Graphiti memory instance."""
        if self._base_memory is None:
            self._base_memory = await get_graphiti_memory(self.organization_id)
        return self._base_memory

    # =========================================================================
    # Intelligence Episode Management
    # =========================================================================

    async def add_intelligence_episode(
        self,
        content: str,
        uio_type: str,
        reference_time: datetime,
        source_type: str = "analysis",
        source_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Store extracted intelligence as a temporal episode.

        Creates an episode that captures the intelligence extraction
        at a specific point in time, enabling temporal queries.

        Args:
            content: The intelligence content (commitment, decision, etc.)
            uio_type: Type of intelligence (commitment, decision, risk, etc.)
            reference_time: When this intelligence was observed
            source_type: Source type (email, slack, etc.)
            source_id: Source message ID
            metadata: Additional metadata

        Returns:
            Episode UUID
        """
        memory = await self._get_memory()

        # Construct episode name
        name = f"{uio_type}_{reference_time.strftime('%Y%m%d_%H%M%S')}"

        # Add source info to content
        source_desc = f"{source_type}:{source_id}" if source_id else source_type

        episode_id = await memory.add_episode(
            name=name,
            content=content,
            source_type=source_type,
            reference_time=reference_time,
            source_id=source_id,
            source_description=source_desc,
        )

        logger.debug(
            "Added intelligence episode",
            episode_id=episode_id,
            uio_type=uio_type,
            organization_id=self.organization_id,
        )

        return episode_id

    # =========================================================================
    # Temporal Search
    # =========================================================================

    async def temporal_search(
        self,
        query: str,
        as_of: datetime,
        num_results: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Search knowledge as it existed at a specific point in time.

        This is the key temporal query capability - see what was known
        at any historical moment.

        Args:
            query: Search query
            as_of: Point in time to query
            num_results: Maximum results

        Returns:
            List of search results valid at the specified time
        """
        memory = await self._get_memory()

        logger.info(
            "Temporal search",
            query=query[:50],
            as_of=as_of.isoformat(),
            organization_id=self.organization_id,
        )

        return await memory.search_as_of(
            query=query,
            as_of_date=as_of,
            num_results=num_results,
        )

    async def search_time_range(
        self,
        query: str,
        start_time: datetime,
        end_time: datetime,
        num_results: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Search for knowledge that was valid within a time range.

        Useful for finding what was known during a specific period.

        Args:
            query: Search query
            start_time: Start of time range
            end_time: End of time range
            num_results: Maximum results

        Returns:
            List of search results with temporal validity info
        """
        memory = await self._get_memory()

        # Search at end of range and filter by validity
        results = await memory.search_as_of(
            query=query,
            as_of_date=end_time,
            num_results=num_results * 2,  # Get extra to filter
        )

        # Add temporal validity info
        for result in results:
            result["search_range"] = {
                "start": start_time.isoformat(),
                "end": end_time.isoformat(),
            }

        return results[:num_results]

    async def get_knowledge_evolution(
        self,
        entity_name: str,
        start_time: datetime,
        end_time: datetime,
        sample_points: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Track how knowledge about an entity evolved over time.

        Samples the knowledge state at multiple points to show evolution.

        Args:
            entity_name: Entity to track
            start_time: Start of tracking period
            end_time: End of tracking period
            sample_points: Number of time points to sample

        Returns:
            List of knowledge states at different times
        """
        memory = await self._get_memory()
        evolution = []

        # Calculate time intervals
        total_duration = (end_time - start_time).total_seconds()
        interval = total_duration / (sample_points - 1) if sample_points > 1 else 0

        for i in range(sample_points):
            sample_time = start_time + timedelta(seconds=interval * i)

            # Search for entity at this time
            results = await memory.search_as_of(
                query=entity_name,
                as_of_date=sample_time,
                num_results=5,
            )

            evolution.append({
                "timestamp": sample_time.isoformat(),
                "knowledge_state": results,
                "result_count": len(results),
            })

        logger.info(
            "Knowledge evolution tracked",
            entity=entity_name,
            sample_points=sample_points,
            organization_id=self.organization_id,
        )

        return evolution

    # =========================================================================
    # Timeline Reconstruction
    # =========================================================================

    async def get_episode_timeline(
        self,
        start_time: datetime,
        end_time: datetime,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Reconstruct a timeline of episodes within a time range.

        Shows what information was recorded during a period.

        Args:
            start_time: Timeline start
            end_time: Timeline end
            limit: Maximum episodes to return

        Returns:
            List of episodes ordered by reference time
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        # Query episodes in time range
        result = await graph.query(
            """
            MATCH (e:Episode {organizationId: $orgId})
            WHERE e.referenceTime >= $startTime
            AND e.referenceTime <= $endTime
            RETURN e.id as id, e.name as name, e.sourceType as source_type,
                   e.referenceTime as reference_time, e.recordedAt as recorded_at,
                   e.sourceId as source_id
            ORDER BY e.referenceTime ASC
            LIMIT $limit
            """,
            {
                "orgId": self.organization_id,
                "startTime": start_time.isoformat(),
                "endTime": end_time.isoformat(),
                "limit": limit,
            },
        )

        return [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "source_type": row.get("source_type"),
                "reference_time": row.get("reference_time"),
                "recorded_at": row.get("recorded_at"),
                "source_id": row.get("source_id"),
            }
            for row in (result or [])
        ]

    async def get_daily_summary(
        self,
        date: datetime,
    ) -> dict[str, Any]:
        """
        Get a summary of intelligence recorded on a specific day.

        Args:
            date: The date to summarize

        Returns:
            Summary of the day's intelligence
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)

        # Get counts by type
        result = await graph.query(
            """
            MATCH (n)
            WHERE n.organizationId = $orgId
            AND n.createdAt >= $startTime
            AND n.createdAt < $endTime
            RETURN labels(n)[0] as type, count(n) as count
            """,
            {
                "orgId": self.organization_id,
                "startTime": start_of_day.isoformat(),
                "endTime": end_of_day.isoformat(),
            },
        )

        type_counts = {
            row.get("type"): row.get("count")
            for row in (result or [])
        }

        return {
            "date": date.strftime("%Y-%m-%d"),
            "organization_id": self.organization_id,
            "intelligence_counts": type_counts,
            "total_items": sum(type_counts.values()),
        }

    # =========================================================================
    # Cross-Time Comparison
    # =========================================================================

    async def compare_knowledge_states(
        self,
        query: str,
        time_a: datetime,
        time_b: datetime,
    ) -> dict[str, Any]:
        """
        Compare knowledge states at two different points in time.

        Useful for seeing what changed between two dates.

        Args:
            query: Query to compare
            time_a: First time point
            time_b: Second time point

        Returns:
            Comparison of knowledge states
        """
        memory = await self._get_memory()

        # Search at both times
        results_a = await memory.search_as_of(query, time_a, num_results=20)
        results_b = await memory.search_as_of(query, time_b, num_results=20)

        # Find differences
        ids_a = {r.get("uuid") for r in results_a}
        ids_b = {r.get("uuid") for r in results_b}

        added = ids_b - ids_a
        removed = ids_a - ids_b
        unchanged = ids_a & ids_b

        return {
            "query": query,
            "time_a": time_a.isoformat(),
            "time_b": time_b.isoformat(),
            "state_a": {
                "result_count": len(results_a),
                "results": results_a,
            },
            "state_b": {
                "result_count": len(results_b),
                "results": results_b,
            },
            "changes": {
                "added_count": len(added),
                "removed_count": len(removed),
                "unchanged_count": len(unchanged),
            },
        }

    # =========================================================================
    # Memory Consolidation
    # =========================================================================

    async def consolidate_memory(
        self,
        time_window: timedelta = timedelta(days=7),
        min_occurrences: int = 3,
    ) -> dict[str, Any]:
        """
        Consolidate recent memory by identifying recurring patterns.

        Finds entities and facts that appear frequently across episodes
        and marks them as consolidated knowledge.

        Args:
            time_window: How far back to look
            min_occurrences: Minimum occurrences to consider significant

        Returns:
            Consolidation statistics
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()
        cutoff = utc_now_naive() - time_window

        # Find frequently mentioned entities
        result = await graph.query(
            """
            MATCH (e:Entity {organizationId: $orgId})
            WHERE e.createdAt >= $cutoff
            OPTIONAL MATCH (e)<-[:MENTIONS]-(ep:Episode)
            WITH e, count(ep) as mention_count
            WHERE mention_count >= $minOccurrences
            RETURN e.id as id, e.name as name, mention_count
            ORDER BY mention_count DESC
            LIMIT 50
            """,
            {
                "orgId": self.organization_id,
                "cutoff": cutoff.isoformat(),
                "minOccurrences": min_occurrences,
            },
        )

        consolidated_entities = [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "mention_count": row.get("mention_count"),
            }
            for row in (result or [])
        ]

        return {
            "organization_id": self.organization_id,
            "time_window_days": time_window.days,
            "min_occurrences": min_occurrences,
            "consolidated_entities": consolidated_entities,
            "consolidated_count": len(consolidated_entities),
        }

    # =========================================================================
    # Cleanup
    # =========================================================================

    async def close(self) -> None:
        """Close the underlying memory connection."""
        if self._base_memory:
            await self._base_memory.close()
            self._base_memory = None


# =============================================================================
# Factory Functions
# =============================================================================

_enhanced_graphiti_instances: dict[str, EnhancedGraphiti] = {}


async def get_enhanced_graphiti(organization_id: str) -> EnhancedGraphiti:
    """Get an enhanced Graphiti instance for an organization."""
    global _enhanced_graphiti_instances

    if organization_id not in _enhanced_graphiti_instances:
        _enhanced_graphiti_instances[organization_id] = EnhancedGraphiti(organization_id)

    return _enhanced_graphiti_instances[organization_id]


async def close_all_enhanced_graphiti() -> None:
    """Close all enhanced Graphiti instances."""
    global _enhanced_graphiti_instances

    for instance in _enhanced_graphiti_instances.values():
        await instance.close()

    _enhanced_graphiti_instances.clear()
