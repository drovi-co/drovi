from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


FeedbackVerdict = Literal["accepted", "edited", "rejected", "needs_review"]
RecommendationPriority = Literal["low", "medium", "high", "critical"]
RecommendationStatus = Literal["open", "accepted", "dismissed", "resolved"]
RegressionComparator = Literal["min_value", "max_value", "max_drop", "min_improvement"]
RegressionVerdict = Literal["pass", "warn", "block", "insufficient_data"]


class OfflineEvalCase(BaseModel):
    scenario_id: str
    expected: dict[str, Any] = Field(default_factory=dict)
    observed: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: list[str] = Field(default_factory=list)
    policy_decision: str | None = None
    latency_ms: float | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class OfflineEvalMetricResult(BaseModel):
    metric_name: str
    metric_value: float
    threshold: float | None = None
    comparator: Literal["gte", "lte"] = "gte"
    passed: bool
    description: str | None = None


class OfflineEvalRunResult(BaseModel):
    organization_id: str
    deployment_id: str | None = None
    suite_name: str
    passed: bool
    case_count: int
    metrics: list[OfflineEvalMetricResult] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunQualityScoreRecord(BaseModel):
    id: str
    organization_id: str
    run_id: str
    deployment_id: str | None = None
    role_id: str | None = None
    quality_score: float
    confidence_score: float
    outcome_score: float | None = None
    status: str
    score_breakdown: dict[str, Any] = Field(default_factory=dict)
    evaluated_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class QualityTrendPoint(BaseModel):
    bucket_start: datetime
    run_count: int
    avg_quality_score: float | None = None
    avg_confidence_score: float | None = None
    avg_outcome_score: float | None = None
    eval_pass_rate: float | None = None


class QualityTrendResponse(BaseModel):
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    lookback_days: int
    points: list[QualityTrendPoint] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)


class CalibrationBucket(BaseModel):
    bucket_start: float
    bucket_end: float
    count: int
    avg_confidence: float
    avg_outcome: float


class CalibrationSnapshot(BaseModel):
    id: str
    organization_id: str
    role_id: str | None = None
    sample_count: int
    mean_absolute_error: float
    brier_score: float
    calibration_error: float
    adjustment_factor: float
    bucket_stats: list[CalibrationBucket] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    computed_at: datetime | None = None
    created_at: datetime | None = None


class QualityRecommendationRecord(BaseModel):
    id: str
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    recommendation_type: str
    priority: RecommendationPriority = "medium"
    status: RecommendationStatus = "open"
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)
    source_signals: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    resolved_at: datetime | None = None


class RegressionGateRecord(BaseModel):
    id: str
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    metric_name: Literal[
        "quality_score",
        "confidence_score",
        "eval_pass_rate",
        "feedback_acceptance_rate",
        "feedback_rejection_rate",
    ]
    comparator: RegressionComparator = "max_drop"
    threshold: float
    lookback_days: int = Field(default=14, ge=1, le=365)
    min_samples: int = Field(default=10, ge=1, le=100000)
    severity: Literal["warn", "blocker"] = "blocker"
    is_enabled: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class RegressionGateCreateRequest(BaseModel):
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    metric_name: Literal[
        "quality_score",
        "confidence_score",
        "eval_pass_rate",
        "feedback_acceptance_rate",
        "feedback_rejection_rate",
    ]
    comparator: RegressionComparator = "max_drop"
    threshold: float
    lookback_days: int = Field(default=14, ge=1, le=365)
    min_samples: int = Field(default=10, ge=1, le=100000)
    severity: Literal["warn", "blocker"] = "blocker"
    is_enabled: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class RegressionGateEvaluation(BaseModel):
    gate_id: str
    metric_name: str
    comparator: RegressionComparator
    threshold: float
    baseline_value: float | None = None
    current_value: float | None = None
    delta_value: float | None = None
    sample_count: int = 0
    verdict: RegressionVerdict
    blocked: bool = False
    severity: Literal["warn", "blocker"] = "blocker"
    metadata: dict[str, Any] = Field(default_factory=dict)


class RegressionGateEvaluationResponse(BaseModel):
    organization_id: str
    role_id: str | None = None
    deployment_id: str | None = None
    evaluated_at: datetime
    blocked: bool
    evaluations: list[RegressionGateEvaluation] = Field(default_factory=list)

