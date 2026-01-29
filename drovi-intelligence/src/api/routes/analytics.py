"""
Analytics API Routes

Endpoints for organizational analytics and blindspot detection.
Implements Deming's System of Profound Knowledge.

From the "Trillion Dollar Hole" research:
- Systems cannot understand themselves from within
- Need meta-analysis to surface blindspots
- Track decision patterns, commitment patterns, communication bottlenecks
"""

from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope

logger = structlog.get_logger()

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class BlindspotIndicatorResponse(BaseModel):
    """A detected organizational blindspot."""

    id: str
    blindspot_type: str
    title: str
    description: str
    severity: str  # low, medium, high
    evidence_ids: list[str] = Field(default_factory=list)
    suggested_action: str
    detected_at: datetime


class OrganizationProfileResponse(BaseModel):
    """Organization intelligence profile with blindspot analysis."""

    organization_id: str
    analysis_period_days: int
    generated_at: datetime

    # Summary metrics
    total_commitments: int = 0
    open_commitments: int = 0
    commitment_fulfillment_rate: float = 0.0
    total_decisions: int = 0
    decision_reversal_rate: float = 0.0
    total_risks_detected: int = 0
    risks_mitigated: int = 0

    # Blindspots
    blindspots: list[BlindspotIndicatorResponse] = Field(default_factory=list)
    blindspot_count_by_type: dict[str, int] = Field(default_factory=dict)
    blindspot_count_by_severity: dict[str, int] = Field(default_factory=dict)

    # Overall health score
    organizational_health_score: float = 0.0


class CalibrationMetricsResponse(BaseModel):
    """Calibration metrics for prediction accuracy."""

    organization_id: str
    prediction_type: str | None = None
    analysis_period_days: int

    total_predictions: int = 0
    resolved_predictions: int = 0
    brier_score: float = 0.0
    reliability: float = 0.0
    resolution: float = 0.0
    uncertainty: float = 0.0
    adjustment_factor: float = 1.0
    calibration_buckets: list[dict] = Field(default_factory=list)

    interpretation: str = ""


class SignalNoiseStatsResponse(BaseModel):
    """Statistics about signal vs noise classification."""

    organization_id: str
    analysis_period_days: int

    total_intelligence: int = 0
    signals: int = 0
    noise: int = 0
    uncertain: int = 0

    signal_percentage: float = 0.0
    noise_percentage: float = 0.0

    by_type: dict[str, dict[str, int]] = Field(default_factory=dict)
    avg_deviation_score: float = 0.0
    avg_actionability_score: float = 0.0


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/profile/{organization_id}", response_model=OrganizationProfileResponse)
async def get_organization_profile(
    organization_id: str,
    days: int = Query(30, ge=7, le=365, description="Analysis period in days"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get comprehensive organization intelligence profile.

    Includes:
    - Summary metrics (commitments, decisions, risks)
    - Detected blindspots with severity and evidence
    - Organizational health score

    MCP Tool: get_organization_profile

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Getting organization profile",
        organization_id=organization_id,
        days=days,
        key_id=ctx.key_id,
    )

    service = await get_blindspot_detection_service()
    profile = await service.analyze_organization(
        organization_id=organization_id,
        days=days,
    )

    # Convert blindspots to response format
    blindspots = [
        BlindspotIndicatorResponse(
            id=b.id,
            blindspot_type=b.blindspot_type.value,
            title=b.title,
            description=b.description,
            severity=b.severity.value,
            evidence_ids=b.evidence_ids,
            suggested_action=b.suggested_action,
            detected_at=b.detected_at,
        )
        for b in profile.blindspots
    ]

    # Count by type and severity
    by_type = {}
    by_severity = {}
    for b in profile.blindspots:
        by_type[b.blindspot_type.value] = by_type.get(b.blindspot_type.value, 0) + 1
        by_severity[b.severity.value] = by_severity.get(b.severity.value, 0) + 1

    return OrganizationProfileResponse(
        organization_id=organization_id,
        analysis_period_days=days,
        generated_at=profile.generated_at,
        total_commitments=profile.total_commitments,
        open_commitments=profile.open_commitments,
        commitment_fulfillment_rate=profile.commitment_fulfillment_rate,
        total_decisions=profile.total_decisions,
        decision_reversal_rate=profile.decision_reversal_rate,
        total_risks_detected=profile.total_risks_detected,
        risks_mitigated=profile.risks_mitigated,
        blindspots=blindspots,
        blindspot_count_by_type=by_type,
        blindspot_count_by_severity=by_severity,
        organizational_health_score=profile.organizational_health_score,
    )


@router.get("/blindspots/{organization_id}")
async def list_blindspots(
    organization_id: str,
    days: int = Query(30, ge=7, le=365),
    severity: str | None = Query(None, description="Filter by severity: low, medium, high"),
    blindspot_type: str | None = Query(None, description="Filter by type"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    List detected organizational blindspots.

    MCP Tool: list_blindspots

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Listing blindspots",
        organization_id=organization_id,
        days=days,
        severity=severity,
        blindspot_type=blindspot_type,
        key_id=ctx.key_id,
    )

    service = await get_blindspot_detection_service()
    profile = await service.analyze_organization(
        organization_id=organization_id,
        days=days,
    )

    # Filter blindspots
    blindspots = profile.blindspots
    if severity:
        blindspots = [b for b in blindspots if b.severity.value == severity]
    if blindspot_type:
        blindspots = [b for b in blindspots if b.blindspot_type.value == blindspot_type]

    return {
        "organization_id": organization_id,
        "blindspots": [
            {
                "id": b.id,
                "type": b.blindspot_type.value,
                "title": b.title,
                "description": b.description,
                "severity": b.severity.value,
                "evidence_ids": b.evidence_ids,
                "suggested_action": b.suggested_action,
                "detected_at": b.detected_at.isoformat(),
            }
            for b in blindspots
        ],
        "total": len(blindspots),
    }


@router.post("/blindspots/{organization_id}/{blindspot_id}/dismiss")
async def dismiss_blindspot(
    organization_id: str,
    blindspot_id: str,
    reason: str = Query(..., description="Reason for dismissal"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Dismiss a blindspot with feedback.

    This feeds back into the detection system to improve accuracy.

    MCP Tool: dismiss_blindspot

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Dismissing blindspot",
        organization_id=organization_id,
        blindspot_id=blindspot_id,
        reason=reason,
        key_id=ctx.key_id,
    )

    service = await get_blindspot_detection_service()
    success = await service.dismiss_blindspot(
        organization_id=organization_id,
        blindspot_id=blindspot_id,
        reason=reason,
    )

    if not success:
        raise HTTPException(status_code=404, detail="Blindspot not found")

    return {
        "blindspot_id": blindspot_id,
        "dismissed": True,
        "reason": reason,
    }


@router.get("/calibration/{organization_id}", response_model=CalibrationMetricsResponse)
async def get_calibration_metrics(
    organization_id: str,
    prediction_type: str | None = Query(None, description="Filter by prediction type"),
    days: int = Query(90, ge=7, le=365),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get confidence calibration metrics.

    Uses DiBello's Strategic Rehearsal methodology with Brier score decomposition.

    MCP Tool: get_calibration_metrics

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.finetuning.calibration import (
        PredictionType,
        get_calibration_service,
        interpret_calibration,
    )

    logger.info(
        "Getting calibration metrics",
        organization_id=organization_id,
        prediction_type=prediction_type,
        days=days,
        key_id=ctx.key_id,
    )

    service = await get_calibration_service()

    # Convert prediction type if provided
    pred_type = None
    if prediction_type:
        try:
            pred_type = PredictionType(prediction_type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid prediction type. Valid types: {[t.value for t in PredictionType]}",
            )

    metrics = await service.get_calibration_metrics(
        organization_id=organization_id,
        prediction_type=pred_type,
        days=days,
    )

    interpretation = interpret_calibration(metrics)

    return CalibrationMetricsResponse(
        organization_id=organization_id,
        prediction_type=prediction_type,
        analysis_period_days=days,
        total_predictions=metrics.total_predictions,
        resolved_predictions=metrics.resolved_predictions,
        brier_score=metrics.brier_score,
        reliability=metrics.reliability,
        resolution=metrics.resolution,
        uncertainty=metrics.uncertainty,
        adjustment_factor=metrics.adjustment_factor,
        calibration_buckets=metrics.calibration_buckets,
        interpretation=interpretation,
    )


@router.get("/signal-noise/{organization_id}", response_model=SignalNoiseStatsResponse)
async def get_signal_noise_stats(
    organization_id: str,
    days: int = Query(30, ge=7, le=365),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get statistics about signal vs noise classification.

    Uses Wheeler's Statistical Process Control methodology.

    MCP Tool: get_signal_noise_stats

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Getting signal/noise stats",
        organization_id=organization_id,
        days=days,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    # Query UIOs with signal classification
    # Note: FalkorDB doesn't support datetime() function, so we query all and filter in Python
    try:
        result = await graph.query(
            """
            MATCH (u:UIO)
            WHERE u.organizationId = $org_id
            AND u.signalClassification IS NOT NULL
            RETURN
                u.uioType as uio_type,
                u.signalClassification as classification,
                u.deviationScore as deviation_score,
                u.actionabilityScore as actionability_score,
                count(*) as count
            """,
            {"org_id": organization_id},
        )
    except Exception as e:
        logger.warning("Signal/noise query failed", error=str(e))
        result = []

    total = 0
    signals = 0
    noise = 0
    uncertain = 0
    by_type: dict[str, dict[str, int]] = {}
    total_deviation = 0.0
    total_actionability = 0.0
    deviation_count = 0
    actionability_count = 0

    for row in result or []:
        count = row.get("count", 0)
        total += count
        classification = row.get("classification", "uncertain")
        uio_type = row.get("uio_type", "unknown")

        if classification == "signal":
            signals += count
        elif classification == "noise":
            noise += count
        else:
            uncertain += count

        # By type
        if uio_type not in by_type:
            by_type[uio_type] = {"signal": 0, "noise": 0, "uncertain": 0}
        by_type[uio_type][classification] = by_type[uio_type].get(classification, 0) + count

        # Scores
        if row.get("deviation_score") is not None:
            total_deviation += row["deviation_score"] * count
            deviation_count += count
        if row.get("actionability_score") is not None:
            total_actionability += row["actionability_score"] * count
            actionability_count += count

    return SignalNoiseStatsResponse(
        organization_id=organization_id,
        analysis_period_days=days,
        total_intelligence=total,
        signals=signals,
        noise=noise,
        uncertain=uncertain,
        signal_percentage=signals / total * 100 if total > 0 else 0,
        noise_percentage=noise / total * 100 if total > 0 else 0,
        by_type=by_type,
        avg_deviation_score=total_deviation / deviation_count if deviation_count > 0 else 0,
        avg_actionability_score=total_actionability / actionability_count if actionability_count > 0 else 0,
    )


@router.get("/patterns/{organization_id}")
async def list_patterns(
    organization_id: str,
    domain: str | None = Query(None, description="Filter by domain"),
    active_only: bool = Query(True, description="Only active patterns"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    List recognition patterns for the organization.

    Uses Klein's Recognition-Primed Decision methodology.

    MCP Tool: list_patterns

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Listing patterns",
        organization_id=organization_id,
        domain=domain,
        active_only=active_only,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    query = """
        MATCH (p:Pattern)
        WHERE p.organizationId = $org_id
    """
    params: dict = {"org_id": organization_id}

    if active_only:
        query += " AND p.isActive = true"
    if domain:
        query += " AND p.domain = $domain"
        params["domain"] = domain

    query += """
        RETURN p.id as id,
               p.name as name,
               p.description as description,
               p.domain as domain,
               p.salientFeatures as salient_features,
               p.typicalAction as typical_action,
               p.confidenceThreshold as confidence_threshold,
               p.timesMatched as times_matched,
               p.timesConfirmed as times_confirmed,
               p.timesRejected as times_rejected,
               p.accuracyRate as accuracy_rate,
               p.isActive as is_active,
               p.createdAt as created_at
        ORDER BY p.timesMatched DESC
    """

    result = await graph.query(query, params)

    return {
        "organization_id": organization_id,
        "patterns": [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "description": row.get("description"),
                "domain": row.get("domain"),
                "salient_features": row.get("salient_features", []),
                "typical_action": row.get("typical_action"),
                "confidence_threshold": row.get("confidence_threshold", 0.7),
                "times_matched": row.get("times_matched", 0),
                "times_confirmed": row.get("times_confirmed", 0),
                "times_rejected": row.get("times_rejected", 0),
                "accuracy_rate": row.get("accuracy_rate", 1.0),
                "is_active": row.get("is_active", True),
                "created_at": row.get("created_at"),
            }
            for row in (result or [])
        ],
        "total": len(result or []),
    }


@router.post("/patterns/{organization_id}/{pattern_id}/feedback")
async def record_pattern_feedback(
    organization_id: str,
    pattern_id: str,
    was_correct: bool = Query(..., description="Whether the pattern match was correct"),
    reason: str | None = Query(None, description="Optional reason for feedback"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Record feedback on a pattern match.

    Updates pattern accuracy metrics.

    MCP Tool: record_pattern_feedback

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Recording pattern feedback",
        organization_id=organization_id,
        pattern_id=pattern_id,
        was_correct=was_correct,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    if was_correct:
        await graph.query(
            """
            MATCH (p:Pattern {id: $pattern_id, organizationId: $org_id})
            SET p.timesConfirmed = COALESCE(p.timesConfirmed, 0) + 1,
                p.accuracyRate = toFloat(COALESCE(p.timesConfirmed, 0) + 1) /
                                 (COALESCE(p.timesConfirmed, 0) + COALESCE(p.timesRejected, 0) + 1)
            RETURN p.id
            """,
            {"pattern_id": pattern_id, "org_id": organization_id},
        )
    else:
        await graph.query(
            """
            MATCH (p:Pattern {id: $pattern_id, organizationId: $org_id})
            SET p.timesRejected = COALESCE(p.timesRejected, 0) + 1,
                p.accuracyRate = toFloat(COALESCE(p.timesConfirmed, 0)) /
                                 (COALESCE(p.timesConfirmed, 0) + COALESCE(p.timesRejected, 0) + 1)
            RETURN p.id
            """,
            {"pattern_id": pattern_id, "org_id": organization_id},
        )

    return {
        "pattern_id": pattern_id,
        "feedback_recorded": True,
        "was_correct": was_correct,
        "reason": reason,
    }


@router.get("/health/{organization_id}")
async def get_organizational_health(
    organization_id: str,
    days: int = Query(30, ge=7, le=365),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get overall organizational health score with breakdown.

    MCP Tool: get_organizational_health

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Getting organizational health",
        organization_id=organization_id,
        days=days,
        key_id=ctx.key_id,
    )

    service = await get_blindspot_detection_service()
    profile = await service.analyze_organization(
        organization_id=organization_id,
        days=days,
    )

    # Health score breakdown
    commitment_health = profile.commitment_fulfillment_rate
    decision_health = 1.0 - profile.decision_reversal_rate
    risk_health = profile.risks_mitigated / max(profile.total_risks_detected, 1)
    blindspot_penalty = min(len(profile.blindspots) * 0.05, 0.3)  # Max 30% penalty

    return {
        "organization_id": organization_id,
        "analysis_period_days": days,
        "overall_health_score": profile.organizational_health_score,
        "breakdown": {
            "commitment_health": commitment_health,
            "decision_health": decision_health,
            "risk_management_health": risk_health,
            "blindspot_penalty": blindspot_penalty,
        },
        "summary": {
            "total_commitments": profile.total_commitments,
            "open_commitments": profile.open_commitments,
            "fulfillment_rate": profile.commitment_fulfillment_rate,
            "total_decisions": profile.total_decisions,
            "reversal_rate": profile.decision_reversal_rate,
            "total_risks": profile.total_risks_detected,
            "risks_mitigated": profile.risks_mitigated,
            "blindspots_detected": len(profile.blindspots),
        },
        "generated_at": profile.generated_at.isoformat(),
    }


# =============================================================================
# GRAPH ANALYTICS ENDPOINTS
# =============================================================================


@router.get("/graph/influential/{organization_id}")
async def get_influential_contacts(
    organization_id: str,
    limit: int = Query(20, ge=1, le=100, description="Maximum contacts to return"),
    min_score: float = Query(0.0, ge=0.0, description="Minimum PageRank score"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get most influential contacts based on PageRank scores.

    PageRank analyzes the communication network to identify contacts
    who are central to information flow.

    Higher scores indicate greater network influence.

    MCP Tool: get_influential_contacts

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Getting influential contacts",
        organization_id=organization_id,
        limit=limit,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    result = await graph.query(
        """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.pagerankScore IS NOT NULL
        AND c.pagerankScore >= $minScore
        RETURN c.id as id, c.displayName as name, c.email as email,
               c.company as company, c.pagerankScore as influence_score,
               c.communityId as community_id, c.betweennessScore as bridge_score
        ORDER BY c.pagerankScore DESC
        LIMIT $limit
        """,
        {"orgId": organization_id, "minScore": min_score, "limit": limit},
    )

    return {
        "organization_id": organization_id,
        "contacts": [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "email": row.get("email"),
                "company": row.get("company"),
                "influence_score": row.get("influence_score", 0),
                "community_id": row.get("community_id"),
                "bridge_score": row.get("bridge_score"),
            }
            for row in (result or [])
        ],
        "total": len(result or []),
        "algorithm": "PageRank",
    }


@router.get("/graph/communities/{organization_id}")
async def get_communication_clusters(
    organization_id: str,
    min_size: int = Query(2, ge=1, description="Minimum cluster size"),
    limit: int = Query(20, ge=1, le=100, description="Maximum clusters to return"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get communication clusters from CDLP community detection.

    Shows groups of contacts who communicate frequently together.
    Useful for identifying teams, departments, or project groups.

    MCP Tool: get_communication_clusters

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Getting communication clusters",
        organization_id=organization_id,
        min_size=min_size,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    result = await graph.query(
        """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.communityId IS NOT NULL
        WITH c.communityId as cluster_id, collect({
            id: c.id,
            name: c.displayName,
            email: c.email,
            company: c.company,
            influence_score: c.pagerankScore
        }) as members
        WHERE size(members) >= $minSize
        RETURN cluster_id, members, size(members) as size
        ORDER BY size DESC
        LIMIT $limit
        """,
        {"orgId": organization_id, "minSize": min_size, "limit": limit},
    )

    return {
        "organization_id": organization_id,
        "clusters": [
            {
                "cluster_id": row.get("cluster_id"),
                "members": row.get("members", []),
                "size": row.get("size", 0),
            }
            for row in (result or [])
        ],
        "total_clusters": len(result or []),
        "algorithm": "CDLP (Community Detection Label Propagation)",
    }


@router.get("/graph/bridges/{organization_id}")
async def get_bridge_connectors(
    organization_id: str,
    limit: int = Query(20, ge=1, le=100, description="Maximum contacts to return"),
    min_score: float = Query(0.1, ge=0.0, description="Minimum betweenness score"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get bridge connectors based on betweenness centrality.

    Bridge connectors are people who link different groups together.
    They are valuable for cross-team communication and introductions.

    Higher betweenness scores indicate more bridging connections.

    MCP Tool: get_bridge_connectors

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Getting bridge connectors",
        organization_id=organization_id,
        limit=limit,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    result = await graph.query(
        """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.betweennessScore IS NOT NULL
        AND c.betweennessScore >= $minScore
        RETURN c.id as id, c.displayName as name, c.email as email,
               c.company as company, c.betweennessScore as bridge_score,
               c.communityId as community_id, c.pagerankScore as influence_score
        ORDER BY c.betweennessScore DESC
        LIMIT $limit
        """,
        {"orgId": organization_id, "minScore": min_score, "limit": limit},
    )

    return {
        "organization_id": organization_id,
        "connectors": [
            {
                "id": row.get("id"),
                "name": row.get("name"),
                "email": row.get("email"),
                "company": row.get("company"),
                "bridge_score": row.get("bridge_score", 0),
                "community_id": row.get("community_id"),
                "influence_score": row.get("influence_score"),
            }
            for row in (result or [])
        ],
        "total": len(result or []),
        "algorithm": "Betweenness Centrality",
        "description": "Bridge connectors link different groups and are valuable for introductions.",
    }


@router.post("/graph/run-analytics/{organization_id}")
async def trigger_graph_analytics(
    organization_id: str,
    algorithms: list[str] = Query(
        default=["pagerank", "communities", "betweenness"],
        description="Algorithms to run",
    ),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Trigger graph analytics computation.

    Runs specified algorithms and stores results on Contact nodes:
    - pagerank: Computes influence scores (pagerankScore)
    - communities: Detects clusters (communityId)
    - betweenness: Computes bridge scores (betweennessScore)

    Note: This may take time for large graphs.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.jobs.graph_analytics import get_analytics_job

    logger.info(
        "Triggering graph analytics",
        organization_id=organization_id,
        algorithms=algorithms,
        key_id=ctx.key_id,
    )

    job = await get_analytics_job()
    results = {}

    for algo in algorithms:
        if algo == "pagerank":
            result = await job.run_pagerank(organization_id)
            results["pagerank"] = result
        elif algo == "communities":
            result = await job.run_communities(organization_id)
            results["communities"] = result
        elif algo == "betweenness":
            result = await job.run_betweenness(organization_id)
            results["betweenness"] = result
        else:
            results[algo] = {"status": "unknown_algorithm"}

    return {
        "organization_id": organization_id,
        "algorithms_run": algorithms,
        "results": results,
    }


@router.get("/graph/stats/{organization_id}")
async def get_graph_statistics(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_ANALYTICS)),
):
    """
    Get graph statistics and analytics status.

    Returns overview of graph content and analytics coverage.

    Requires `read:analytics` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    logger.info(
        "Getting graph statistics",
        organization_id=organization_id,
        key_id=ctx.key_id,
    )

    graph = await get_graph_client()

    # Get node counts by type
    node_counts = await graph.query(
        """
        MATCH (n {organizationId: $orgId})
        RETURN labels(n)[0] as type, count(n) as count
        ORDER BY count DESC
        """,
        {"orgId": organization_id},
    )

    # Get relationship counts
    rel_counts = await graph.query(
        """
        MATCH (a {organizationId: $orgId})-[r]-(b)
        RETURN type(r) as type, count(r) / 2 as count
        ORDER BY count DESC
        LIMIT 20
        """,
        {"orgId": organization_id},
    )

    # Get analytics coverage
    analytics_coverage = await graph.query(
        """
        MATCH (c:Contact {organizationId: $orgId})
        RETURN count(c) as total_contacts,
               sum(CASE WHEN c.pagerankScore IS NOT NULL THEN 1 ELSE 0 END) as with_pagerank,
               sum(CASE WHEN c.communityId IS NOT NULL THEN 1 ELSE 0 END) as with_community,
               sum(CASE WHEN c.betweennessScore IS NOT NULL THEN 1 ELSE 0 END) as with_betweenness
        """,
        {"orgId": organization_id},
    )

    coverage = analytics_coverage[0] if analytics_coverage else {}
    total = coverage.get("total_contacts", 0)

    return {
        "organization_id": organization_id,
        "node_counts": {
            row.get("type"): row.get("count", 0)
            for row in (node_counts or [])
        },
        "relationship_counts": {
            row.get("type"): row.get("count", 0)
            for row in (rel_counts or [])
        },
        "analytics_coverage": {
            "total_contacts": total,
            "pagerank_coverage": coverage.get("with_pagerank", 0) / max(total, 1),
            "community_coverage": coverage.get("with_community", 0) / max(total, 1),
            "betweenness_coverage": coverage.get("with_betweenness", 0) / max(total, 1),
        },
    }
