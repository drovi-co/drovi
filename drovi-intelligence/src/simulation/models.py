"""Simulation request/response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class SimulationOverride(BaseModel):
    commitment_delays: dict[str, int] = Field(
        default_factory=dict,
        description="Map of commitment_id to delay days",
    )
    commitment_cancellations: list[str] = Field(
        default_factory=list,
        description="Commitment IDs to mark as cancelled",
    )


class ScenarioAction(BaseModel):
    action_type: Literal[
        "delay_commitment",
        "cancel_commitment",
        "reopen_commitment",
        "set_due_date",
        "bulk_overdue_shift",
    ]
    commitment_id: str | None = None
    delay_days: int | None = None
    due_date: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ScenarioStep(BaseModel):
    step_id: str
    name: str | None = None
    day_offset: int = Field(default=0, ge=0, le=3650)
    actions: list[ScenarioAction] = Field(default_factory=list)


class UtilityWeights(BaseModel):
    overdue_penalty: float = Field(default=0.55, ge=0.0, le=2.0)
    at_risk_penalty: float = Field(default=0.25, ge=0.0, le=2.0)
    open_penalty: float = Field(default=0.10, ge=0.0, le=2.0)
    cancellation_penalty: float = Field(default=0.15, ge=0.0, le=2.0)
    complexity_penalty: float = Field(default=0.08, ge=0.0, le=2.0)
    resilience_reward: float = Field(default=0.10, ge=0.0, le=2.0)


class UtilityObjectiveProfile(BaseModel):
    profile_name: Literal["balanced", "compliance", "growth", "resilience"] = "balanced"
    weights: UtilityWeights | None = None


class SimulationRequest(BaseModel):
    organization_id: str
    scenario_name: str = Field(default="what_if")
    scenario_type: str = Field(default="counterfactual")
    horizon_days: int = Field(default=30, ge=1, le=365)
    seed: int | None = Field(default=None, ge=1, le=2_147_483_647)
    objective_profile: UtilityObjectiveProfile = Field(default_factory=UtilityObjectiveProfile)
    overrides: SimulationOverride = Field(default_factory=SimulationOverride)
    steps: list[ScenarioStep] = Field(default_factory=list)


class RiskSnapshot(BaseModel):
    open_commitments: int
    overdue_commitments: int
    at_risk_commitments: int
    risk_score: float
    risk_outlook: str


class UtilityBreakdown(BaseModel):
    profile_name: str
    baseline_utility: float
    simulated_utility: float
    utility_delta: float
    components: dict[str, float] = Field(default_factory=dict)


class RiskInterval(BaseModel):
    metric: str
    p10: float
    p50: float
    p90: float


class StressTestResult(BaseModel):
    scenario_id: str
    scenario_name: str
    category: Literal["adversarial", "rare_event"]
    simulated: RiskSnapshot
    delta_risk_score: float
    passed: bool
    notes: str | None = None


class SensitivityResult(BaseModel):
    commitment_id: str
    change_type: Literal["delay", "cancel", "reopen", "bulk_overdue_shift"]
    delta_risk_score: float
    delta_overdue: int
    step_id: str | None = None


class SimulationResponse(BaseModel):
    simulation_id: str
    scenario_name: str
    baseline: RiskSnapshot
    simulated: RiskSnapshot
    delta: dict[str, Any]
    utility: UtilityBreakdown
    risk_intervals: list[RiskInterval] = Field(default_factory=list)
    downside_risk_estimate: float = 0.0
    sensitivity: list[SensitivityResult] = Field(default_factory=list)
    stress_tests: list[StressTestResult] = Field(default_factory=list)
    causal_projection: list[dict[str, Any]] = Field(default_factory=list)
    causal_replay_hash: str | None = None
    scenario_replay_hash: str | None = None
    replay_seed: int | None = None
    narrative: str


class ContinuumPreviewRequest(BaseModel):
    organization_id: str
    horizon_days: int = Field(default=30, ge=1, le=365)


class ContinuumPreviewResponse(BaseModel):
    continuum_id: str
    name: str
    goal: str
    schedule: dict[str, Any]
    expected_actions: list[str]
    proof_requirements: list[dict[str, Any]]
    risk_snapshot: RiskSnapshot
