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
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = structlog.get_logger()

router = APIRouter(prefix="/analytics", tags=["Analytics"])


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
):
    """
    Get comprehensive organization intelligence profile.

    Includes:
    - Summary metrics (commitments, decisions, risks)
    - Detected blindspots with severity and evidence
    - Organizational health score

    MCP Tool: get_organization_profile
    """
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Getting organization profile",
        organization_id=organization_id,
        days=days,
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
):
    """
    List detected organizational blindspots.

    MCP Tool: list_blindspots
    """
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Listing blindspots",
        organization_id=organization_id,
        days=days,
        severity=severity,
        blindspot_type=blindspot_type,
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
):
    """
    Dismiss a blindspot with feedback.

    This feeds back into the detection system to improve accuracy.

    MCP Tool: dismiss_blindspot
    """
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Dismissing blindspot",
        organization_id=organization_id,
        blindspot_id=blindspot_id,
        reason=reason,
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
):
    """
    Get confidence calibration metrics.

    Uses DiBello's Strategic Rehearsal methodology with Brier score decomposition.

    MCP Tool: get_calibration_metrics
    """
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
):
    """
    Get statistics about signal vs noise classification.

    Uses Wheeler's Statistical Process Control methodology.

    MCP Tool: get_signal_noise_stats
    """
    from src.graph.client import get_graph_client

    logger.info(
        "Getting signal/noise stats",
        organization_id=organization_id,
        days=days,
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
):
    """
    List recognition patterns for the organization.

    Uses Klein's Recognition-Primed Decision methodology.

    MCP Tool: list_patterns
    """
    from src.graph.client import get_graph_client

    logger.info(
        "Listing patterns",
        organization_id=organization_id,
        domain=domain,
        active_only=active_only,
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
):
    """
    Record feedback on a pattern match.

    Updates pattern accuracy metrics.

    MCP Tool: record_pattern_feedback
    """
    from src.graph.client import get_graph_client

    logger.info(
        "Recording pattern feedback",
        organization_id=organization_id,
        pattern_id=pattern_id,
        was_correct=was_correct,
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
):
    """
    Get overall organizational health score with breakdown.

    MCP Tool: get_organizational_health
    """
    from src.analytics.blindspot_detection import get_blindspot_detection_service

    logger.info(
        "Getting organizational health",
        organization_id=organization_id,
        days=days,
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
