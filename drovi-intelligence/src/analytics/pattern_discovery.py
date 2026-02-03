"""
Pattern Discovery.

Auto-discovers recurring patterns via embedding clustering of commitments/decisions.
Creates PatternCandidate nodes for user promotion into Patterns.
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from typing import Any

import structlog

from src.graph.client import get_graph_client

logger = structlog.get_logger()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _extract_terms(texts: list[str]) -> list[str]:
    terms: list[str] = []
    for text in texts:
        if not text:
            continue
        tokens = [t.strip(".,:;!?") for t in text.split() if len(t) > 2]
        for token in tokens:
            if token[0].isupper():
                terms.append(token)
    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for term in terms:
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(term)
    return deduped[:10]


def _cluster_embeddings(
    items: list[dict[str, Any]],
    similarity_threshold: float,
) -> list[dict[str, Any]]:
    clusters: list[dict[str, Any]] = []

    for item in items:
        embedding = item.get("embedding")
        if not embedding:
            continue
        assigned = False
        for cluster in clusters:
            score = _cosine_similarity(embedding, cluster["centroid"])
            if score >= similarity_threshold:
                cluster["members"].append(item)
                cluster["scores"].append(score)
                # Update centroid (simple average)
                count = len(cluster["members"])
                cluster["centroid"] = [
                    (cluster["centroid"][i] * (count - 1) + embedding[i]) / count
                    for i in range(len(embedding))
                ]
                assigned = True
                break
        if not assigned:
            clusters.append({
                "members": [item],
                "centroid": list(embedding),
                "scores": [],
            })

    return clusters


async def _fetch_uio_embeddings(
    organization_id: str,
    label: str,
    limit: int,
) -> list[dict[str, Any]]:
    graph = await get_graph_client()
    results = await graph.query(
        f"""
        MATCH (u:{label} {{organizationId: $orgId}})
        WHERE u.embedding IS NOT NULL
        RETURN u.id as id,
               u.title as title,
               u.description as description,
               u.embedding as embedding,
               u.status as status,
               u.priority as priority
        LIMIT $limit
        """,
        {"orgId": organization_id, "limit": limit},
    )
    return results or []


async def discover_pattern_candidates(
    organization_id: str,
    min_cluster_size: int = 3,
    similarity_threshold: float = 0.85,
    max_nodes: int = 500,
) -> list[dict[str, Any]]:
    """
    Discover pattern candidates for an organization.

    Returns list of candidate dicts.
    """
    graph = await get_graph_client()
    now = _utc_now()

    commitments = await _fetch_uio_embeddings(organization_id, "Commitment", max_nodes)
    decisions = await _fetch_uio_embeddings(organization_id, "Decision", max_nodes)

    candidates: list[dict[str, Any]] = []
    for label, items in (("commitment", commitments), ("decision", decisions)):
        clusters = _cluster_embeddings(items, similarity_threshold)
        for cluster in clusters:
            members = cluster["members"]
            if len(members) < min_cluster_size:
                continue
            member_ids = sorted(m["id"] for m in members if m.get("id"))
            if not member_ids:
                continue
            digest = hashlib.sha256("|".join(member_ids).encode("utf-8")).hexdigest()[:16]
            sample_titles = [m.get("title") for m in members if m.get("title")]
            top_terms = _extract_terms(sample_titles)
            confidence_boost = min(0.3, 0.05 + 0.02 * len(members))

            candidate = {
                "id": digest,
                "organization_id": organization_id,
                "candidate_type": label,
                "member_ids": member_ids,
                "member_count": len(member_ids),
                "sample_titles": sample_titles[:10],
                "top_terms": top_terms,
                "centroid_embedding": cluster["centroid"],
                "confidence_boost": confidence_boost,
                "updated_at": now.isoformat(),
            }

            # Persist/update candidate in graph
            await graph.query(
                """
                MERGE (c:PatternCandidate {id: $id})
                SET c.organizationId = $orgId,
                    c.candidateType = $candidate_type,
                    c.memberIds = $member_ids,
                    c.memberCount = $member_count,
                    c.sampleTitles = $sample_titles,
                    c.topTerms = $top_terms,
                    c.centroidEmbedding = $centroid_embedding,
                    c.confidenceBoost = $confidence_boost,
                    c.updatedAt = $updated_at,
                    c.createdAt = coalesce(c.createdAt, $updated_at)
                """,
                {
                    "id": candidate["id"],
                    "orgId": organization_id,
                    "candidate_type": label,
                    "member_ids": candidate["member_ids"],
                    "member_count": candidate["member_count"],
                    "sample_titles": candidate["sample_titles"],
                    "top_terms": candidate["top_terms"],
                    "centroid_embedding": candidate["centroid_embedding"],
                    "confidence_boost": candidate["confidence_boost"],
                    "updated_at": now.isoformat(),
                },
            )

            candidates.append(candidate)

    logger.info(
        "Pattern candidates discovered",
        organization_id=organization_id,
        candidates=len(candidates),
    )

    return candidates
