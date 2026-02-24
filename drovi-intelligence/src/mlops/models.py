from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal


ModelStage = Literal["dev", "shadow", "canary", "prod"]
RiskClass = Literal["low", "medium", "high", "critical"]
InferenceMode = Literal["online", "batch"]
ModelFamily = Literal["temporal_forecast", "graph_impact", "verifier_nli", "generic"]


@dataclass(frozen=True, slots=True)
class DatasetSnapshot:
    snapshot_id: str
    as_of: datetime
    source_tables: list[str]
    row_count: int
    feature_hash: str
    label_hash: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TrainingArtifact:
    artifact_id: str
    model_family: ModelFamily
    stage: ModelStage
    dataset_snapshot_id: str
    config_hash: str
    code_hash: str
    hyperparameters: dict[str, Any]
    metrics: dict[str, float]
    model_uri: str
    created_at: datetime
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ModelCard:
    model_family: ModelFamily
    version: str
    use_case_bounds: list[str]
    known_failure_modes: list[str]
    owners: list[str]
    offline_metrics: dict[str, float]
    training_data_summary: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True, slots=True)
class InferenceRoute:
    route_id: str
    model_family: ModelFamily
    model_stage: ModelStage
    backend_id: str
    risk_class: RiskClass
    latency_p95_ms: float
    cost_per_1k_tokens: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class InferenceRequest:
    request_id: str
    model_family: ModelFamily
    payload: dict[str, Any]
    risk_class: RiskClass = "medium"
    latency_budget_ms: float = 1500.0
    cost_budget_per_1k_tokens: float = 2.0
    mode: InferenceMode = "online"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class InferenceResponse:
    request_id: str
    route_id: str
    backend_id: str
    model_stage: ModelStage
    payload: dict[str, Any]
    latency_ms: float
    estimated_cost_per_1k_tokens: float
    fallback_used: bool
    metadata: dict[str, Any] = field(default_factory=dict)

