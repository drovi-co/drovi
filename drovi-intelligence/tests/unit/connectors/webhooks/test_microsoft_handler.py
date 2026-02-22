"""Unit tests for Microsoft webhook handler."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

pytestmark = pytest.mark.unit


class _FakeAcquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _FakeAcquire(self._conn)


class _FakeConn:
    def __init__(self, fetch_results: list[list[dict[str, str]]]):
        self._fetch_results = list(fetch_results)
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, query: str, *args):
        self.fetch_calls.append((query, args))
        if self._fetch_results:
            return self._fetch_results.pop(0)
        return []


class TestMicrosoftWebhookHandler:
    @pytest.mark.asyncio
    async def test_handle_notification_queues_teams_event(self):
        from src.connectors.webhooks.handlers.microsoft import MicrosoftWebhookHandler

        notification = {
            "subscriptionId": "sub_123",
            "changeType": "created",
            "resource": "/users/user_123/chats/chat_123/messages/message_123",
            "tenantId": "tenant_123",
            "resourceData": {"id": "message_123"},
        }

        conn = _FakeConn(
            fetch_results=[
                [{"id": "conn_teams", "organization_id": "org_teams", "connector_type": "teams"}],
            ]
        )
        pool = _FakePool(conn)

        with patch("src.connectors.webhooks.handlers.microsoft.get_db_pool", AsyncMock(return_value=pool)):
            with patch("src.connectors.webhooks.handlers.microsoft.enqueue_webhook_event", AsyncMock(return_value={"inserted": True})) as enqueue_mock:
                with patch("src.streaming.is_streaming_enabled", return_value=True):
                    handler = MicrosoftWebhookHandler()
                    result = await handler.handle_notification(notification)

        assert result["status"] == "queued"
        assert result["resolved_connections"] == 1
        assert result["queued"] == 1

        kwargs = enqueue_mock.await_args.kwargs
        assert kwargs["provider"] == "teams"
        assert kwargs["connection_id"] == "conn_teams"
        assert kwargs["organization_id"] == "org_teams"
        assert kwargs["event_type"] == "microsoft.teams.created"
        assert kwargs["streams"] == ["chat_messages"]

    @pytest.mark.asyncio
    async def test_handle_notification_queues_outlook_event_by_email(self):
        from src.connectors.webhooks.handlers.microsoft import MicrosoftWebhookHandler

        notification = {
            "subscriptionId": "sub_abc",
            "changeType": "updated",
            "resource": "/users/user_123/messages/message_123",
            "email": "user@example.com",
            "resourceData": {"id": "message_123"},
        }

        conn = _FakeConn(
            fetch_results=[
                [{"id": "conn_outlook", "organization_id": "org_outlook", "connector_type": "outlook"}],
            ]
        )
        pool = _FakePool(conn)

        with patch("src.connectors.webhooks.handlers.microsoft.get_db_pool", AsyncMock(return_value=pool)):
            with patch("src.connectors.webhooks.handlers.microsoft.enqueue_webhook_event", AsyncMock(return_value={"inserted": True})) as enqueue_mock:
                with patch("src.streaming.is_streaming_enabled", return_value=True):
                    handler = MicrosoftWebhookHandler()
                    result = await handler.handle_notification(notification)

        assert result["status"] == "queued"
        kwargs = enqueue_mock.await_args.kwargs
        assert kwargs["provider"] == "outlook"
        assert kwargs["streams"] == ["messages"]
        assert kwargs["event_type"] == "microsoft.outlook.updated"

    @pytest.mark.asyncio
    async def test_handle_notification_ignored_when_not_resolved(self):
        from src.connectors.webhooks.handlers.microsoft import MicrosoftWebhookHandler

        notification = {
            "subscriptionId": "sub_none",
            "changeType": "updated",
            "resource": "/users/user_123/messages/message_123",
            "resourceData": {"id": "message_123"},
        }

        conn = _FakeConn(
            fetch_results=[
                [
                    {"id": "conn_a", "organization_id": "org_a", "connector_type": "outlook"},
                    {"id": "conn_b", "organization_id": "org_b", "connector_type": "outlook"},
                ],
            ]
        )
        pool = _FakePool(conn)

        with patch("src.connectors.webhooks.handlers.microsoft.get_db_pool", AsyncMock(return_value=pool)):
            with patch("src.connectors.webhooks.handlers.microsoft.enqueue_webhook_event", AsyncMock()) as enqueue_mock:
                with patch("src.streaming.is_streaming_enabled", return_value=True):
                    handler = MicrosoftWebhookHandler()
                    result = await handler.handle_notification(notification)

        assert result["status"] == "ignored"
        assert result["resolved_connections"] == 0
        enqueue_mock.assert_not_awaited()
