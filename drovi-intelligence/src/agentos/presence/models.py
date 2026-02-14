from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


IdentityMode = Literal["virtual_persona", "dedicated_account"]
ChannelType = Literal["email", "slack", "teams"]
ThreadStatus = Literal["open", "resolved", "blocked", "archived"]
MessageDirection = Literal["inbound", "outbound", "system"]
MessageStatus = Literal["received", "queued", "sent", "failed", "requires_approval"]


class AgentIdentityRecord(BaseModel):
    id: str
    organization_id: str
    deployment_id: str | None = None
    role_id: str | None = None
    profile_id: str | None = None
    display_name: str
    identity_mode: IdentityMode = "virtual_persona"
    email_address: str | None = None
    status: str = "active"
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AgentChannelBindingRecord(BaseModel):
    id: str
    organization_id: str
    identity_id: str
    channel_type: ChannelType
    channel_target: str
    channel_account_id: str | None = None
    routing_mode: str = "auto"
    is_enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AgentInboxThreadRecord(BaseModel):
    id: str
    organization_id: str
    identity_id: str
    channel_type: ChannelType
    external_thread_id: str
    continuity_key: str | None = None
    subject: str | None = None
    status: ThreadStatus = "open"
    assigned_run_id: str | None = None
    last_message_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AgentMessageEventRecord(BaseModel):
    id: str
    organization_id: str
    thread_id: str
    identity_id: str
    channel_binding_id: str | None = None
    direction: MessageDirection
    event_type: str
    sender: str | None = None
    recipients: list[str] = Field(default_factory=list)
    subject: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    parsed_task: dict[str, Any] = Field(default_factory=dict)
    policy_status: str | None = None
    approval_request_id: str | None = None
    run_id: str | None = None
    message_status: MessageStatus = "received"
    occurred_at: datetime | None = None
    created_at: datetime | None = None


class ParsedChannelAction(BaseModel):
    intent: Literal[
        "task",
        "question",
        "approval",
        "none",
    ] = "none"
    summary: str | None = None
    confidence: float = 0.0
    evidence_refs: list[str] = Field(default_factory=list)
    approval_id: str | None = None
    approval_decision: Literal["approved", "denied"] | None = None
    approval_reason: str | None = None
    mentions: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class InboundChannelEventResult(BaseModel):
    thread: AgentInboxThreadRecord
    message: AgentMessageEventRecord
    parsed_action: ParsedChannelAction = Field(default_factory=ParsedChannelAction)
    approval_applied: dict[str, Any] | None = None
