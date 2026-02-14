from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from src.agentos.control_plane import emit_control_plane_audit_event
from src.agentos.quality import (
    CalibrationSnapshot,
    ConfidenceCalibrationService,
    OfflineEvalCase,
    OfflineEvalRunResult,
    OfflineEvalThresholds,
    OfflineEvaluationRunner,
    QualityRecommendationRecord,
    QualityRecommendationService,
    QualityTrendResponse,
    RegressionGateCreateRequest,
    RegressionGateEvaluationResponse,
    RegressionGateRecord,
    RegressionGateService,
    RunQualityScoreRecord,
    RunQualityScoringService,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()

_scoring_service = RunQualityScoringService()
_calibration_service = ConfidenceCalibrationService()
_recommendation_service = QualityRecommendationService()
_regression_gate_service = RegressionGateService()


class OfflineEvalRunRequest(BaseModel):
    organization_id: str
    suite_name: str = Field(..., min_length=1, max_length=200)
    deployment_id: str | None = None
    cases: list[OfflineEvalCase] = Field(default_factory=list)
    persist_results: bool = True
    thresholds: dict[str, float] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunQualityScoreRequest(BaseModel):
    organization_id: str


class CalibrationRecomputeRequest(BaseModel):
    organization_id: str
    role_id: str | None = None
    min_samples: int = Field(default=5, ge=1, le=5000)


class RecommendationGenerateRequest(BaseModel):
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    lookback_days: int = Field(default=30, ge=1, le=365)


class RegressionGateEvaluateRequest(BaseModel):
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    only_enabled: bool = True
    persist_events: bool = True


@router.post("/quality/evals/offline/run", response_model=OfflineEvalRunResult)
async def run_offline_eval(
    request: OfflineEvalRunRequest,
    auth: AuthContext = Depends(get_auth_context),
):
    org_id = resolve_org_id(auth, request.organization_id)
    thresholds = _thresholds_from_request(request.thresholds)
    runner = OfflineEvaluationRunner(thresholds=thresholds)
    result = await runner.run_suite(
        organization_id=org_id,
        suite_name=request.suite_name,
        deployment_id=request.deployment_id,
        cases=request.cases,
        persist_results=request.persist_results,
        metadata=request.metadata,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.quality.offline_eval.ran",
        actor_id=auth.user_id,
        resource_type="agent_eval_result",
        resource_id=request.suite_name,
        metadata={
            "deployment_id": request.deployment_id,
            "case_count": result.case_count,
            "passed": result.passed,
        },
    )
    return result


@router.post("/quality/runs/{run_id}/score", response_model=RunQualityScoreRecord)
async def score_run(
    run_id: str,
    request: RunQualityScoreRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> RunQualityScoreRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    score = await _scoring_service.score_run(organization_id=org_id, run_id=run_id)
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.quality.run_scored",
        actor_id=auth.user_id,
        resource_type="agent_run_quality_score",
        resource_id=score.id,
        metadata={
            "run_id": run_id,
            "quality_score": score.quality_score,
            "confidence_score": score.confidence_score,
        },
    )
    return score


@router.get("/quality/runs/scores", response_model=list[RunQualityScoreRecord])
async def list_run_scores(
    organization_id: str | None = None,
    run_id: str | None = Query(default=None),
    role_id: str | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[RunQualityScoreRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _scoring_service.list_scores(
        organization_id=org_id,
        run_id=run_id,
        role_id=role_id,
        deployment_id=deployment_id,
        limit=limit,
        offset=offset,
    )


@router.get("/quality/trends", response_model=QualityTrendResponse)
async def get_quality_trends(
    organization_id: str | None = None,
    role_id: str | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
    lookback_days: int = Query(default=30, ge=1, le=365),
    auth: AuthContext = Depends(get_auth_context),
) -> QualityTrendResponse:
    org_id = resolve_org_id(auth, organization_id)
    return await _scoring_service.list_trends(
        organization_id=org_id,
        role_id=role_id,
        deployment_id=deployment_id,
        lookback_days=lookback_days,
    )


@router.post("/quality/calibration/recompute", response_model=CalibrationSnapshot)
async def recompute_calibration(
    request: CalibrationRecomputeRequest,
    auth: AuthContext = Depends(get_auth_context),
):
    org_id = resolve_org_id(auth, request.organization_id)
    snapshot = await _calibration_service.recompute(
        organization_id=org_id,
        role_id=request.role_id,
        min_samples=request.min_samples,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.quality.calibration.recomputed",
        actor_id=auth.user_id,
        resource_type="agent_confidence_calibration",
        resource_id=snapshot.id or org_id,
        metadata={
            "role_id": request.role_id,
            "sample_count": snapshot.sample_count,
            "adjustment_factor": snapshot.adjustment_factor,
        },
    )
    return snapshot


@router.get("/quality/calibration", response_model=CalibrationSnapshot | None)
async def get_latest_calibration(
    organization_id: str | None = None,
    role_id: str | None = Query(default=None),
    auth: AuthContext = Depends(get_auth_context),
):
    org_id = resolve_org_id(auth, organization_id)
    snapshot = await _calibration_service.get_latest(organization_id=org_id, role_id=role_id)
    if snapshot is None:
        return None
    return snapshot


@router.post("/quality/recommendations/generate", response_model=list[QualityRecommendationRecord])
async def generate_recommendations(
    request: RecommendationGenerateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> list[QualityRecommendationRecord]:
    org_id = resolve_org_id(auth, request.organization_id)
    recommendations = await _recommendation_service.generate(
        organization_id=org_id,
        role_id=request.role_id,
        deployment_id=request.deployment_id,
        lookback_days=request.lookback_days,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.quality.recommendations.generated",
        actor_id=auth.user_id,
        resource_type="agent_quality_recommendation",
        resource_id=org_id,
        metadata={
            "role_id": request.role_id,
            "deployment_id": request.deployment_id,
            "count": len(recommendations),
        },
    )
    return recommendations


@router.get("/quality/recommendations", response_model=list[QualityRecommendationRecord])
async def list_recommendations(
    organization_id: str | None = None,
    role_id: str | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[QualityRecommendationRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _recommendation_service.list_recommendations(
        organization_id=org_id,
        role_id=role_id,
        deployment_id=deployment_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.post("/quality/regression-gates", response_model=RegressionGateRecord)
async def create_regression_gate(
    request: RegressionGateCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> RegressionGateRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    gate = await _regression_gate_service.create_gate(
        organization_id=org_id,
        request=request,
        created_by_user_id=auth.user_id,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.quality.regression_gate.created",
        actor_id=auth.user_id,
        resource_type="agent_quality_regression_gate",
        resource_id=gate.id,
        metadata={"metric_name": gate.metric_name, "severity": gate.severity},
    )
    return gate


@router.get("/quality/regression-gates", response_model=list[RegressionGateRecord])
async def list_regression_gates(
    organization_id: str | None = None,
    role_id: str | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
    only_enabled: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[RegressionGateRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _regression_gate_service.list_gates(
        organization_id=org_id,
        role_id=role_id,
        deployment_id=deployment_id,
        only_enabled=only_enabled,
        limit=limit,
        offset=offset,
    )


@router.post("/quality/regression-gates/evaluate", response_model=RegressionGateEvaluationResponse)
async def evaluate_regression_gates(
    request: RegressionGateEvaluateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> RegressionGateEvaluationResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    result = await _regression_gate_service.evaluate(
        organization_id=org_id,
        role_id=request.role_id,
        deployment_id=request.deployment_id,
        only_enabled=request.only_enabled,
        persist_events=request.persist_events,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.quality.regression_gate.evaluated",
        actor_id=auth.user_id,
        resource_type="agent_quality_regression_event",
        resource_id=org_id,
        metadata={
            "role_id": request.role_id,
            "deployment_id": request.deployment_id,
            "blocked": result.blocked,
            "gate_count": len(result.evaluations),
        },
    )
    return result


def _thresholds_from_request(values: dict[str, float] | None) -> OfflineEvalThresholds:
    defaults = OfflineEvalThresholds()
    if not values:
        return defaults
    return OfflineEvalThresholds(
        accuracy=float(values.get("accuracy", defaults.accuracy)),
        evidence_coverage=float(values.get("evidence_coverage", defaults.evidence_coverage)),
        policy_compliance=float(values.get("policy_compliance", defaults.policy_compliance)),
        latency_p95_ms=float(values.get("latency_p95_ms", defaults.latency_p95_ms)),
    )
