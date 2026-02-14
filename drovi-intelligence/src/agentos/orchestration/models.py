from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


ExecutionMode = Literal["parallel", "sequential", "hybrid"]
DependencyFailurePolicy = Literal["halt", "best_effort"]
ConflictStrategy = Literal["halt_on_failure", "best_effort", "required_roles_must_succeed"]


class TeamMemberSpec(BaseModel):
    role_id: str
    role_name: str | None = None
    priority: int = 0
    is_required: bool = True
    stage: int | None = None
    specialization_prompt: str | None = None
    constraints: dict[str, Any] = Field(default_factory=dict)


class TeamExecutionPolicy(BaseModel):
    mode: ExecutionMode = "parallel"
    stage_width: int = Field(default=2, ge=1, le=25)
    dependency_failure_policy: DependencyFailurePolicy = "halt"


class TeamConflictResolution(BaseModel):
    strategy: ConflictStrategy = "required_roles_must_succeed"
    required_role_ids: list[str] = Field(default_factory=list)


class TeamBudgetPolicy(BaseModel):
    max_sub_runs: int = Field(default=20, ge=1, le=200)
    max_parallel: int = Field(default=6, ge=1, le=100)
    max_estimated_tokens: int | None = Field(default=None, ge=1)
    estimated_tokens_per_member: int = Field(default=3000, ge=1, le=200_000)


class TeamGuardrails(BaseModel):
    blocked_tools: list[str] = Field(default_factory=list)
    allow_external_send: bool | None = None
    require_human_approval: bool = True


class TeamRunRequest(BaseModel):
    objective: str = Field(..., min_length=5, max_length=10_000)
    objective_context: dict[str, Any] = Field(default_factory=dict)
    execution_policy: TeamExecutionPolicy = Field(default_factory=TeamExecutionPolicy)
    conflict_resolution: TeamConflictResolution = Field(default_factory=TeamConflictResolution)
    budget: TeamBudgetPolicy = Field(default_factory=TeamBudgetPolicy)
    guardrails: TeamGuardrails = Field(default_factory=TeamGuardrails)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlannedTeamStage(BaseModel):
    stage_index: int
    members: list[TeamMemberSpec] = Field(default_factory=list)


class PlannedTeamRun(BaseModel):
    team_id: str
    mode: ExecutionMode
    stages: list[PlannedTeamStage] = Field(default_factory=list)
    total_sub_runs: int = 0
    max_parallelism: int = 0


class PlannedChildRun(BaseModel):
    child_run_id: str
    role_id: str
    deployment_id: str
    stage_index: int
    dependencies: list[str] = Field(default_factory=list)
    is_required: bool = True
    specialization_prompt: str | None = None
    constraints: dict[str, Any] = Field(default_factory=dict)


class TeamRunPlanResult(BaseModel):
    parent_run_id: str
    team_id: str
    parent_deployment_id: str
    mode: ExecutionMode
    stages: list[PlannedTeamStage] = Field(default_factory=list)
    children: list[PlannedChildRun] = Field(default_factory=list)
    budget: TeamBudgetPolicy
    guardrails: TeamGuardrails
    conflict_resolution: TeamConflictResolution
