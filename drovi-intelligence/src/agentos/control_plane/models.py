from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


AutonomyTier = Literal["L0", "L1", "L2", "L3", "L4"]
TriggerType = Literal["manual", "event", "schedule"]
PolicyDecisionAction = Literal["allow", "deny", "require_approval"]
ToolSideEffectTier = Literal["read_only", "low_risk_write", "high_risk_write", "external_commit"]


class AgentRoleRecord(BaseModel):
    id: str
    organization_id: str
    role_key: str
    name: str
    description: str | None = None
    domain: str | None = None
    status: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class PermissionScopeRecord(BaseModel):
    tools: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    allow_external_send: bool = False
    allowed_domains: list[str] = Field(default_factory=list)


class AgentProfileRecord(BaseModel):
    id: str
    organization_id: str
    role_id: str
    name: str
    autonomy_tier: AutonomyTier
    model_policy: dict[str, Any] = Field(default_factory=dict)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    permission_scope: PermissionScopeRecord = Field(default_factory=PermissionScopeRecord)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentPlaybookRecord(BaseModel):
    id: str
    organization_id: str
    role_id: str
    version: int
    name: str
    objective: str
    constraints: dict[str, Any] = Field(default_factory=dict)
    sop: dict[str, Any] = Field(default_factory=dict)
    success_criteria: dict[str, Any] = Field(default_factory=dict)
    escalation_policy: dict[str, Any] = Field(default_factory=dict)
    dsl: dict[str, Any] = Field(default_factory=dict)
    status: str


class AgentMemoryScopeRecord(BaseModel):
    readable_scopes: list[str] = Field(default_factory=list)
    writable_scopes: list[str] = Field(default_factory=list)
    retention_policy: dict[str, Any] = Field(default_factory=dict)


class OrganizationPolicyRecord(BaseModel):
    organization_id: str
    allowed_connectors: list[str] = Field(default_factory=list)
    default_connection_visibility: str | None = None
    policy_overrides: dict[str, Any] = Field(default_factory=dict)


class DeploymentRecord(BaseModel):
    id: str
    organization_id: str
    role_id: str
    profile_id: str
    playbook_id: str
    version: int
    status: str
    rollout_strategy: dict[str, Any] = Field(default_factory=dict)
    snapshot_hash: str
    published_at: datetime | None = None
    created_by_user_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TriggerRecord(BaseModel):
    id: str
    organization_id: str
    deployment_id: str
    trigger_type: TriggerType
    trigger_spec: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True
    updated_at: datetime | None = None
    deployment_status: str | None = None


class CompiledPolicy(BaseModel):
    autonomy_tier: AutonomyTier
    allowed_tools: list[str] = Field(default_factory=list)
    denied_tools: list[str] = Field(default_factory=list)
    allowed_sources: list[str] = Field(default_factory=list)
    allowed_channels: list[str] = Field(default_factory=list)
    allow_external_send: bool = False
    allowed_domains: list[str] = Field(default_factory=list)
    organization_policy: dict[str, Any] = Field(default_factory=dict)
    policy_hash: str


class DeploymentSnapshot(BaseModel):
    deployment_id: str
    organization_id: str
    role: AgentRoleRecord
    profile: AgentProfileRecord
    playbook: AgentPlaybookRecord
    memory_scope: AgentMemoryScopeRecord
    compiled_policy: CompiledPolicy
    rollout_strategy: dict[str, Any] = Field(default_factory=dict)
    snapshot_hash: str


class TriggerRouteCandidate(BaseModel):
    trigger_id: str
    deployment_id: str
    score: int
    reasons: list[str] = Field(default_factory=list)
    trigger_spec: dict[str, Any] = Field(default_factory=dict)


class TriggerRouteDecision(BaseModel):
    organization_id: str
    trigger_type: TriggerType
    selected: TriggerRouteCandidate | None = None
    candidates: list[TriggerRouteCandidate] = Field(default_factory=list)


class ConfigLintResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    compiled_policy: CompiledPolicy | None = None


class ToolManifestRecord(BaseModel):
    id: str
    organization_id: str | None = None
    tool_id: str
    name: str
    description: str | None = None
    side_effect_tier: ToolSideEffectTier
    default_policy_action: PolicyDecisionAction = "allow"
    requires_evidence: bool = False
    high_stakes: bool = False
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PolicyOverlayRecord(BaseModel):
    organization_id: str
    allow_tools: list[str] = Field(default_factory=list)
    deny_tools: list[str] = Field(default_factory=list)
    require_approval_tools: list[str] = Field(default_factory=list)
    emergency_denylist: list[str] = Field(default_factory=list)
    default_policy_action: PolicyDecisionAction = "allow"
    metadata: dict[str, Any] = Field(default_factory=dict)
    updated_by_user_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PolicyDecisionRecord(BaseModel):
    action: PolicyDecisionAction
    code: str
    reason: str
    reasons: list[str] = Field(default_factory=list)
    tool_id: str
    organization_id: str
    deployment_id: str | None = None
    action_tier: ToolSideEffectTier
    policy_hash: str | None = None
    requires_evidence: bool = False
    high_stakes: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApprovalRequestRecord(BaseModel):
    id: str
    organization_id: str
    run_id: str | None = None
    deployment_id: str | None = None
    tool_id: str
    action_tier: ToolSideEffectTier
    reason: str | None = None
    status: Literal["pending", "approved", "denied", "expired", "escalated"] = "pending"
    requested_by: str | None = None
    requested_at: datetime | None = None
    sla_due_at: datetime | None = None
    escalation_path: dict[str, Any] = Field(default_factory=dict)
    approver_id: str | None = None
    approval_reason: str | None = None
    decided_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ActionReceiptRecord(BaseModel):
    id: str
    organization_id: str
    run_id: str | None = None
    deployment_id: str | None = None
    tool_id: str
    request_payload: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: dict[str, Any] = Field(default_factory=dict)
    policy_result: dict[str, Any] = Field(default_factory=dict)
    approval_request_id: str | None = None
    final_status: str
    result_payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
