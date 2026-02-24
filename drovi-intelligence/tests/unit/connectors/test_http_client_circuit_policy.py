from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig
from src.connectors.http_client import connector_request
from src.connectors.sources.world.commercial_premium import CommercialPremiumConnector

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


@pytest.mark.asyncio
async def test_connector_request_uses_definition_circuit_breaker_policy() -> None:
    connector = CommercialPremiumConnector()
    config = ConnectorConfig(
        connection_id="conn_1",
        organization_id="org_1",
        connector_type="commercial_premium",
        name="Premium Feed",
        auth=AuthConfig(auth_type=AuthType.NONE),
    )
    client = AsyncMock()
    fake_response = MagicMock()

    with patch(
        "src.connectors.http_client.request_with_retry",
        new=AsyncMock(return_value=fake_response),
    ) as mock_request:
        response = await connector_request(
            connector=connector,
            config=config,
            client=client,
            method="GET",
            url="https://provider.example.com/events",
            operation="test_op",
        )

    assert response is fake_response
    kwargs = mock_request.await_args.kwargs
    assert kwargs["circuit_breaker_key"] == "provider:commercial_premium"
    assert kwargs["circuit_breaker_threshold"] == 3
    assert kwargs["circuit_breaker_reset_seconds"] == 45.0
    assert kwargs["circuit_breaker_enabled"] is True

