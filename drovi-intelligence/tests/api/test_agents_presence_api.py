from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.agentos.presence.models import (
    AgentChannelBindingRecord,
    AgentIdentityRecord,
    AgentInboxThreadRecord,
    AgentMessageEventRecord,
    InboundChannelEventResult,
    ParsedChannelAction,
)

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _identity() -> AgentIdentityRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    return AgentIdentityRecord(
        id="agidn_1",
        organization_id="org_test",
        display_name="Sales Agent",
        identity_mode="virtual_persona",
        email_address="sales-agent@agents.drovi.co",
        created_at=now,
        updated_at=now,
    )


def _binding(channel_type: str = "email") -> AgentChannelBindingRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    target = {
        "email": "sales-agent@agents.drovi.co",
        "slack": "C123",
        "teams": "19:team-thread",
    }[channel_type]
    return AgentChannelBindingRecord(
        id="agchb_1",
        organization_id="org_test",
        identity_id="agidn_1",
        channel_type=channel_type,
        channel_target=target,
        routing_mode="auto",
        is_enabled=True,
        config={},
        metadata={},
        created_at=now,
        updated_at=now,
    )


def _thread(channel_type: str = "email") -> AgentInboxThreadRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    return AgentInboxThreadRecord(
        id="agthr_1",
        organization_id="org_test",
        identity_id="agidn_1",
        channel_type=channel_type,
        external_thread_id="thread_abc",
        continuity_key="key_1",
        subject="Subject",
        status="open",
        last_message_at=now,
        metadata={},
        created_at=now,
        updated_at=now,
    )


def _message(direction: str = "inbound") -> AgentMessageEventRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    return AgentMessageEventRecord(
        id="agmsg_1",
        organization_id="org_test",
        thread_id="agthr_1",
        identity_id="agidn_1",
        direction=direction,
        event_type="email.message.received" if direction == "inbound" else "email.message.sent",
        sender="client@acme.com",
        recipients=["sales-agent@agents.drovi.co"] if direction == "inbound" else ["client@acme.com"],
        subject="Subject",
        body_text="hello",
        raw_payload={},
        parsed_task={},
        message_status="received" if direction == "inbound" else "sent",
        occurred_at=now,
        created_at=now,
    )


class TestPresenceCrud:
    async def test_provision_identity(self, async_client):
        with patch(
            "src.api.routes.agents_presence._presence.provision_identity",
            AsyncMock(return_value=_identity()),
        ):
            response = await async_client.post(
                "/api/v1/agents/identities/provision",
                json={
                    "organization_id": "org_test",
                    "display_name": "Sales Agent",
                    "identity_mode": "virtual_persona",
                },
            )

        assert response.status_code == 200
        assert response.json()["id"] == "agidn_1"

    async def test_upsert_channel_binding(self, async_client):
        with patch(
            "src.api.routes.agents_presence._presence.upsert_channel_binding",
            AsyncMock(return_value=_binding("slack")),
        ):
            response = await async_client.put(
                "/api/v1/agents/channels/bindings",
                json={
                    "organization_id": "org_test",
                    "identity_id": "agidn_1",
                    "channel_type": "slack",
                    "channel_target": "C123",
                },
            )

        assert response.status_code == 200
        assert response.json()["channel_type"] == "slack"


class TestInboundFlows:
    async def test_email_inbound_then_reply_loop(self, async_client):
        inbound = InboundChannelEventResult(
            thread=_thread("email"),
            message=_message("inbound"),
            parsed_action=ParsedChannelAction(intent="task", summary="Draft the update", confidence=0.8),
            approval_applied=None,
        )
        outbound = _message("outbound")
        with (
            patch(
                "src.api.routes.agents_presence.get_settings",
                return_value=SimpleNamespace(agent_inbox_inbound_token="token_123"),
            ),
            patch("src.api.routes.agents_presence._presence.ingest_channel_event", AsyncMock(return_value=inbound)),
            patch("src.api.routes.agents_presence._presence.reply_to_thread", AsyncMock(return_value=outbound)),
        ):
            inbound_response = await async_client.post(
                "/api/v1/agents/inbox/events/email",
                headers={"X-Agent-Inbox-Token": "token_123"},
                json={
                    "organization_id": "org_test",
                    "from_email": "client@acme.com",
                    "to": ["sales-agent@agents.drovi.co"],
                    "text": "Please draft and send me the weekly summary",
                },
            )
            reply_response = await async_client.post(
                "/api/v1/agents/inbox/threads/agthr_1/reply",
                json={
                    "organization_id": "org_test",
                    "message": "Here is your weekly summary.",
                    "run_id": "agrun_1",
                    "evidence_links": ["https://example.com/evidence/1"],
                },
            )

        assert inbound_response.status_code == 200
        assert inbound_response.json()["parsed_action"]["intent"] == "task"
        assert reply_response.status_code == 200
        assert reply_response.json()["direction"] == "outbound"

    async def test_slack_routing_keeps_thread_continuity(self, async_client):
        inbound = InboundChannelEventResult(
            thread=_thread("slack"),
            message=_message("inbound"),
            parsed_action=ParsedChannelAction(intent="question", summary="status?", confidence=0.7),
            approval_applied=None,
        )
        with (
            patch(
                "src.api.routes.agents_presence.get_settings",
                return_value=SimpleNamespace(agent_inbox_inbound_token="token_123"),
            ),
            patch("src.api.routes.agents_presence._presence.ingest_channel_event", AsyncMock(return_value=inbound)) as ingest,
        ):
            response = await async_client.post(
                "/api/v1/agents/inbox/events/slack",
                headers={"X-Agent-Inbox-Token": "token_123"},
                json={
                    "organization_id": "org_test",
                    "sender": "U01",
                    "text": "@agent what changed today?",
                    "channel_id": "C123",
                    "thread_ts": "1715085622.010100",
                },
            )

        assert response.status_code == 200
        kwargs = ingest.await_args.kwargs
        assert kwargs["external_thread_id"] == "1715085622.010100"
        assert kwargs["channel_type"] == "slack"

    async def test_teams_approval_action_via_inbound(self, async_client):
        inbound = InboundChannelEventResult(
            thread=_thread("teams"),
            message=_message("inbound"),
            parsed_action=ParsedChannelAction(
                intent="approval",
                summary="approved agapr_1",
                confidence=0.98,
                approval_id="agapr_1",
                approval_decision="approved",
            ),
            approval_applied={"id": "agapr_1", "status": "approved"},
        )
        with (
            patch(
                "src.api.routes.agents_presence.get_settings",
                return_value=SimpleNamespace(agent_inbox_inbound_token="token_123"),
            ),
            patch("src.api.routes.agents_presence._presence.ingest_channel_event", AsyncMock(return_value=inbound)),
        ):
            response = await async_client.post(
                "/api/v1/agents/inbox/events/teams",
                headers={"X-Agent-Inbox-Token": "token_123"},
                json={
                    "organization_id": "org_test",
                    "sender": "user@contoso.com",
                    "text": "approve agapr_1: looks good",
                    "channel_id": "19:team-thread",
                    "conversation_id": "19:conv-thread",
                },
            )

        assert response.status_code == 200
        assert response.json()["approval_applied"]["status"] == "approved"

    async def test_inbound_rejects_invalid_token(self, async_client):
        with patch(
            "src.api.routes.agents_presence.get_settings",
            return_value=SimpleNamespace(agent_inbox_inbound_token="token_123"),
        ):
            response = await async_client.post(
                "/api/v1/agents/inbox/events/email",
                headers={"X-Agent-Inbox-Token": "wrong"},
                json={
                    "organization_id": "org_test",
                    "from_email": "client@acme.com",
                    "to": ["sales-agent@agents.drovi.co"],
                    "text": "Hello",
                },
            )

        assert response.status_code == 401


class TestPresenceSecurity:
    async def test_list_threads_rejects_cross_org(self, app, async_client):
        from src.auth.context import AuthMetadata, AuthType
        from src.auth.middleware import APIKeyContext, get_api_key_context, get_auth_context

        async def fake_ctx():
            return APIKeyContext(
                organization_id="org_a",
                auth_subject_id="user_user_a",
                scopes=["read", "write"],
                metadata=AuthMetadata(
                    auth_type=AuthType.SESSION,
                    user_email="pilot@example.com",
                    user_id="user_a",
                    key_id="session:user_a",
                    key_name="Session",
                ),
                is_internal=False,
                rate_limit_per_minute=1000,
            )

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.get("/api/v1/agents/inbox/threads", params={"organization_id": "org_b"})
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]
