from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from src.agentos.control_plane import (
    ActionReceiptService,
    ApprovalService,
    PolicyDecisionEngine,
    PolicyOverlayService,
    ToolRegistryService,
    emit_control_plane_audit_event,
)
from src.agentos.control_plane.models import (
    ActionReceiptRecord,
    ApprovalRequestRecord,
    PolicyDecisionRecord,
    PolicyOverlayRecord,
    ToolManifestRecord,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()

_tool_registry = ToolRegistryService()
_policy_overlays = PolicyOverlayService()
_policy_engine = PolicyDecisionEngine(tool_registry=_tool_registry, overlay_service=_policy_overlays)
_approvals = ApprovalService()
_receipts = ActionReceiptService()


class ToolManifestUpsertRequest(BaseModel):
    organization_id: str
    name: str
    description: str | None = None
    side_effect_tier: Literal["read_only", "low_risk_write", "high_risk_write", "external_commit"] = "read_only"
    default_policy_action: Literal["allow", "deny", "require_approval"] = "allow"
    requires_evidence: bool = False
    high_stakes: bool = False
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class ToolManifestEnabledRequest(BaseModel):
    organization_id: str
    is_enabled: bool


class PolicyOverlayUpsertRequest(BaseModel):
    organization_id: str
    allow_tools: list[str] = Field(default_factory=list)
    deny_tools: list[str] = Field(default_factory=list)
    require_approval_tools: list[str] = Field(default_factory=list)
    emergency_denylist: list[str] = Field(default_factory=list)
    default_policy_action: Literal["allow", "deny", "require_approval"] = "allow"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PolicyDecisionRequest(BaseModel):
    organization_id: str
    tool_id: str
    deployment_id: str | None = None
    evidence_refs: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApprovalCreateRequest(BaseModel):
    organization_id: str
    tool_id: str
    action_tier: Literal["read_only", "low_risk_write", "high_risk_write", "external_commit"]
    run_id: str | None = None
    deployment_id: str | None = None
    reason: str | None = None
    sla_minutes: int = Field(default=15, ge=1, le=1440)
    escalation_path: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ApprovalDecisionRequest(BaseModel):
    organization_id: str
    reason: str | None = None


class ApprovalEscalationResponse(BaseModel):
    escalated_count: int


class ReceiptFinalizeRequest(BaseModel):
    organization_id: str
    final_status: str
    result_payload: dict[str, Any] = Field(default_factory=dict)
    approval_request_id: str | None = None


@router.get("/tools/manifests", response_model=list[ToolManifestRecord])
async def list_tool_manifests(
    organization_id: str | None = None,
    include_disabled: bool = Query(default=False),
    auth: AuthContext = Depends(get_auth_context),
) -> list[ToolManifestRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _tool_registry.list_manifests(organization_id=org_id, include_disabled=include_disabled)


@router.get("/tools/manifests/{tool_id}", response_model=ToolManifestRecord)
async def get_tool_manifest(
    tool_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> ToolManifestRecord:
    org_id = resolve_org_id(auth, organization_id)
    return await _tool_registry.get_manifest(organization_id=org_id, tool_id=tool_id)


@router.put("/tools/manifests/{tool_id}", response_model=ToolManifestRecord)
async def upsert_tool_manifest(
    tool_id: str,
    request: ToolManifestUpsertRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ToolManifestRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    manifest = await _tool_registry.upsert_manifest(
        organization_id=org_id,
        manifest={
            "tool_id": tool_id,
            "name": request.name,
            "description": request.description,
            "side_effect_tier": request.side_effect_tier,
            "default_policy_action": request.default_policy_action,
            "requires_evidence": request.requires_evidence,
            "high_stakes": request.high_stakes,
            "input_schema": request.input_schema,
            "output_schema": request.output_schema,
            "metadata": request.metadata,
            "is_enabled": request.is_enabled,
        },
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.tool_manifest.upserted",
        actor_id=auth.user_id,
        resource_type="agent_tool_manifest",
        resource_id=manifest.id,
        metadata={"tool_id": tool_id},
    )
    return manifest


@router.post("/tools/manifests/{tool_id}/enabled", response_model=ToolManifestRecord)
async def set_tool_manifest_enabled(
    tool_id: str,
    request: ToolManifestEnabledRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ToolManifestRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    manifest = await _tool_registry.set_enabled(
        organization_id=org_id,
        tool_id=tool_id,
        is_enabled=request.is_enabled,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.tool_manifest.toggled",
        actor_id=auth.user_id,
        resource_type="agent_tool_manifest",
        resource_id=manifest.id,
        metadata={"tool_id": tool_id, "is_enabled": request.is_enabled},
    )
    return manifest


@router.get("/policies/overlay", response_model=PolicyOverlayRecord)
async def get_org_policy_overlay(
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> PolicyOverlayRecord:
    org_id = resolve_org_id(auth, organization_id)
    return await _policy_overlays.get_overlay(organization_id=org_id)


@router.put("/policies/overlay", response_model=PolicyOverlayRecord)
async def upsert_org_policy_overlay(
    request: PolicyOverlayUpsertRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> PolicyOverlayRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    overlay = await _policy_overlays.upsert_overlay(
        organization_id=org_id,
        overlay=request.model_dump(mode="json"),
        updated_by_user_id=auth.user_id,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.org_policy_overlay.updated",
        actor_id=auth.user_id,
        resource_type="agent_org_policy_overlay",
        resource_id=org_id,
    )
    return overlay


@router.post("/policies/decide", response_model=PolicyDecisionRecord)
async def decide_tool_policy(
    request: PolicyDecisionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> PolicyDecisionRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _policy_engine.decide(
        organization_id=org_id,
        tool_id=request.tool_id,
        deployment_id=request.deployment_id,
        evidence_refs=request.evidence_refs,
        metadata=request.metadata,
    )


@router.post("/approvals", response_model=ApprovalRequestRecord)
async def create_action_approval(
    request: ApprovalCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ApprovalRequestRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    approval = await _approvals.create_request(
        organization_id=org_id,
        tool_id=request.tool_id,
        action_tier=request.action_tier,
        run_id=request.run_id,
        deployment_id=request.deployment_id,
        reason=request.reason,
        requested_by=auth.user_id,
        sla_minutes=request.sla_minutes,
        escalation_path=request.escalation_path,
        metadata=request.metadata,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.approval.created",
        actor_id=auth.user_id,
        resource_type="agent_action_approval",
        resource_id=approval.id,
        metadata={"tool_id": request.tool_id, "run_id": request.run_id},
    )
    return approval


@router.get("/approvals", response_model=list[ApprovalRequestRecord])
async def list_action_approvals(
    organization_id: str | None = None,
    status: Literal["pending", "approved", "denied", "expired", "escalated"] | None = Query(default=None),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[ApprovalRequestRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _approvals.list_requests(
        organization_id=org_id,
        status=status,
        run_id=run_id,
        limit=limit,
        offset=offset,
    )


@router.post("/approvals/escalate", response_model=ApprovalEscalationResponse)
async def escalate_overdue_approvals(
    organization_id: str,
    auth: AuthContext = Depends(get_auth_context),
) -> ApprovalEscalationResponse:
    org_id = resolve_org_id(auth, organization_id)
    count = await _approvals.escalate_overdue(organization_id=org_id)
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.approval.escalated",
        actor_id=auth.user_id,
        resource_type="agent_action_approval",
        resource_id=org_id,
        metadata={"escalated_count": count},
    )
    return ApprovalEscalationResponse(escalated_count=count)


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalRequestRecord)
async def approve_action_approval(
    approval_id: str,
    request: ApprovalDecisionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ApprovalRequestRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    approval = await _approvals.decide_request(
        organization_id=org_id,
        approval_id=approval_id,
        decision="approved",
        approver_id=auth.user_id,
        reason=request.reason,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.approval.approved",
        actor_id=auth.user_id,
        resource_type="agent_action_approval",
        resource_id=approval_id,
    )
    return approval


@router.post("/approvals/{approval_id}/deny", response_model=ApprovalRequestRecord)
async def deny_action_approval(
    approval_id: str,
    request: ApprovalDecisionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ApprovalRequestRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    approval = await _approvals.decide_request(
        organization_id=org_id,
        approval_id=approval_id,
        decision="denied",
        approver_id=auth.user_id,
        reason=request.reason,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.approval.denied",
        actor_id=auth.user_id,
        resource_type="agent_action_approval",
        resource_id=approval_id,
    )
    return approval


@router.get("/receipts", response_model=list[ActionReceiptRecord])
async def list_action_receipts(
    organization_id: str | None = None,
    run_id: str | None = Query(default=None),
    final_status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[ActionReceiptRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _receipts.list_receipts(
        organization_id=org_id,
        run_id=run_id,
        final_status=final_status,
        limit=limit,
        offset=offset,
    )


@router.post("/receipts/{receipt_id}/finalize", response_model=ActionReceiptRecord)
async def finalize_action_receipt(
    receipt_id: str,
    request: ReceiptFinalizeRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ActionReceiptRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    receipt = await _receipts.finalize_receipt(
        organization_id=org_id,
        receipt_id=receipt_id,
        final_status=request.final_status,
        result_payload=request.result_payload,
        approval_request_id=request.approval_request_id,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.receipt.finalized",
        actor_id=auth.user_id,
        resource_type="agent_action_receipt",
        resource_id=receipt_id,
        metadata={"final_status": request.final_status},
    )
    return receipt
