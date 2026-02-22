from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.api.routes import events as events_route


def _ctx(org_id: str = "org_test") -> SimpleNamespace:
    return SimpleNamespace(organization_id=org_id)


@pytest.mark.asyncio
async def test_ingest_raw_event_processes_synchronously_when_streaming_disabled() -> None:
    request = events_route.IngestRawEventRequest(
        organization_id="org_test",
        source_type="email",
        event_type="message.received",
        source_id="conn_1",
        payload={"message_id": "m_1"},
    )

    with (
        patch("src.streaming.is_streaming_enabled", return_value=False),
        patch(
            "src.api.routes.events._process_raw_event_synchronously",
            AsyncMock(return_value=True),
        ) as sync_fallback,
    ):
        response = await events_route.ingest_raw_event(request=request, ctx=_ctx())

    assert response.success is True
    assert response.kafka_produced is False
    assert response.message == "Event processed synchronously"
    sync_fallback.assert_awaited_once()


@pytest.mark.asyncio
async def test_ingest_raw_event_falls_back_when_kafka_produce_fails() -> None:
    request = events_route.IngestRawEventRequest(
        organization_id="org_test",
        source_type="slack",
        event_type="message.received",
        source_id="conn_2",
        payload={"channel": "C123"},
    )
    producer = SimpleNamespace(
        produce_raw_event=AsyncMock(side_effect=RuntimeError("kafka unavailable"))
    )

    with (
        patch("src.streaming.is_streaming_enabled", return_value=True),
        patch(
            "src.streaming.get_kafka_producer",
            AsyncMock(return_value=producer),
        ),
        patch(
            "src.api.routes.events._process_raw_event_synchronously",
            AsyncMock(return_value=True),
        ) as sync_fallback,
    ):
        response = await events_route.ingest_raw_event(request=request, ctx=_ctx())

    assert response.success is True
    assert response.kafka_produced is False
    assert response.message == "Event processed synchronously"
    sync_fallback.assert_awaited_once()


@pytest.mark.asyncio
async def test_process_raw_event_sync_skips_non_webhooks_in_webhook_only_mode() -> None:
    with patch(
        "src.config.get_settings",
        return_value=SimpleNamespace(kafka_raw_event_mode="webhook_only"),
    ):
        processed = await events_route._process_raw_event_synchronously(
            organization_id="org_test",
            source_type="email",
            event_type="message.received",
            source_id="conn_1",
            payload={"subject": "hello"},
        )

    assert processed is False


@pytest.mark.asyncio
async def test_process_raw_event_sync_handles_connector_webhook_events() -> None:
    processor = AsyncMock(return_value=None)

    with (
        patch(
            "src.config.get_settings",
            return_value=SimpleNamespace(kafka_raw_event_mode="full"),
        ),
        patch(
            "src.connectors.webhooks.processor.process_connector_webhook_event",
            processor,
        ),
    ):
        processed = await events_route._process_raw_event_synchronously(
            organization_id="org_test",
            source_type="slack",
            event_type="connector.webhook",
            source_id="conn_7",
            payload={"type": "event_callback"},
        )

    assert processed is True
    processor.assert_awaited_once()
