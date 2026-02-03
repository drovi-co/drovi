"""
Pattern Discovery and Promotion API.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.analytics.pattern_discovery import discover_pattern_candidates
from src.graph.client import get_graph_client

router = APIRouter(prefix="/patterns", tags=["Patterns"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


class PatternCandidateResponse(BaseModel):
    id: str
    organization_id: str
    candidate_type: str
    member_count: int
    member_ids: list[str]
    sample_titles: list[str] = Field(default_factory=list)
    top_terms: list[str] = Field(default_factory=list)
    confidence_boost: float
    updated_at: str


class DiscoverRequest(BaseModel):
    organization_id: str
    min_cluster_size: int = 3
    similarity_threshold: float = 0.85
    max_nodes: int = 500


class PromoteRequest(BaseModel):
    organization_id: str
    name: str | None = None
    description: str | None = None
    typical_action: str | None = None
    confidence_boost: float | None = None
    domain: str | None = None
    salient_features: list[str] = Field(default_factory=list)
    typical_expectations: list[str] = Field(default_factory=list)
    plausible_goals: list[str] = Field(default_factory=list)
    semantic_threshold: float = 0.8


class PromoteResponse(BaseModel):
    pattern_id: str
    promoted: bool


@router.get("/candidates", response_model=list[PatternCandidateResponse])
async def list_candidates(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org_id(ctx, organization_id)
    graph = await get_graph_client()
    results = await graph.query(
        """
        MATCH (c:PatternCandidate {organizationId: $orgId})
        RETURN c.id as id,
               c.organizationId as organization_id,
               c.candidateType as candidate_type,
               c.memberCount as member_count,
               c.memberIds as member_ids,
               c.sampleTitles as sample_titles,
               c.topTerms as top_terms,
               c.confidenceBoost as confidence_boost,
               c.updatedAt as updated_at
        ORDER BY c.updatedAt DESC
        LIMIT 200
        """,
        {"orgId": organization_id},
    )
    return results or []


@router.post("/candidates/discover", response_model=list[PatternCandidateResponse])
async def discover_candidates(
    request: DiscoverRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    return await discover_pattern_candidates(
        organization_id=request.organization_id,
        min_cluster_size=request.min_cluster_size,
        similarity_threshold=request.similarity_threshold,
        max_nodes=request.max_nodes,
    )


@router.post("/candidates/{candidate_id}/promote", response_model=PromoteResponse)
async def promote_candidate(
    candidate_id: str,
    request: PromoteRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    graph = await get_graph_client()

    candidate = await graph.query(
        """
        MATCH (c:PatternCandidate {id: $id, organizationId: $orgId})
        RETURN c.id as id,
               c.topTerms as top_terms,
               c.sampleTitles as sample_titles,
               c.centroidEmbedding as centroid_embedding,
               c.confidenceBoost as confidence_boost
        """,
        {"id": candidate_id, "orgId": request.organization_id},
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Pattern candidate not found")

    candidate = candidate[0]
    now = _utc_now()
    pattern_id = f"pattern_{candidate_id}"

    name = request.name or (candidate.get("top_terms") or ["Pattern"])[0]
    description = request.description or "Auto-promoted pattern from clustering"
    confidence_boost = request.confidence_boost or candidate.get("confidence_boost") or 0.15

    await graph.query(
        """
        MERGE (p:Pattern {id: $pattern_id})
        SET p.organizationId = $orgId,
            p.name = $name,
            p.description = $description,
            p.triggerEmbedding = $embedding,
            p.semanticThreshold = $semantic_threshold,
            p.salientFeatures = $salient_features,
            p.typicalExpectations = $typical_expectations,
            p.typicalAction = $typical_action,
            p.plausibleGoals = $plausible_goals,
            p.domain = $domain,
            p.confidenceBoost = $confidence_boost,
            p.confidenceThreshold = 0.7,
            p.isActive = true,
            p.accuracyRate = 1.0,
            p.timesMatched = 0,
            p.timesConfirmed = 0,
            p.timesRejected = 0,
            p.createdAt = coalesce(p.createdAt, $now),
            p.updatedAt = $now
        """,
        {
            "pattern_id": pattern_id,
            "orgId": request.organization_id,
            "name": name,
            "description": description,
            "embedding": candidate.get("centroid_embedding"),
            "semantic_threshold": request.semantic_threshold,
            "salient_features": request.salient_features or candidate.get("top_terms") or [],
            "typical_expectations": request.typical_expectations,
            "typical_action": request.typical_action,
            "plausible_goals": request.plausible_goals,
            "domain": request.domain,
            "confidence_boost": confidence_boost,
            "now": now.isoformat(),
        },
    )

    await graph.query(
        """
        MATCH (c:PatternCandidate {id: $id, organizationId: $orgId})
        SET c.promotedPatternId = $pattern_id,
            c.promotedAt = $now
        """,
        {"id": candidate_id, "orgId": request.organization_id, "pattern_id": pattern_id, "now": now.isoformat()},
    )

    return PromoteResponse(pattern_id=pattern_id, promoted=True)
