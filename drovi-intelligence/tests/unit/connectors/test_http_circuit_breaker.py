from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.connectors.http import (
    ConnectorCircuitOpenError,
    get_connector_circuit_breaker_snapshot,
    request_with_retry,
    reset_connector_http_state,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@pytest.fixture(autouse=True)
def _reset_http_state() -> None:
    reset_connector_http_state()
    yield
    reset_connector_http_state()


def _response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.headers = {}
    return response


async def test_request_with_retry_opens_provider_circuit_breaker() -> None:
    client = AsyncMock()
    client.request = AsyncMock(return_value=_response(503))

    for _ in range(2):
        response = await request_with_retry(
            client,
            "GET",
            "https://provider.example.com/events",
            max_attempts=1,
            retry_statuses={503},
            circuit_breaker_key="provider:test",
            circuit_breaker_threshold=2,
            circuit_breaker_reset_seconds=60.0,
        )
        assert response.status_code == 503

    with pytest.raises(ConnectorCircuitOpenError):
        await request_with_retry(
            client,
            "GET",
            "https://provider.example.com/events",
            max_attempts=1,
            retry_statuses={503},
            circuit_breaker_key="provider:test",
            circuit_breaker_threshold=2,
            circuit_breaker_reset_seconds=60.0,
        )

    snapshot = get_connector_circuit_breaker_snapshot()
    assert snapshot["provider:test"]["is_open"] is True
    assert snapshot["provider:test"]["opened_total"] == 1


async def test_success_resets_provider_circuit_failure_count() -> None:
    client = AsyncMock()
    client.request = AsyncMock(
        side_effect=[
            _response(503),  # failure count: 1
            _response(200),  # reset
            _response(503),  # failure count: 1 again
        ]
    )

    first = await request_with_retry(
        client,
        "GET",
        "https://provider.example.com/events",
        max_attempts=1,
        retry_statuses={503},
        circuit_breaker_key="provider:test",
        circuit_breaker_threshold=2,
        circuit_breaker_reset_seconds=60.0,
    )
    assert first.status_code == 503

    second = await request_with_retry(
        client,
        "GET",
        "https://provider.example.com/events",
        max_attempts=1,
        retry_statuses={503},
        circuit_breaker_key="provider:test",
        circuit_breaker_threshold=2,
        circuit_breaker_reset_seconds=60.0,
    )
    assert second.status_code == 200

    third = await request_with_retry(
        client,
        "GET",
        "https://provider.example.com/events",
        max_attempts=1,
        retry_statuses={503},
        circuit_breaker_key="provider:test",
        circuit_breaker_threshold=2,
        circuit_breaker_reset_seconds=60.0,
    )
    assert third.status_code == 503

    snapshot = get_connector_circuit_breaker_snapshot()
    assert snapshot["provider:test"]["is_open"] is False
    assert snapshot["provider:test"]["failure_count"] == 1
    assert snapshot["provider:test"]["opened_total"] == 0

