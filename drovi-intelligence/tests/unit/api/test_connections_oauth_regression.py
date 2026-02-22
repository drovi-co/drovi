from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.api.routes import connections as connections_route


class _FakeSessionContext:
    def __init__(self, session: AsyncMock):
        self._session = session

    async def __aenter__(self) -> AsyncMock:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


def _ctx(org_id: str = "org_test") -> SimpleNamespace:
    return SimpleNamespace(organization_id=org_id)


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        google_client_id="google_id",
        google_client_secret="google_secret",
        microsoft_client_id="ms_id",
        microsoft_client_secret="ms_secret",
        slack_client_id="slack_id",
        slack_client_secret="slack_secret",
        notion_client_id="notion_id",
        notion_client_secret="notion_secret",
        hubspot_client_id="hubspot_id",
        hubspot_client_secret="hubspot_secret",
    )


@pytest.mark.asyncio
async def test_initiate_oauth_returns_compatibility_urls() -> None:
    oauth_manager = MagicMock()
    oauth_manager.get_authorization_url.return_value = (
        "https://accounts.example/authorize?state=abc"
    )
    provider = SimpleNamespace(value="google")

    with (
        patch("src.api.routes.connections.get_settings", return_value=_settings()),
        patch(
            "src.api.routes.connections._resolve_oauth_provider_and_scopes",
            return_value=(provider, ["scope.a"]),
        ),
        patch("src.connectors.auth.oauth2.configure_oauth", return_value=oauth_manager),
    ):
        response = await connections_route.initiate_oauth(
            request=connections_route.OAuthInitRequest(
                connector_type="gmail",
                organization_id="org_test",
                redirect_uri="https://app.example/callback",
                state=None,
            ),
            ctx=_ctx(),
        )

    assert response.authorization_url == response.auth_url
    assert response.authorization_url.startswith("https://accounts.example")
    assert response.state
    oauth_manager.get_authorization_url.assert_called_once()


@pytest.mark.asyncio
async def test_oauth_callback_stores_tokens_and_activates_connection() -> None:
    connection = SimpleNamespace(
        id="conn_123",
        organization_id="org_test",
        connector_type="gmail",
        config={"redirect_uri": "https://app.example/callback"},
        status="pending_auth",
        updated_at=datetime.now(timezone.utc),
    )

    session = AsyncMock()
    session.execute = AsyncMock(
        return_value=SimpleNamespace(scalar_one_or_none=lambda: connection)
    )

    oauth_manager = MagicMock()
    oauth_manager.exchange_code = AsyncMock(
        return_value={
            "access_token": "access_123",
            "refresh_token": "refresh_123",
            "expires_in": 3600,
            "scope": "scope.a",
            "token_type": "Bearer",
        }
    )
    token_store = MagicMock()
    token_store.store_tokens = AsyncMock(return_value=None)
    provider = SimpleNamespace(value="google")

    with (
        patch(
            "src.api.routes.connections.get_db_session",
            lambda: _FakeSessionContext(session),
        ),
        patch("src.api.routes.connections.get_settings", return_value=_settings()),
        patch(
            "src.api.routes.connections._resolve_oauth_provider_and_scopes",
            return_value=(provider, None),
        ),
        patch("src.connectors.auth.oauth2.configure_oauth", return_value=oauth_manager),
        patch(
            "src.connectors.auth.token_store.get_token_store",
            AsyncMock(return_value=token_store),
        ),
    ):
        response = await connections_route.oauth_callback(
            connection_id="conn_123",
            request=connections_route.OAuthCallbackRequest(code="oauth_code", state="state_1"),
            ctx=_ctx(),
        )

    assert response["success"] is True
    assert response["status"] == "active"
    assert connection.status == "active"
    token_store.store_tokens.assert_awaited_once()
    kwargs = token_store.store_tokens.await_args.kwargs
    assert kwargs["connection_id"] == "conn_123"
    assert kwargs["organization_id"] == "org_test"
    assert kwargs["provider"] == "google"
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_oauth_callback_requires_redirect_uri() -> None:
    connection = SimpleNamespace(
        id="conn_123",
        organization_id="org_test",
        connector_type="gmail",
        config={},
        status="pending_auth",
        updated_at=datetime.now(timezone.utc),
    )
    session = AsyncMock()
    session.execute = AsyncMock(
        return_value=SimpleNamespace(scalar_one_or_none=lambda: connection)
    )
    provider = SimpleNamespace(value="google")

    with (
        patch(
            "src.api.routes.connections.get_db_session",
            lambda: _FakeSessionContext(session),
        ),
        patch(
            "src.api.routes.connections._resolve_oauth_provider_and_scopes",
            return_value=(provider, None),
        ),
        patch("src.api.routes.connections.get_settings", return_value=_settings()),
        patch("src.connectors.auth.oauth2.configure_oauth", return_value=MagicMock()),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await connections_route.oauth_callback(
                connection_id="conn_123",
                request=connections_route.OAuthCallbackRequest(
                    code="oauth_code",
                    state="state_1",
                ),
                ctx=_ctx(),
            )

    assert exc_info.value.status_code == 400
    assert "redirect_uri" in str(exc_info.value.detail)
