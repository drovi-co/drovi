"""Unit tests for Notion webhook handler."""

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


class TestNotionWebhookHandler:
    @pytest.mark.asyncio
    async def test_handle_event_queues_workspace_match(self):
        from src.connectors.webhooks.handlers.notion import NotionWebhookHandler

        payload = {
            "type": "page.updated",
            "workspace_id": "ws_123",
            "data": {"id": "page_123", "object": "page"},
        }
        conn = _FakeConn(
            fetch_results=[
                [{"id": "conn_123", "organization_id": "org_123"}],
            ]
        )
        pool = _FakePool(conn)

        with patch("src.connectors.webhooks.handlers.notion.get_db_pool", AsyncMock(return_value=pool)):
            with patch("src.connectors.webhooks.handlers.notion.enqueue_webhook_event", AsyncMock(return_value={"inserted": True})) as enqueue_mock:
                with patch("src.streaming.is_streaming_enabled", return_value=True):
                    handler = NotionWebhookHandler()
                    result = await handler.handle_event(payload)

        assert result["status"] == "queued"
        assert result["resolved_connections"] == 1
        assert result["queued"] == 1

        kwargs = enqueue_mock.await_args.kwargs
        assert kwargs["provider"] == "notion"
        assert kwargs["connection_id"] == "conn_123"
        assert kwargs["organization_id"] == "org_123"
        assert kwargs["event_type"] == "notion.page.updated"
        assert kwargs["streams"] == ["pages"]
        assert kwargs["sync_params"]["workspace_id"] == "ws_123"
        assert kwargs["sync_params"]["object_id"] == "page_123"

    @pytest.mark.asyncio
    async def test_handle_event_ignored_when_no_targets(self):
        from src.connectors.webhooks.handlers.notion import NotionWebhookHandler

        payload = {
            "type": "page.updated",
            "workspace_id": "ws_missing",
            "data": {"id": "page_123", "object": "page"},
        }
        conn = _FakeConn(fetch_results=[[]])
        pool = _FakePool(conn)

        with patch("src.connectors.webhooks.handlers.notion.get_db_pool", AsyncMock(return_value=pool)):
            with patch("src.connectors.webhooks.handlers.notion.enqueue_webhook_event", AsyncMock()) as enqueue_mock:
                with patch("src.streaming.is_streaming_enabled", return_value=True):
                    handler = NotionWebhookHandler()
                    result = await handler.handle_event(payload)

        assert result["status"] == "ignored"
        assert result["resolved_connections"] == 0
        assert result["queued"] == 0
        enqueue_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_event_falls_back_to_single_active_connection(self):
        from src.connectors.webhooks.handlers.notion import NotionWebhookHandler

        payload = {
            "type": "database.updated",
            "data": {"id": "db_123", "object": "database"},
        }
        conn = _FakeConn(
            fetch_results=[
                [{"id": "conn_fallback", "organization_id": "org_fallback"}],
            ]
        )
        pool = _FakePool(conn)

        with patch("src.connectors.webhooks.handlers.notion.get_db_pool", AsyncMock(return_value=pool)):
            with patch("src.connectors.webhooks.handlers.notion.enqueue_webhook_event", AsyncMock(return_value={"inserted": True})) as enqueue_mock:
                with patch("src.streaming.is_streaming_enabled", return_value=True):
                    handler = NotionWebhookHandler()
                    result = await handler.handle_event(payload)

        assert result["status"] == "queued"
        assert result["resolved_connections"] == 1
        kwargs = enqueue_mock.await_args.kwargs
        assert kwargs["connection_id"] == "conn_fallback"
        assert kwargs["streams"] == ["databases"]
