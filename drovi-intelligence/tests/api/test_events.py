"""
API tests for Events endpoints.

Tests the real-time event streaming and event management APIs.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class TestEventTypesEndpoint:
    """Tests for GET /events/types."""

    async def test_list_event_types(self, async_client):
        """Test listing all event types."""
        response = await async_client.get("/api/v1/events/types")

        assert response.status_code == 200
        data = response.json()

        assert "event_types" in data
        assert "total_count" in data
        assert data["total_count"] > 0

        # Check categories exist
        categories = data["event_types"]
        assert "uio_lifecycle" in categories or len(categories) > 0

    async def test_event_types_have_required_fields(self, async_client):
        """Test event types have all required fields."""
        response = await async_client.get("/api/v1/events/types")
        data = response.json()

        for category, events in data["event_types"].items():
            for event in events:
                assert "name" in event
                assert "category" in event
                assert "description" in event
                assert event["category"] == category


class TestStreamInfoEndpoint:
    """Tests for GET /events/stream/info."""

    async def test_get_stream_info(self, async_client, factory):
        """Test getting stream connection info."""
        org_id = factory.organization_id()
        response = await async_client.get(
            "/api/v1/events/stream/info",
            params={"organization_id": org_id},
        )

        assert response.status_code == 200
        data = response.json()

        assert "url" in data
        assert "example_js" in data
        assert "available_filters" in data

        # URL should contain org_id
        assert org_id in data["url"]

        # Should have JS example
        assert "EventSource" in data["example_js"]

    async def test_stream_info_requires_org_id(self, async_client):
        """Test stream info requires organization_id."""
        response = await async_client.get("/api/v1/events/stream/info")

        assert response.status_code == 422  # Validation error


class TestPublishEventEndpoint:
    """Tests for POST /events/publish."""

    async def test_publish_event_success(self, async_client, factory, mock_redis):
        """Test publishing an event successfully."""
        with patch("src.api.routes.events.get_event_publisher") as mock_get:
            mock_publisher = AsyncMock()
            mock_publisher.publish.return_value = True
            mock_get.return_value = mock_publisher

            response = await async_client.post(
                "/api/v1/events/publish",
                json={
                    "event_type": "uio.created",
                    "organization_id": factory.organization_id(),
                    "payload": {"uio_id": "test_123"},
                },
            )

            assert response.status_code == 200
            data = response.json()

            assert data["success"] is True
            assert "event_id" in data
            assert data["message"] == "Event published successfully"

    async def test_publish_event_invalid_type(self, async_client, factory):
        """Test publishing with invalid event type."""
        response = await async_client.post(
            "/api/v1/events/publish",
            json={
                "event_type": "invalid.event.type",
                "organization_id": factory.organization_id(),
                "payload": {},
            },
        )

        assert response.status_code == 400
        assert "Invalid event type" in response.json()["detail"]

    async def test_publish_event_with_correlation_id(self, async_client, factory):
        """Test publishing with correlation ID."""
        with patch("src.api.routes.events.get_event_publisher") as mock_get:
            mock_publisher = AsyncMock()
            mock_publisher.publish.return_value = True
            mock_get.return_value = mock_publisher

            response = await async_client.post(
                "/api/v1/events/publish",
                json={
                    "event_type": "commitment.created",
                    "organization_id": factory.organization_id(),
                    "payload": {"commitment_id": "comm_123"},
                    "correlation_id": "req_456",
                    "broadcast": True,
                },
            )

            assert response.status_code == 200

            # Verify publisher was called with broadcast=True
            mock_publisher.publish.assert_called_once()
            call_args = mock_publisher.publish.call_args
            assert call_args.kwargs["broadcast"] is True

    async def test_publish_event_missing_org_id(self, async_client):
        """Test publishing without organization_id."""
        response = await async_client.post(
            "/api/v1/events/publish",
            json={
                "event_type": "uio.created",
                "payload": {},
            },
        )

        assert response.status_code == 422  # Validation error


class TestEventStreamEndpoint:
    """Tests for GET /events/stream (SSE)."""

    async def test_stream_returns_sse_content_type(self, async_client, factory):
        """Test stream returns correct content type."""
        # SSE endpoints never "finish" by design. Patch the EventStream to be
        # finite so the response completes and the test is deterministic.
        org_id = factory.organization_id()

        class _FiniteEventStream:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

        with patch("src.api.routes.events.EventStream", _FiniteEventStream):
            response = await async_client.get(
                "/api/v1/events/stream",
                params={"organization_id": org_id, "event_types": "uio.created"},
            )

        assert response.status_code == 200
        assert response.headers.get("content-type", "").startswith("text/event-stream")
        assert "connected" in response.text

    async def test_stream_accepts_event_type_filters(self, async_client, factory):
        """Test stream accepts event type filters."""
        # Verify the endpoint accepts the filters parameter
        org_id = factory.organization_id()

        class _FiniteEventStream:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

        with patch("src.api.routes.events.EventStream", _FiniteEventStream):
            response = await async_client.get(
                "/api/v1/events/stream",
                params={
                    "organization_id": org_id,
                    "event_types": "uio.created,commitment.due,risk.detected",
                    "include_broadcast": True,
                },
            )

        assert response.status_code == 200


class TestEventIntegration:
    """Integration tests for event system."""

    async def test_event_type_consistency(self, async_client):
        """Test event types are consistent across endpoints."""
        # Get available types
        types_response = await async_client.get("/api/v1/events/types")
        available_types = []

        for category, events in types_response.json()["event_types"].items():
            for event in events:
                available_types.append(event["name"])

        # Get stream info
        stream_response = await async_client.get(
            "/api/v1/events/stream/info",
            params={"organization_id": "test_org"},
        )
        filter_types = stream_response.json()["available_filters"]

        # All filter types should be in available types
        for filter_type in filter_types:
            assert filter_type in available_types, f"Filter type {filter_type} not in available types"
