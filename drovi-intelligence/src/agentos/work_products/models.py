from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


WorkProductType = Literal["email", "sheet", "slides", "doc", "ticket", "api_action"]
WorkProductStatus = Literal[
    "generated",
    "delivered",
    "failed",
    "pending_approval",
    "rolled_back",
]
DeliveryChannel = Literal[
    "email",
    "share_link",
    "crm_attachment",
    "project_ticket",
    "api_action",
]
ApprovalTier = Literal["low", "medium", "high", "critical"]


class WorkProductGenerateRequest(BaseModel):
    organization_id: str
    run_id: str
    product_type: WorkProductType
    title: str | None = Field(default=None, max_length=500)
    instructions: str | None = Field(default=None, max_length=20000)
    input_payload: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: list[str] = Field(default_factory=list)
    require_citations: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkProductRecord(BaseModel):
    id: str
    organization_id: str
    run_id: str | None = None
    product_type: WorkProductType
    title: str | None = None
    status: WorkProductStatus
    artifact_ref: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: Any
    updated_at: Any


class WorkProductDeliveryRequest(BaseModel):
    organization_id: str
    channel: DeliveryChannel
    approval_tier: ApprovalTier = "medium"
    approved_by: str | None = None
    subject: str | None = None
    recipients: list[str] = Field(default_factory=list)
    reply_to: str | None = None
    endpoint: str | None = None
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict[str, Any] | None = None
    rollback_on_failure: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkProductDeliveryResult(BaseModel):
    work_product_id: str
    status: WorkProductStatus
    delivery_channel: DeliveryChannel
    approval_request_id: str | None = None
    delivered_at: Any | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class RenderedWorkProduct(BaseModel):
    product_type: WorkProductType
    title: str
    mime_type: str
    extension: str
    content_bytes: bytes
    text_content: str
    output_payload: dict[str, Any] = Field(default_factory=dict)


class VerificationResult(BaseModel):
    valid: bool
    issues: list[str] = Field(default_factory=list)
    checks: dict[str, Any] = Field(default_factory=dict)


class WorkProductArtifactRef(BaseModel):
    artifact_id: str
    storage_backend: str
    storage_path: str
    byte_size: int
    sha256: str
