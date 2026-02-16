"""Graph analytics engine for contact intelligence.

This module was split out of `src/graph/client.py` to keep the public graph
client small enough to satisfy our LOC guardrails while preserving behavior.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog

from src.graph.client import DroviGraph, get_graph_client

logger = structlog.get_logger()


class GraphAnalyticsEngine:
    """
    Graph analytics engine for contact intelligence.

    Provides:
    - PageRank computation (influence scoring)
    - Community detection (Label Propagation)
    - Betweenness centrality (bridge detection)
    - Introduction path finding
    """

    def __init__(self, graph: DroviGraph):
        self.graph = graph

    async def compute_pagerank(
        self,
        organization_id: str,
        damping_factor: float = 0.85,
        max_iterations: int = 20,
        tolerance: float = 0.0001,
    ) -> dict[str, float]:
        """
        Compute PageRank for all contacts in an organization.

        PageRank measures influence - contacts who communicate with
        other influential contacts get higher scores.
        """
        try:
            contacts_result = await self.graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                RETURN c.id as id
                """,
                {"orgId": organization_id},
            )

            if not contacts_result:
                return {}

            contact_ids = [r["id"] for r in contacts_result]
            n = len(contact_ids)
            if n == 0:
                return {}

            edges_result = await self.graph.query(
                """
                MATCH (a:Contact {organizationId: $orgId})-[r:COMMUNICATES_WITH]->(b:Contact {organizationId: $orgId})
                RETURN a.id as source, b.id as target, COALESCE(r.weight, 1.0) as weight
                """,
                {"orgId": organization_id},
            )

            outlinks: dict[str, list[tuple[str, float]]] = {cid: [] for cid in contact_ids}
            inlinks: dict[str, list[tuple[str, float]]] = {cid: [] for cid in contact_ids}

            for edge in edges_result:
                source = edge["source"]
                target = edge["target"]
                weight = edge.get("weight", 1.0) or 1.0
                if source in outlinks and target in inlinks:
                    outlinks[source].append((target, weight))
                    inlinks[target].append((source, weight))

            pagerank = {cid: 1.0 / n for cid in contact_ids}

            for iteration in range(max_iterations):
                new_pagerank: dict[str, float] = {}
                max_diff = 0.0

                for cid in contact_ids:
                    incoming_sum = 0.0
                    for source_id, weight in inlinks[cid]:
                        out_degree = len(outlinks[source_id])
                        if out_degree > 0:
                            incoming_sum += pagerank[source_id] * weight / out_degree

                    new_pr = (1 - damping_factor) / n + damping_factor * incoming_sum
                    new_pagerank[cid] = new_pr
                    max_diff = max(max_diff, abs(new_pr - pagerank[cid]))

                pagerank = new_pagerank

                if max_diff < tolerance:
                    logger.debug("PageRank converged", iteration=iteration)
                    break

            max_pr = max(pagerank.values()) if pagerank else 1.0
            if max_pr > 0:
                pagerank = {k: v / max_pr for k, v in pagerank.items()}

            return pagerank
        except Exception as e:
            logger.error("PageRank computation failed", error=str(e))
            return {}

    async def compute_betweenness_centrality(
        self,
        organization_id: str,
        sample_size: int | None = 100,
    ) -> dict[str, float]:
        """
        Compute betweenness centrality (approximation).

        Betweenness centrality identifies "bridge" contacts who
        connect otherwise disconnected groups.
        """
        try:
            contacts_result = await self.graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                RETURN c.id as id
                """,
                {"orgId": organization_id},
            )

            if not contacts_result:
                return {}

            contact_ids = [r["id"] for r in contacts_result]
            n = len(contact_ids)
            if n < 3:
                return {cid: 0.0 for cid in contact_ids}

            edges_result = await self.graph.query(
                """
                MATCH (a:Contact {organizationId: $orgId})-[:COMMUNICATES_WITH]-(b:Contact {organizationId: $orgId})
                WHERE a.id < b.id
                RETURN DISTINCT a.id as source, b.id as target
                """,
                {"orgId": organization_id},
            )

            neighbors: dict[str, set[str]] = {cid: set() for cid in contact_ids}
            for edge in edges_result:
                source = edge["source"]
                target = edge["target"]
                if source in neighbors and target in neighbors:
                    neighbors[source].add(target)
                    neighbors[target].add(source)

            betweenness = {cid: 0.0 for cid in contact_ids}

            import random

            sources = contact_ids
            if sample_size and n > sample_size:
                sources = random.sample(contact_ids, sample_size)

            for s in sources:
                stack: list[str] = []
                pred: dict[str, list[str]] = {cid: [] for cid in contact_ids}
                sigma = {cid: 0.0 for cid in contact_ids}
                sigma[s] = 1.0
                dist = {cid: -1 for cid in contact_ids}
                dist[s] = 0

                queue = [s]
                while queue:
                    v = queue.pop(0)
                    stack.append(v)
                    for w in neighbors[v]:
                        if dist[w] < 0:
                            queue.append(w)
                            dist[w] = dist[v] + 1
                        if dist[w] == dist[v] + 1:
                            sigma[w] += sigma[v]
                            pred[w].append(v)

                delta = {cid: 0.0 for cid in contact_ids}
                while stack:
                    w = stack.pop()
                    for v in pred[w]:
                        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w])
                    if w != s:
                        betweenness[w] += delta[w]

            scale = 1.0
            if sample_size and n > sample_size:
                scale = n / sample_size
            max_bc = max(betweenness.values()) if betweenness else 1.0
            if max_bc > 0:
                betweenness = {k: (v * scale) / max_bc for k, v in betweenness.items()}

            return betweenness
        except Exception as e:
            logger.error("Betweenness centrality computation failed", error=str(e))
            return {}

    async def detect_communities(
        self,
        organization_id: str,
        max_iterations: int = 10,
    ) -> dict[str, str]:
        """
        Detect communities using Label Propagation Algorithm.

        Groups contacts into communities based on communication patterns.
        """
        try:
            contacts_result = await self.graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                RETURN c.id as id
                """,
                {"orgId": organization_id},
            )

            if not contacts_result:
                return {}

            contact_ids = [r["id"] for r in contacts_result]

            edges_result = await self.graph.query(
                """
                MATCH (a:Contact {organizationId: $orgId})-[r:COMMUNICATES_WITH]-(b:Contact {organizationId: $orgId})
                WHERE a.id < b.id
                RETURN DISTINCT a.id as source, b.id as target, COALESCE(r.weight, 1.0) as weight
                """,
                {"orgId": organization_id},
            )

            neighbors: dict[str, list[tuple[str, float]]] = {cid: [] for cid in contact_ids}
            for edge in edges_result:
                source = edge["source"]
                target = edge["target"]
                weight = edge.get("weight", 1.0) or 1.0
                if source in neighbors and target in neighbors:
                    neighbors[source].append((target, weight))
                    neighbors[target].append((source, weight))

            labels = {cid: cid for cid in contact_ids}

            import random

            for iteration in range(max_iterations):
                changed = False
                shuffled = contact_ids.copy()
                random.shuffle(shuffled)

                for node in shuffled:
                    if not neighbors[node]:
                        continue

                    label_weights: dict[str, float] = {}
                    for neighbor, weight in neighbors[node]:
                        label = labels[neighbor]
                        label_weights[label] = label_weights.get(label, 0) + weight

                    if label_weights:
                        max_weight = max(label_weights.values())
                        best_labels = [l for l, w in label_weights.items() if w == max_weight]
                        new_label = random.choice(best_labels)
                        if labels[node] != new_label:
                            labels[node] = new_label
                            changed = True

                if not changed:
                    logger.debug("Community detection converged", iteration=iteration)
                    break

            unique_labels = list(set(labels.values()))
            label_map = {old: f"community_{i}" for i, old in enumerate(unique_labels)}
            return {k: label_map[v] for k, v in labels.items()}
        except Exception as e:
            logger.error("Community detection failed", error=str(e))
            return {}

    async def find_introduction_paths(
        self,
        organization_id: str,
        from_contact_id: str,
        to_contact_id: str,
        max_hops: int = 3,
    ) -> list[list[str]]:
        """Find introduction paths between two contacts."""
        try:
            result = await self.graph.query(
                f"""
                MATCH path = shortestPath(
                    (from:Contact {{id: $fromId, organizationId: $orgId}})-
                    [:COMMUNICATES_WITH*1..{max_hops}]-
                    (to:Contact {{id: $toId, organizationId: $orgId}})
                )
                RETURN [n IN nodes(path) | n.id] as pathIds
                LIMIT 5
                """,
                {
                    "fromId": from_contact_id,
                    "toId": to_contact_id,
                    "orgId": organization_id,
                },
            )

            if result:
                return [r["pathIds"] for r in result]
            return []
        except Exception as e:
            logger.warning("Introduction path query failed", error=str(e))
            return []

    async def find_potential_introducers(
        self,
        organization_id: str,
        user_contact_id: str,
        target_role: str = "decision_maker",
        max_hops: int = 2,
        limit: int = 10,
    ) -> list[dict]:
        """Find contacts who can introduce you to decision-makers."""
        try:
            result = await self.graph.query(
                f"""
                MATCH path = (user:Contact {{id: $userId, organizationId: $orgId}})-
                    [:COMMUNICATES_WITH*1..{max_hops}]-
                    (target:Contact {{organizationId: $orgId, roleType: $targetRole}})
                WHERE user <> target
                WITH path, target, length(path) as hops
                ORDER BY hops ASC
                LIMIT $limit
                RETURN
                    target.id as targetId,
                    target.displayName as targetName,
                    target.company as targetCompany,
                    [n IN nodes(path)[1..-1] | n.id][0] as introducerId,
                    [n IN nodes(path)[1..-1] | n.displayName][0] as introducerName,
                    hops
                """,
                {
                    "userId": user_contact_id,
                    "orgId": organization_id,
                    "targetRole": target_role,
                    "limit": limit,
                },
            )

            return result if result else []
        except Exception as e:
            logger.warning("Potential introducers query failed", error=str(e))
            return []

    async def persist_analytics(
        self,
        organization_id: str,
        pagerank: dict[str, float],
        betweenness: dict[str, float],
        communities: dict[str, str],
    ) -> int:
        """Persist computed analytics to Contact nodes."""
        updated = 0

        for contact_id in pagerank:
            try:
                pr_score = pagerank.get(contact_id, 0.0)
                bc_score = betweenness.get(contact_id, 0.0)
                community = communities.get(contact_id)

                await self.graph.query(
                    """
                    MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                    SET c.pagerankScore = $pr,
                        c.betweennessScore = $bc,
                        c.communityId = $community,
                        c.analyticsUpdatedAt = $now
                    """,
                    {
                        "contactId": contact_id,
                        "orgId": organization_id,
                        "pr": pr_score,
                        "bc": bc_score,
                        "community": community,
                        "now": datetime.utcnow().isoformat(),
                    },
                )
                updated += 1
            except Exception as e:
                logger.warning(
                    "Failed to persist analytics for contact",
                    contact_id=contact_id,
                    error=str(e),
                )

        return updated


async def get_analytics_engine() -> GraphAnalyticsEngine:
    """Get a graph analytics engine instance."""
    graph = await get_graph_client()
    return GraphAnalyticsEngine(graph)

