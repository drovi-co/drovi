"""
Graph Analytics Job

Scheduled job for computing graph analytics on the contact network:
- PageRank: Entity importance/influence scoring
- CDLP Community Detection: Communication cluster identification
- Betweenness Centrality: Bridge connector detection

These analytics enable:
- Prioritization of contacts by influence
- Group discovery for stakeholder mapping
- Identification of key connectors
- Network health monitoring

Scheduling:
- PageRank: Hourly (importance changes with new communications)
- Communities: Daily (clusters are more stable)
- Betweenness: Daily (bridge detection is computationally intensive)
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import structlog

from src.graph.client import get_graph_client, get_analytics_engine, GraphAnalyticsEngine

logger = structlog.get_logger()


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class GraphAnalyticsConfig:
    """Configuration for graph analytics computation."""

    # PageRank parameters
    pagerank_damping_factor: float = 0.85
    pagerank_max_iterations: int = 20
    pagerank_tolerance: float = 0.0001

    # Betweenness parameters
    betweenness_sample_size: int | None = 100  # None for exact (slow)

    # Community detection parameters
    community_max_iterations: int = 10

    # Job scheduling (cron expressions)
    pagerank_schedule: str = "0 * * * *"  # Hourly
    communities_schedule: str = "0 0 * * *"  # Daily at midnight
    betweenness_schedule: str = "0 1 * * *"  # Daily at 1 AM

    # Performance settings
    batch_size: int = 1000
    max_organizations_per_run: int = 100


class GraphAnalyticsJob:
    """
    Scheduled job for computing graph analytics.

    Computes and persists:
    - PageRank scores (influence)
    - Community assignments (clustering)
    - Betweenness centrality (bridge detection)

    Results are stored on Contact nodes for fast querying.
    """

    def __init__(self, config: GraphAnalyticsConfig | None = None):
        """Initialize analytics job with configuration."""
        self.config = config or GraphAnalyticsConfig()
        self._engine: GraphAnalyticsEngine | None = None

    async def _get_engine(self) -> GraphAnalyticsEngine:
        """Get the analytics engine instance."""
        if self._engine is None:
            self._engine = await get_analytics_engine()
        return self._engine

    async def run_all(
        self,
        organization_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Run all analytics computations.

        Args:
            organization_id: Optional org filter. If None, processes all orgs.

        Returns:
            Combined job statistics
        """
        logger.info(
            "Starting full graph analytics job",
            organization_id=organization_id,
        )

        start_time = utc_now()

        # Get list of organizations to process
        org_ids = await self._get_organizations(organization_id)

        results = {
            "organizations_processed": 0,
            "pagerank": {"total_contacts": 0, "orgs_processed": 0},
            "communities": {"total_communities": 0, "orgs_processed": 0},
            "betweenness": {"total_contacts": 0, "orgs_processed": 0},
            "errors": [],
            "started_at": start_time.isoformat(),
        }

        for org_id in org_ids[:self.config.max_organizations_per_run]:
            try:
                org_results = await self._process_organization(org_id)
                results["organizations_processed"] += 1

                # Aggregate results
                results["pagerank"]["total_contacts"] += org_results.get(
                    "pagerank_contacts", 0
                )
                results["pagerank"]["orgs_processed"] += 1

                results["communities"]["total_communities"] += org_results.get(
                    "communities_detected", 0
                )
                results["communities"]["orgs_processed"] += 1

                results["betweenness"]["total_contacts"] += org_results.get(
                    "betweenness_contacts", 0
                )
                results["betweenness"]["orgs_processed"] += 1

            except Exception as e:
                logger.error(
                    "Error processing organization for analytics",
                    organization_id=org_id,
                    error=str(e),
                )
                results["errors"].append({
                    "organization_id": org_id,
                    "error": str(e),
                })

        results["completed_at"] = utc_now().isoformat()
        results["duration_seconds"] = (utc_now() - start_time).total_seconds()

        logger.info(
            "Graph analytics job completed",
            organizations=results["organizations_processed"],
            duration=results["duration_seconds"],
        )

        return results

    async def run_pagerank(
        self,
        organization_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Run only PageRank computation.

        Suitable for hourly scheduling.

        Args:
            organization_id: Optional org filter

        Returns:
            Job statistics
        """
        logger.info(
            "Starting PageRank job",
            organization_id=organization_id,
        )

        start_time = utc_now()
        engine = await self._get_engine()

        # Get organizations
        org_ids = await self._get_organizations(organization_id)

        results = {
            "organizations_processed": 0,
            "total_contacts": 0,
            "errors": [],
            "started_at": start_time.isoformat(),
        }

        for org_id in org_ids[:self.config.max_organizations_per_run]:
            try:
                pagerank = await engine.compute_pagerank(
                    organization_id=org_id,
                    damping_factor=self.config.pagerank_damping_factor,
                    max_iterations=self.config.pagerank_max_iterations,
                    tolerance=self.config.pagerank_tolerance,
                )

                # Persist scores
                await self._persist_pagerank_scores(org_id, pagerank)

                results["organizations_processed"] += 1
                results["total_contacts"] += len(pagerank)

                logger.debug(
                    "PageRank computed",
                    organization_id=org_id,
                    contacts=len(pagerank),
                )

            except Exception as e:
                logger.error(
                    "PageRank computation failed",
                    organization_id=org_id,
                    error=str(e),
                )
                results["errors"].append({
                    "organization_id": org_id,
                    "error": str(e),
                })

        results["completed_at"] = utc_now().isoformat()
        results["duration_seconds"] = (utc_now() - start_time).total_seconds()

        logger.info(
            "PageRank job completed",
            organizations=results["organizations_processed"],
            contacts=results["total_contacts"],
        )

        return results

    async def run_communities(
        self,
        organization_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Run only community detection.

        Suitable for daily scheduling.

        Args:
            organization_id: Optional org filter

        Returns:
            Job statistics
        """
        logger.info(
            "Starting community detection job",
            organization_id=organization_id,
        )

        start_time = utc_now()
        engine = await self._get_engine()

        org_ids = await self._get_organizations(organization_id)

        results = {
            "organizations_processed": 0,
            "total_communities": 0,
            "total_contacts": 0,
            "errors": [],
            "started_at": start_time.isoformat(),
        }

        for org_id in org_ids[:self.config.max_organizations_per_run]:
            try:
                communities = await engine.detect_communities(
                    organization_id=org_id,
                    max_iterations=self.config.community_max_iterations,
                )

                # Persist community assignments
                await self._persist_community_assignments(org_id, communities)

                # Count unique communities
                unique_communities = len(set(communities.values()))

                results["organizations_processed"] += 1
                results["total_communities"] += unique_communities
                results["total_contacts"] += len(communities)

                logger.debug(
                    "Communities detected",
                    organization_id=org_id,
                    communities=unique_communities,
                    contacts=len(communities),
                )

            except Exception as e:
                logger.error(
                    "Community detection failed",
                    organization_id=org_id,
                    error=str(e),
                )
                results["errors"].append({
                    "organization_id": org_id,
                    "error": str(e),
                })

        results["completed_at"] = utc_now().isoformat()
        results["duration_seconds"] = (utc_now() - start_time).total_seconds()

        logger.info(
            "Community detection job completed",
            organizations=results["organizations_processed"],
            communities=results["total_communities"],
        )

        return results

    async def run_betweenness(
        self,
        organization_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Run only betweenness centrality computation.

        Suitable for daily scheduling (computationally intensive).

        Args:
            organization_id: Optional org filter

        Returns:
            Job statistics
        """
        logger.info(
            "Starting betweenness centrality job",
            organization_id=organization_id,
        )

        start_time = utc_now()
        engine = await self._get_engine()

        org_ids = await self._get_organizations(organization_id)

        results = {
            "organizations_processed": 0,
            "total_contacts": 0,
            "high_betweenness_contacts": 0,
            "errors": [],
            "started_at": start_time.isoformat(),
        }

        for org_id in org_ids[:self.config.max_organizations_per_run]:
            try:
                betweenness = await engine.compute_betweenness_centrality(
                    organization_id=org_id,
                    sample_size=self.config.betweenness_sample_size,
                )

                # Persist scores
                await self._persist_betweenness_scores(org_id, betweenness)

                # Count high betweenness contacts (> 0.5)
                high_bc = sum(1 for score in betweenness.values() if score > 0.5)

                results["organizations_processed"] += 1
                results["total_contacts"] += len(betweenness)
                results["high_betweenness_contacts"] += high_bc

                logger.debug(
                    "Betweenness computed",
                    organization_id=org_id,
                    contacts=len(betweenness),
                    high_betweenness=high_bc,
                )

            except Exception as e:
                logger.error(
                    "Betweenness computation failed",
                    organization_id=org_id,
                    error=str(e),
                )
                results["errors"].append({
                    "organization_id": org_id,
                    "error": str(e),
                })

        results["completed_at"] = utc_now().isoformat()
        results["duration_seconds"] = (utc_now() - start_time).total_seconds()

        logger.info(
            "Betweenness job completed",
            organizations=results["organizations_processed"],
            contacts=results["total_contacts"],
        )

        return results

    async def _get_organizations(
        self,
        organization_id: str | None,
    ) -> list[str]:
        """Get list of organization IDs to process."""
        if organization_id:
            return [organization_id]

        graph = await get_graph_client()

        # Get all unique organization IDs from contacts
        result = await graph.query(
            """
            MATCH (c:Contact)
            WHERE c.organizationId IS NOT NULL
            RETURN DISTINCT c.organizationId as orgId
            LIMIT 1000
            """
        )

        return [r["orgId"] for r in (result or []) if r.get("orgId")]

    async def _process_organization(
        self,
        organization_id: str,
    ) -> dict[str, Any]:
        """Process all analytics for a single organization."""
        engine = await self._get_engine()

        # Compute all metrics
        pagerank = await engine.compute_pagerank(
            organization_id=organization_id,
            damping_factor=self.config.pagerank_damping_factor,
            max_iterations=self.config.pagerank_max_iterations,
            tolerance=self.config.pagerank_tolerance,
        )

        betweenness = await engine.compute_betweenness_centrality(
            organization_id=organization_id,
            sample_size=self.config.betweenness_sample_size,
        )

        communities = await engine.detect_communities(
            organization_id=organization_id,
            max_iterations=self.config.community_max_iterations,
        )

        # Persist all results
        updated = await engine.persist_analytics(
            organization_id=organization_id,
            pagerank=pagerank,
            betweenness=betweenness,
            communities=communities,
        )

        return {
            "pagerank_contacts": len(pagerank),
            "betweenness_contacts": len(betweenness),
            "communities_detected": len(set(communities.values())),
            "contacts_updated": updated,
        }

    async def _persist_pagerank_scores(
        self,
        organization_id: str,
        scores: dict[str, float],
    ) -> int:
        """Persist PageRank scores to Contact nodes."""
        graph = await get_graph_client()
        now = utc_now().isoformat()
        updated = 0

        for contact_id, score in scores.items():
            try:
                await graph.query(
                    """
                    MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                    SET c.pagerankScore = $score,
                        c.pagerankComputedAt = $now
                    """,
                    {
                        "contactId": contact_id,
                        "orgId": organization_id,
                        "score": score,
                        "now": now,
                    },
                )
                updated += 1
            except Exception as e:
                logger.warning(
                    "Failed to persist PageRank score",
                    contact_id=contact_id,
                    error=str(e),
                )

        return updated

    async def _persist_community_assignments(
        self,
        organization_id: str,
        communities: dict[str, str],
    ) -> int:
        """Persist community assignments to Contact nodes."""
        graph = await get_graph_client()
        now = utc_now().isoformat()
        updated = 0

        for contact_id, community_id in communities.items():
            try:
                await graph.query(
                    """
                    MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                    SET c.communityId = $communityId,
                        c.communityComputedAt = $now
                    """,
                    {
                        "contactId": contact_id,
                        "orgId": organization_id,
                        "communityId": community_id,
                        "now": now,
                    },
                )
                updated += 1
            except Exception as e:
                logger.warning(
                    "Failed to persist community assignment",
                    contact_id=contact_id,
                    error=str(e),
                )

        return updated

    async def _persist_betweenness_scores(
        self,
        organization_id: str,
        scores: dict[str, float],
    ) -> int:
        """Persist betweenness centrality scores to Contact nodes."""
        graph = await get_graph_client()
        now = utc_now().isoformat()
        updated = 0

        for contact_id, score in scores.items():
            try:
                await graph.query(
                    """
                    MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                    SET c.betweennessScore = $score,
                        c.betweennessComputedAt = $now
                    """,
                    {
                        "contactId": contact_id,
                        "orgId": organization_id,
                        "score": score,
                        "now": now,
                    },
                )
                updated += 1
            except Exception as e:
                logger.warning(
                    "Failed to persist betweenness score",
                    contact_id=contact_id,
                    error=str(e),
                )

        return updated


# =============================================================================
# Singleton and Convenience Functions
# =============================================================================

_analytics_job: GraphAnalyticsJob | None = None


async def get_analytics_job() -> GraphAnalyticsJob:
    """Get the singleton analytics job instance."""
    global _analytics_job
    if _analytics_job is None:
        _analytics_job = GraphAnalyticsJob()
    return _analytics_job


async def run_analytics_job(
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Run all analytics computations."""
    job = await get_analytics_job()
    return await job.run_all(organization_id)


async def run_pagerank_job(
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Run PageRank computation only."""
    job = await get_analytics_job()
    return await job.run_pagerank(organization_id)


async def run_communities_job(
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Run community detection only."""
    job = await get_analytics_job()
    return await job.run_communities(organization_id)


async def run_betweenness_job(
    organization_id: str | None = None,
) -> dict[str, Any]:
    """Run betweenness centrality computation only."""
    job = await get_analytics_job()
    return await job.run_betweenness(organization_id)


# =============================================================================
# Analytics Results Cache
# =============================================================================


class AnalyticsCache:
    """
    Simple in-memory cache for analytics results.

    Reduces graph queries for frequently accessed analytics.
    """

    def __init__(self, ttl_seconds: int = 3600):
        """Initialize cache with TTL."""
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, tuple[Any, datetime]] = {}

    def get(self, key: str) -> Any | None:
        """Get cached value if not expired."""
        if key in self._cache:
            value, timestamp = self._cache[key]
            if (utc_now() - timestamp).total_seconds() < self.ttl_seconds:
                return value
            del self._cache[key]
        return None

    def set(self, key: str, value: Any) -> None:
        """Set cached value with current timestamp."""
        self._cache[key] = (value, utc_now())

    def invalidate(self, pattern: str | None = None) -> int:
        """Invalidate cache entries matching pattern."""
        if pattern is None:
            count = len(self._cache)
            self._cache.clear()
            return count

        to_delete = [k for k in self._cache if pattern in k]
        for k in to_delete:
            del self._cache[k]
        return len(to_delete)


# Global analytics cache
_analytics_cache = AnalyticsCache(ttl_seconds=3600)


async def get_cached_pagerank(organization_id: str) -> dict[str, float] | None:
    """Get cached PageRank scores."""
    return _analytics_cache.get(f"pagerank:{organization_id}")


async def get_cached_communities(organization_id: str) -> dict[str, str] | None:
    """Get cached community assignments."""
    return _analytics_cache.get(f"communities:{organization_id}")


async def get_cached_betweenness(organization_id: str) -> dict[str, float] | None:
    """Get cached betweenness scores."""
    return _analytics_cache.get(f"betweenness:{organization_id}")
