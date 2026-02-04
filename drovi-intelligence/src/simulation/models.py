"""Simulation request/response models."""

from __future__ import annotations

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


class SimulationRequest(BaseModel):
    organization_id: str
    scenario_name: str = Field(default="what_if")
    horizon_days: int = Field(default=30, ge=1, le=365)
    overrides: SimulationOverride = Field(default_factory=SimulationOverride)


class SimulationResponse(BaseModel):
    simulation_id: str
    scenario_name: str
    baseline: RiskSnapshot
    simulated: RiskSnapshot
    delta: dict[str, Any]
    sensitivity: list[SensitivityResult] = Field(default_factory=list)
    narrative: str


class RiskSnapshot(BaseModel):
    open_commitments: int
    overdue_commitments: int
    at_risk_commitments: int
    risk_score: float
    risk_outlook: str


class SensitivityResult(BaseModel):
    commitment_id: str
    change_type: Literal["delay", "cancel"]
    delta_risk_score: float
    delta_overdue: int


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
