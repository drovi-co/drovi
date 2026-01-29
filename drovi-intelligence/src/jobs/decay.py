"""
Memory Decay Job

Implements relevance decay for "living" memory semantics.
Scheduled to run daily to update relevance scores based on:
- Time since last access
- Base decay rate
- Access frequency
- Importance signals

From the pitch: "Living intelligence graph" with memory evolution.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class DecayJobConfig:
    """Configuration for memory decay computation."""

    # Decay parameters
    default_decay_rate: float = 0.05  # 5% daily decay
    min_relevance_threshold: float = 0.1  # Below this, archive
    max_relevance: float = 1.0

    # Access boost parameters
    access_boost: float = 0.1  # Boost per access
    max_access_boost: float = 0.5  # Maximum boost from accesses

    # Type-specific decay rates (some things are more permanent)
    decay_rates_by_type: dict[str, float] = field(default_factory=lambda: {
        "Decision": 0.02,  # Decisions decay slowly (2%/day)
        "Commitment": 0.03,  # Commitments decay slower (3%/day)
        "Task": 0.05,  # Tasks decay at normal rate
        "Risk": 0.04,  # Risks decay slower
        "Contact": 0.01,  # Contacts decay very slowly
        "Topic": 0.03,  # Topics decay slower
        "Episode": 0.05,  # Episodes decay at normal rate
        "Entity": 0.03,  # Entities decay slower
        "Brief": 0.08,  # Briefs decay faster (less permanent)
        "Claim": 0.06,  # Claims decay moderately
    })

    # Importance multipliers (high importance = slower decay)
    priority_multipliers: dict[str, float] = field(default_factory=lambda: {
        "critical": 0.2,  # 80% slower decay
        "high": 0.5,  # 50% slower decay
        "medium": 1.0,  # Normal decay
        "low": 1.5,  # 50% faster decay
    })


def compute_decay_factor(
    days_since_access: float,
    decay_rate: float,
    access_count: int = 0,
    priority: str = "medium",
    config: DecayJobConfig | None = None,
) -> float:
    """
    Compute the decay factor for a memory node.

    Uses exponential decay with access frequency boost:
    relevance = base_relevance * (1 - decay_rate)^days * (1 + access_boost)

    Args:
        days_since_access: Days since the node was last accessed
        decay_rate: Base decay rate per day
        access_count: Number of times the node has been accessed
        priority: Priority level (critical, high, medium, low)
        config: Decay configuration

    Returns:
        Decay factor (0.0 to 1.0)
    """
    config = config or DecayJobConfig()

    # Adjust decay rate based on priority
    priority_mult = config.priority_multipliers.get(priority, 1.0)
    effective_decay = decay_rate * priority_mult

    # Compute base decay (exponential)
    decay_factor = (1 - effective_decay) ** days_since_access

    # Compute access boost (logarithmic diminishing returns)
    import math
    if access_count > 0:
        access_boost = min(
            config.access_boost * math.log(access_count + 1),
            config.max_access_boost,
        )
        decay_factor = min(decay_factor * (1 + access_boost), config.max_relevance)

    return max(decay_factor, 0.0)


class MemoryDecayJob:
    """
    Scheduled job for computing memory decay.

    Runs daily to:
    1. Compute relevance decay for all nodes
    2. Archive nodes below threshold
    3. Update access-based metrics
    4. Clean up orphaned nodes
    """

    def __init__(self, config: DecayJobConfig | None = None):
        """Initialize decay job with configuration."""
        self.config = config or DecayJobConfig()

    async def run(self, organization_id: str | None = None) -> dict[str, Any]:
        """
        Execute the decay computation job.

        Args:
            organization_id: Optional org filter. If None, processes all orgs.

        Returns:
            Job execution statistics
        """
        from src.graph.client import get_graph_client

        logger.info(
            "Starting memory decay job",
            organization_id=organization_id,
        )

        graph = await get_graph_client()
        now = datetime.utcnow()

        stats = {
            "nodes_processed": 0,
            "nodes_decayed": 0,
            "nodes_archived": 0,
            "nodes_boosted": 0,
            "errors": 0,
            "started_at": now.isoformat(),
        }

        # Process each node type
        node_types = list(self.config.decay_rates_by_type.keys())

        for node_type in node_types:
            try:
                type_stats = await self._process_node_type(
                    graph, node_type, organization_id, now
                )
                stats["nodes_processed"] += type_stats["processed"]
                stats["nodes_decayed"] += type_stats["decayed"]
                stats["nodes_archived"] += type_stats["archived"]
                stats["nodes_boosted"] += type_stats["boosted"]
            except Exception as e:
                logger.error(
                    "Error processing node type for decay",
                    node_type=node_type,
                    error=str(e),
                )
                stats["errors"] += 1

        stats["completed_at"] = datetime.utcnow().isoformat()
        stats["duration_seconds"] = (datetime.utcnow() - now).total_seconds()

        logger.info(
            "Memory decay job completed",
            **stats,
        )

        return stats

    async def _process_node_type(
        self,
        graph: Any,
        node_type: str,
        organization_id: str | None,
        now: datetime,
    ) -> dict[str, int]:
        """Process decay for a specific node type."""
        stats = {"processed": 0, "decayed": 0, "archived": 0, "boosted": 0}

        decay_rate = self.config.decay_rates_by_type.get(
            node_type, self.config.default_decay_rate
        )

        # Build query based on whether org filter is provided
        org_filter = ""
        params: dict[str, Any] = {"now": now.isoformat()}

        if organization_id:
            org_filter = "AND n.organizationId = $orgId"
            params["orgId"] = organization_id

        # Get nodes with relevance tracking
        query = f"""
            MATCH (n:{node_type})
            WHERE n.relevanceScore IS NOT NULL
            AND n.validTo IS NULL
            {org_filter}
            RETURN n.id as id,
                   n.relevanceScore as current_relevance,
                   n.lastAccessedAt as last_accessed,
                   n.accessCount as access_count,
                   n.priority as priority,
                   n.createdAt as created_at
            LIMIT 10000
        """

        try:
            result = await graph.query(query, params)
        except Exception as e:
            logger.warning(
                "Failed to query nodes for decay",
                node_type=node_type,
                error=str(e),
            )
            return stats

        for row in (result or []):
            try:
                node_id = row.get("id")
                if not node_id:
                    continue

                stats["processed"] += 1

                # Calculate days since last access
                last_accessed_str = row.get("last_accessed")
                if last_accessed_str:
                    try:
                        last_accessed = datetime.fromisoformat(last_accessed_str.replace("Z", "+00:00"))
                        days_since = (now - last_accessed.replace(tzinfo=None)).days
                    except Exception:
                        # Use created_at as fallback
                        created_str = row.get("created_at")
                        if created_str:
                            try:
                                created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                                days_since = (now - created.replace(tzinfo=None)).days
                            except Exception:
                                days_since = 1
                        else:
                            days_since = 1
                else:
                    days_since = 1

                current_relevance = row.get("current_relevance", 1.0) or 1.0
                access_count = row.get("access_count", 0) or 0
                priority = row.get("priority", "medium") or "medium"

                # Compute new relevance
                decay_factor = compute_decay_factor(
                    days_since_access=days_since,
                    decay_rate=decay_rate,
                    access_count=access_count,
                    priority=priority,
                    config=self.config,
                )

                new_relevance = current_relevance * decay_factor

                # Check if we should archive (below threshold)
                if new_relevance < self.config.min_relevance_threshold:
                    await self._archive_node(graph, node_type, node_id)
                    stats["archived"] += 1
                elif new_relevance < current_relevance:
                    # Update relevance score
                    await graph.query(
                        f"""
                        MATCH (n:{node_type} {{id: $nodeId}})
                        SET n.relevanceScore = $relevance,
                            n.decayComputedAt = $now
                        """,
                        {
                            "nodeId": node_id,
                            "relevance": new_relevance,
                            "now": now.isoformat(),
                        },
                    )
                    stats["decayed"] += 1
                elif new_relevance > current_relevance:
                    # Access boost increased relevance
                    await graph.query(
                        f"""
                        MATCH (n:{node_type} {{id: $nodeId}})
                        SET n.relevanceScore = $relevance,
                            n.decayComputedAt = $now
                        """,
                        {
                            "nodeId": node_id,
                            "relevance": new_relevance,
                            "now": now.isoformat(),
                        },
                    )
                    stats["boosted"] += 1

            except Exception as e:
                logger.warning(
                    "Error processing node for decay",
                    node_id=row.get("id"),
                    error=str(e),
                )

        return stats

    async def _archive_node(self, graph: Any, node_type: str, node_id: str) -> None:
        """Archive a node by setting validTo timestamp."""
        now = datetime.utcnow().isoformat()

        await graph.query(
            f"""
            MATCH (n:{node_type} {{id: $nodeId}})
            SET n.validTo = $now,
                n.archivedReason = 'relevance_decay'
            """,
            {"nodeId": node_id, "now": now},
        )

        logger.debug(
            "Archived node due to low relevance",
            node_type=node_type,
            node_id=node_id,
        )

    async def initialize_relevance_scores(
        self,
        organization_id: str | None = None,
    ) -> int:
        """
        Initialize relevance scores for nodes that don't have them.

        Args:
            organization_id: Optional org filter

        Returns:
            Number of nodes initialized
        """
        from src.graph.client import get_graph_client

        graph = await get_graph_client()
        initialized = 0

        node_types = list(self.config.decay_rates_by_type.keys())

        for node_type in node_types:
            org_filter = ""
            params: dict[str, Any] = {}

            if organization_id:
                org_filter = "AND n.organizationId = $orgId"
                params["orgId"] = organization_id

            # Find nodes without relevance scores
            result = await graph.query(
                f"""
                MATCH (n:{node_type})
                WHERE n.relevanceScore IS NULL
                AND n.validTo IS NULL
                {org_filter}
                SET n.relevanceScore = 1.0,
                    n.accessCount = COALESCE(n.accessCount, 0),
                    n.lastAccessedAt = COALESCE(n.lastAccessedAt, n.createdAt)
                RETURN count(n) as count
                """,
                params,
            )

            if result:
                count = result[0].get("count", 0)
                initialized += count

        logger.info(
            "Initialized relevance scores",
            count=initialized,
            organization_id=organization_id,
        )

        return initialized


# Singleton instance
_decay_job: MemoryDecayJob | None = None


async def get_decay_job() -> MemoryDecayJob:
    """Get the singleton decay job instance."""
    global _decay_job
    if _decay_job is None:
        _decay_job = MemoryDecayJob()
    return _decay_job


async def run_decay_job(organization_id: str | None = None) -> dict[str, Any]:
    """Convenience function to run the decay job."""
    job = await get_decay_job()
    return await job.run(organization_id)
