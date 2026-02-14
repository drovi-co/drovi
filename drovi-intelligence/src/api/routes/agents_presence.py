from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from src.agentos.presence import (
    AgentChannelBindingRecord,
    AgentIdentityRecord,
    AgentInboxThreadRecord,
    AgentMessageEventRecord,
    AgentPresenceService,
    InboundChannelEventResult,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.config import get_settings

from .agents_common import resolve_org_id

router = APIRouter()

_presence = AgentPresenceService()


def _verify_inbound_token(token: str | None) -> None:
    settings = get_settings()
    configured = settings.agent_inbox_inbound_token
    if not configured:
        raise HTTPException(status_code=503, detail="Agent inbox inbound token not configured")
    if not token or token != configured:
        raise HTTPException(status_code=401, detail="Invalid inbound token")


class IdentityProvisionRequest(BaseModel):
    organization_id: str
    display_name: str
    identity_mode: Literal["virtual_persona", "dedicated_account"] | None = None
    deployment_id: str | None = None
    role_id: str | None = None
    profile_id: str | None = None
    email_address: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChannelBindingUpsertRequest(BaseModel):
    organization_id: str
    identity_id: str
    channel_type: Literal["email", "slack", "teams"]
    channel_target: str
    channel_account_id: str | None = None
    routing_mode: str = "auto"
    is_enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class InboundEmailEventRequest(BaseModel):
    organization_id: str
    identity_id: str | None = None
    from_email: str
    to: list[str] = Field(default_factory=list)
    subject: str | None = None
    text: str
    html: str | None = None
    external_thread_id: str | None = None
    continuity_key: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None


class InboundSlackEventRequest(BaseModel):
    organization_id: str
    identity_id: str | None = None
    sender: str
    text: str
    channel_id: str
    team_id: str | None = None
    thread_ts: str | None = None
    ts: str | None = None
    continuity_key: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None


class InboundTeamsEventRequest(BaseModel):
    organization_id: str
    identity_id: str | None = None
    sender: str
    text: str
    channel_id: str
    conversation_id: str | None = None
    message_id: str | None = None
    continuity_key: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime | None = None


class ThreadReplyRequest(BaseModel):
    organization_id: str
    message: str
    html: str | None = None
    evidence_links: list[str] = Field(default_factory=list)
    run_id: str | None = None
    recipients: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/identities/provision", response_model=AgentIdentityRecord)
async def provision_identity(
    request: IdentityProvisionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentIdentityRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _presence.provision_identity(
        organization_id=org_id,
        display_name=request.display_name,
        identity_mode=request.identity_mode,
        deployment_id=request.deployment_id,
        role_id=request.role_id,
        profile_id=request.profile_id,
        email_address=request.email_address,
        metadata=request.metadata,
        actor_id=auth.user_id,
    )


@router.get("/identities", response_model=list[AgentIdentityRecord])
async def list_identities(
    organization_id: str | None = None,
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentIdentityRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _presence.list_identities(
        organization_id=org_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/identities/{identity_id}", response_model=AgentIdentityRecord)
async def get_identity(
    identity_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentIdentityRecord:
    org_id = resolve_org_id(auth, organization_id)
    return await _presence.get_identity(organization_id=org_id, identity_id=identity_id)


@router.put("/channels/bindings", response_model=AgentChannelBindingRecord)
async def upsert_channel_binding(
    request: ChannelBindingUpsertRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentChannelBindingRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _presence.upsert_channel_binding(
        organization_id=org_id,
        identity_id=request.identity_id,
        channel_type=request.channel_type,
        channel_target=request.channel_target,
        channel_account_id=request.channel_account_id,
        routing_mode=request.routing_mode,
        is_enabled=request.is_enabled,
        config=request.config,
        metadata=request.metadata,
        actor_id=auth.user_id,
    )


@router.get("/channels/bindings", response_model=list[AgentChannelBindingRecord])
async def list_channel_bindings(
    organization_id: str | None = None,
    identity_id: str | None = Query(default=None),
    channel_type: Literal["email", "slack", "teams"] | None = Query(default=None),
    include_disabled: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentChannelBindingRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _presence.list_channel_bindings(
        organization_id=org_id,
        identity_id=identity_id,
        channel_type=channel_type,
        include_disabled=include_disabled,
        limit=limit,
        offset=offset,
    )


@router.post("/inbox/events/email", response_model=InboundChannelEventResult)
async def ingest_inbound_email(
    request: InboundEmailEventRequest,
    x_agent_inbox_token: str | None = Header(default=None, alias="X-Agent-Inbox-Token"),
) -> InboundChannelEventResult:
    _verify_inbound_token(x_agent_inbox_token)
    return await _presence.ingest_channel_event(
        organization_id=request.organization_id,
        channel_type="email",
        sender=request.from_email,
        body_text=request.text,
        subject=request.subject,
        body_html=request.html,
        recipients=request.to,
        identity_id=request.identity_id,
        channel_target=request.to[0] if request.to else None,
        external_thread_id=request.external_thread_id,
        continuity_key=request.continuity_key,
        raw_payload=request.raw,
        occurred_at=request.occurred_at,
    )


@router.post("/inbox/events/slack", response_model=InboundChannelEventResult)
async def ingest_inbound_slack(
    request: InboundSlackEventRequest,
    x_agent_inbox_token: str | None = Header(default=None, alias="X-Agent-Inbox-Token"),
) -> InboundChannelEventResult:
    _verify_inbound_token(x_agent_inbox_token)
    raw = {
        **request.raw,
        "team_id": request.team_id,
        "thread_ts": request.thread_ts,
        "ts": request.ts,
    }
    return await _presence.ingest_channel_event(
        organization_id=request.organization_id,
        channel_type="slack",
        sender=request.sender,
        body_text=request.text,
        recipients=[],
        identity_id=request.identity_id,
        channel_target=request.channel_id,
        external_thread_id=request.thread_ts or request.ts,
        continuity_key=request.continuity_key,
        raw_payload=raw,
        occurred_at=request.occurred_at,
    )


@router.post("/inbox/events/teams", response_model=InboundChannelEventResult)
async def ingest_inbound_teams(
    request: InboundTeamsEventRequest,
    x_agent_inbox_token: str | None = Header(default=None, alias="X-Agent-Inbox-Token"),
) -> InboundChannelEventResult:
    _verify_inbound_token(x_agent_inbox_token)
    raw = {
        **request.raw,
        "conversation_id": request.conversation_id,
        "id": request.message_id,
    }
    return await _presence.ingest_channel_event(
        organization_id=request.organization_id,
        channel_type="teams",
        sender=request.sender,
        body_text=request.text,
        recipients=[],
        identity_id=request.identity_id,
        channel_target=request.channel_id,
        external_thread_id=request.conversation_id or request.message_id,
        continuity_key=request.continuity_key,
        raw_payload=raw,
        occurred_at=request.occurred_at,
    )


@router.get("/inbox/threads", response_model=list[AgentInboxThreadRecord])
async def list_threads(
    organization_id: str | None = None,
    identity_id: str | None = Query(default=None),
    channel_type: Literal["email", "slack", "teams"] | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentInboxThreadRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _presence.list_threads(
        organization_id=org_id,
        identity_id=identity_id,
        channel_type=channel_type,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/inbox/threads/{thread_id}/messages", response_model=list[AgentMessageEventRecord])
async def list_thread_messages(
    thread_id: str,
    organization_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentMessageEventRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _presence.list_thread_messages(
        organization_id=org_id,
        thread_id=thread_id,
        limit=limit,
        offset=offset,
    )


@router.post("/inbox/threads/{thread_id}/reply", response_model=AgentMessageEventRecord)
async def reply_to_thread(
    thread_id: str,
    request: ThreadReplyRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentMessageEventRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _presence.reply_to_thread(
        organization_id=org_id,
        thread_id=thread_id,
        actor_id=auth.user_id,
        message=request.message,
        html=request.html,
        evidence_links=request.evidence_links,
        run_id=request.run_id,
        recipients=request.recipients,
        metadata=request.metadata,
    )
