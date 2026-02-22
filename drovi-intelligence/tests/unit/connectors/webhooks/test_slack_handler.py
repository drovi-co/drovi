"""Unit tests for Slack webhook handler actions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

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
    def __init__(self, row=None, candidates=None):
        self._row = row
        self._candidates = candidates or []

    async def fetchrow(self, query, *args):
        return self._row

    async def fetch(self, query, *args):
        return self._candidates


class TestSlackWebhookHandler:
    @pytest.mark.asyncio
    async def test_update_message_metadata_enqueues_event(self):
        from src.connectors.webhooks.handlers.slack import SlackWebhookHandler

        handler = SlackWebhookHandler()
        scheduler = MagicMock()
        scheduler.trigger_sync_by_id = AsyncMock()

        with patch.object(handler, "_find_connection_for_team", AsyncMock(return_value="conn_slack")):
            with patch.object(handler, "_get_org_id_for_connection", AsyncMock(return_value="org_slack")):
                with patch("src.connectors.webhooks.handlers.slack.enqueue_webhook_event", AsyncMock(return_value={"inserted": True})) as enqueue_mock:
                    with patch("src.connectors.scheduling.scheduler.get_scheduler", return_value=scheduler):
                        with patch("src.streaming.is_streaming_enabled", return_value=True):
                            await handler._update_message_metadata(
                                team_id="T123",
                                channel_id="C123",
                                message_ts="1700000000.000100",
                                reaction="thumbsup",
                                added=True,
                            )

        kwargs = enqueue_mock.await_args.kwargs
        assert kwargs["event_type"] == "slack.message_metadata"
        assert kwargs["streams"] == ["messages"]
        assert kwargs["sync_params"]["metadata_only"] is True
        scheduler.trigger_sync_by_id.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_refresh_channel_list_triggers_fallback_sync_without_kafka(self):
        from src.connectors.webhooks.handlers.slack import SlackWebhookHandler

        handler = SlackWebhookHandler()
        scheduler = MagicMock()
        scheduler.trigger_sync_by_id = AsyncMock()

        with patch.object(handler, "_find_connection_for_team", AsyncMock(return_value="conn_slack")):
            with patch.object(handler, "_get_org_id_for_connection", AsyncMock(return_value="org_slack")):
                with patch("src.connectors.webhooks.handlers.slack.enqueue_webhook_event", AsyncMock(return_value={"inserted": True})):
                    with patch("src.connectors.scheduling.scheduler.get_scheduler", return_value=scheduler):
                        with patch("src.streaming.is_streaming_enabled", return_value=False):
                            await handler._refresh_channel_list(team_id="T123")

        assert scheduler.trigger_sync_by_id.await_count == 1
        trigger_kwargs = scheduler.trigger_sync_by_id.await_args.kwargs
        assert trigger_kwargs["streams"] == ["channels"]
        assert trigger_kwargs["full_refresh"] is True
        assert trigger_kwargs["job_type"].value == "webhook"

    @pytest.mark.asyncio
    async def test_find_connection_for_team_falls_back_to_single_active_connection(self):
        from src.connectors.webhooks.handlers.slack import SlackWebhookHandler

        handler = SlackWebhookHandler()
        pool = _FakePool(
            _FakeConn(
                row=None,
                candidates=[{"id": "conn_only"}],
            )
        )

        with patch("src.db.client.get_db_pool", AsyncMock(return_value=pool)):
            connection_id = await handler._find_connection_for_team("UNKNOWN_TEAM")

        assert connection_id == "conn_only"
