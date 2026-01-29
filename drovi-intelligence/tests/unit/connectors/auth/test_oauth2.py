"""
Unit tests for OAuth2 Manager.

Tests OAuth2 flows, token management, and provider configurations.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from src.connectors.auth.oauth2 import (
    OAuth2Provider,
    OAuth2ProviderConfig,
    OAuth2Tokens,
    OAuth2Manager,
    PROVIDER_CONFIGS,
    get_oauth_manager,
    configure_oauth,
)

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def oauth_manager():
    """Create a configured OAuth2 manager."""
    manager = OAuth2Manager()
    manager.configure_provider(
        OAuth2Provider.GOOGLE,
        client_id="google_client_id",
        client_secret="google_client_secret",
    )
    manager.configure_provider(
        OAuth2Provider.MICROSOFT,
        client_id="microsoft_client_id",
        client_secret="microsoft_client_secret",
    )
    manager.configure_provider(
        OAuth2Provider.SLACK,
        client_id="slack_client_id",
        client_secret="slack_client_secret",
    )
    return manager


@pytest.fixture
def valid_tokens():
    """Create valid OAuth2 tokens."""
    return OAuth2Tokens(
        access_token="access_token_123",
        refresh_token="refresh_token_456",
        token_type="Bearer",
        expires_at=datetime.utcnow() + timedelta(hours=1),
        scopes=["read", "write"],
    )


@pytest.fixture
def expired_tokens():
    """Create expired OAuth2 tokens."""
    return OAuth2Tokens(
        access_token="expired_access_token",
        refresh_token="refresh_token_456",
        token_type="Bearer",
        expires_at=datetime.utcnow() - timedelta(hours=1),
        scopes=["read", "write"],
    )


# =============================================================================
# OAuth2Provider Enum Tests
# =============================================================================


class TestOAuth2Provider:
    """Tests for OAuth2Provider enum."""

    def test_provider_values(self):
        """Test provider enum values."""
        assert OAuth2Provider.GOOGLE.value == "google"
        assert OAuth2Provider.MICROSOFT.value == "microsoft"
        assert OAuth2Provider.SLACK.value == "slack"
        assert OAuth2Provider.NOTION.value == "notion"
        assert OAuth2Provider.HUBSPOT.value == "hubspot"
        assert OAuth2Provider.SALESFORCE.value == "salesforce"

    def test_all_providers_have_configs(self):
        """Test all providers have default configs."""
        for provider in OAuth2Provider:
            assert provider in PROVIDER_CONFIGS


# =============================================================================
# OAuth2ProviderConfig Tests
# =============================================================================


class TestOAuth2ProviderConfig:
    """Tests for OAuth2ProviderConfig model."""

    def test_create_config(self):
        """Test creating provider config."""
        config = OAuth2ProviderConfig(
            provider=OAuth2Provider.GOOGLE,
            client_id="client_id",
            client_secret="client_secret",
            authorization_url="https://example.com/auth",
            token_url="https://example.com/token",
        )

        assert config.provider == OAuth2Provider.GOOGLE
        assert config.client_id == "client_id"
        assert config.supports_refresh is True

    def test_default_values(self):
        """Test default config values."""
        config = OAuth2ProviderConfig(
            provider=OAuth2Provider.GOOGLE,
            client_id="client_id",
            client_secret="client_secret",
            authorization_url="https://example.com/auth",
            token_url="https://example.com/token",
        )

        assert config.revoke_url is None
        assert config.default_scopes == []
        assert config.token_expiry_buffer_seconds == 300
        assert config.requires_pkce is False


# =============================================================================
# OAuth2Tokens Tests
# =============================================================================


class TestOAuth2Tokens:
    """Tests for OAuth2Tokens model."""

    def test_create_tokens(self, valid_tokens):
        """Test creating tokens."""
        assert valid_tokens.access_token == "access_token_123"
        assert valid_tokens.refresh_token == "refresh_token_456"
        assert valid_tokens.token_type == "Bearer"

    def test_is_expired_not_expired(self, valid_tokens):
        """Test is_expired for valid tokens."""
        assert valid_tokens.is_expired is False

    def test_is_expired_expired(self, expired_tokens):
        """Test is_expired for expired tokens."""
        assert expired_tokens.is_expired is True

    def test_is_expired_no_expiry(self):
        """Test is_expired when no expiry set."""
        tokens = OAuth2Tokens(
            access_token="token",
            expires_at=None,
        )
        assert tokens.is_expired is False

    def test_needs_refresh_not_needed(self):
        """Test needs_refresh for fresh tokens."""
        tokens = OAuth2Tokens(
            access_token="token",
            expires_at=datetime.utcnow() + timedelta(hours=1),
        )
        assert tokens.needs_refresh is False

    def test_needs_refresh_needed(self):
        """Test needs_refresh for tokens expiring soon."""
        tokens = OAuth2Tokens(
            access_token="token",
            expires_at=datetime.utcnow() + timedelta(minutes=2),  # Within 5 min buffer
        )
        assert tokens.needs_refresh is True

    def test_needs_refresh_no_expiry(self):
        """Test needs_refresh when no expiry set."""
        tokens = OAuth2Tokens(
            access_token="token",
            expires_at=None,
        )
        assert tokens.needs_refresh is False


# =============================================================================
# OAuth2Manager Initialization Tests
# =============================================================================


class TestOAuth2ManagerInit:
    """Tests for OAuth2Manager initialization."""

    def test_init_default(self):
        """Test default initialization."""
        manager = OAuth2Manager()

        # Should have default configs for all providers
        assert len(manager._configs) == len(OAuth2Provider)

    def test_init_with_override(self):
        """Test initialization with config override."""
        custom_config = OAuth2ProviderConfig(
            provider=OAuth2Provider.GOOGLE,
            client_id="custom_client_id",
            client_secret="custom_secret",
            authorization_url="https://custom.com/auth",
            token_url="https://custom.com/token",
        )

        manager = OAuth2Manager(provider_configs={OAuth2Provider.GOOGLE: custom_config})

        assert manager._configs[OAuth2Provider.GOOGLE].client_id == "custom_client_id"


# =============================================================================
# Configure Provider Tests
# =============================================================================


class TestConfigureProvider:
    """Tests for configure_provider method."""

    def test_configure_provider(self):
        """Test configuring a provider."""
        manager = OAuth2Manager()
        manager.configure_provider(
            OAuth2Provider.GOOGLE,
            client_id="my_client_id",
            client_secret="my_secret",
        )

        config = manager._configs[OAuth2Provider.GOOGLE]
        assert config.client_id == "my_client_id"
        assert config.client_secret == "my_secret"

    def test_configure_unknown_provider(self):
        """Test configuring unknown provider raises error."""
        manager = OAuth2Manager()
        manager._configs = {}  # Clear configs

        with pytest.raises(ValueError, match="Unknown provider"):
            manager.configure_provider(
                OAuth2Provider.GOOGLE,
                client_id="client",
                client_secret="secret",
            )


# =============================================================================
# Authorization URL Tests
# =============================================================================


class TestGetAuthorizationUrl:
    """Tests for get_authorization_url method."""

    def test_authorization_url_basic(self, oauth_manager):
        """Test basic authorization URL generation."""
        url = oauth_manager.get_authorization_url(
            provider=OAuth2Provider.GOOGLE,
            redirect_uri="https://example.com/callback",
            state="random_state",
        )

        assert "accounts.google.com" in url
        assert "client_id=google_client_id" in url
        assert "redirect_uri=https" in url
        assert "state=random_state" in url
        assert "response_type=code" in url

    def test_authorization_url_with_scopes(self, oauth_manager):
        """Test authorization URL with custom scopes."""
        url = oauth_manager.get_authorization_url(
            provider=OAuth2Provider.GOOGLE,
            redirect_uri="https://example.com/callback",
            state="state",
            scopes=["email", "profile"],
        )

        assert "scope=email+profile" in url or "scope=email%20profile" in url

    def test_authorization_url_with_extra_params(self, oauth_manager):
        """Test authorization URL with extra params."""
        url = oauth_manager.get_authorization_url(
            provider=OAuth2Provider.GOOGLE,
            redirect_uri="https://example.com/callback",
            state="state",
            extra_params={"prompt": "select_account"},
        )

        assert "prompt=select_account" in url

    def test_google_includes_offline_access(self, oauth_manager):
        """Test Google URL includes offline access."""
        url = oauth_manager.get_authorization_url(
            provider=OAuth2Provider.GOOGLE,
            redirect_uri="https://example.com/callback",
            state="state",
        )

        assert "access_type=offline" in url


# =============================================================================
# Exchange Code Tests
# =============================================================================


class TestExchangeCode:
    """Tests for exchange_code method."""

    @pytest.mark.asyncio
    async def test_exchange_code_success(self, oauth_manager):
        """Test successful code exchange."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "new_access_token",
            "refresh_token": "new_refresh_token",
            "token_type": "Bearer",
            "expires_in": 3600,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            tokens = await oauth_manager.exchange_code(
                provider=OAuth2Provider.GOOGLE,
                code="auth_code_123",
                redirect_uri="https://example.com/callback",
            )

            assert tokens.access_token == "new_access_token"
            assert tokens.refresh_token == "new_refresh_token"
            assert tokens.expires_at is not None

    @pytest.mark.asyncio
    async def test_exchange_code_http_error(self, oauth_manager):
        """Test code exchange with HTTP error."""
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx.HTTPStatusError(
                "Error", request=MagicMock(), response=MagicMock()
            )
            mock_client_class.return_value.__aenter__.return_value = mock_client

            with pytest.raises(httpx.HTTPStatusError):
                await oauth_manager.exchange_code(
                    provider=OAuth2Provider.GOOGLE,
                    code="invalid_code",
                    redirect_uri="https://example.com/callback",
                )


# =============================================================================
# Refresh Tokens Tests
# =============================================================================


class TestRefreshTokens:
    """Tests for refresh_tokens method."""

    @pytest.mark.asyncio
    async def test_refresh_tokens_success(self, oauth_manager, valid_tokens):
        """Test successful token refresh."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "refreshed_access_token",
            "token_type": "Bearer",
            "expires_in": 3600,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            new_tokens = await oauth_manager.refresh_tokens(
                provider=OAuth2Provider.GOOGLE,
                tokens=valid_tokens,
            )

            assert new_tokens.access_token == "refreshed_access_token"
            # Refresh token should be preserved
            assert new_tokens.refresh_token == "refresh_token_456"

    @pytest.mark.asyncio
    async def test_refresh_tokens_no_refresh_token(self, oauth_manager):
        """Test refresh without refresh token raises error."""
        tokens = OAuth2Tokens(
            access_token="token",
            refresh_token=None,
        )

        with pytest.raises(ValueError, match="No refresh token"):
            await oauth_manager.refresh_tokens(
                provider=OAuth2Provider.GOOGLE,
                tokens=tokens,
            )

    @pytest.mark.asyncio
    async def test_refresh_tokens_provider_no_refresh(self, oauth_manager, valid_tokens):
        """Test refresh for provider that doesn't support it."""
        oauth_manager.configure_provider(
            OAuth2Provider.NOTION,
            client_id="notion_client",
            client_secret="notion_secret",
        )

        # Notion doesn't support refresh
        result = await oauth_manager.refresh_tokens(
            provider=OAuth2Provider.NOTION,
            tokens=valid_tokens,
        )

        # Should return original tokens
        assert result == valid_tokens


# =============================================================================
# Revoke Token Tests
# =============================================================================


class TestRevokeToken:
    """Tests for revoke_token method."""

    @pytest.mark.asyncio
    async def test_revoke_token_success(self, oauth_manager, valid_tokens):
        """Test successful token revocation."""
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await oauth_manager.revoke_token(
                provider=OAuth2Provider.GOOGLE,
                tokens=valid_tokens,
            )

            assert result is True

    @pytest.mark.asyncio
    async def test_revoke_token_no_revoke_url(self, oauth_manager, valid_tokens):
        """Test revocation for provider without revoke URL."""
        # Microsoft doesn't have revoke URL
        result = await oauth_manager.revoke_token(
            provider=OAuth2Provider.MICROSOFT,
            tokens=valid_tokens,
        )

        assert result is False


# =============================================================================
# Get User Info Tests
# =============================================================================


class TestGetUserInfo:
    """Tests for get_user_info method."""

    @pytest.mark.asyncio
    async def test_get_user_info_success(self, oauth_manager, valid_tokens):
        """Test successful user info retrieval."""
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "email": "user@example.com",
                "name": "Test User",
            }
            mock_client.get.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            user_info = await oauth_manager.get_user_info(
                provider=OAuth2Provider.GOOGLE,
                tokens=valid_tokens,
            )

            assert user_info["email"] == "user@example.com"

    @pytest.mark.asyncio
    async def test_get_user_info_no_url(self, oauth_manager, valid_tokens):
        """Test user info for provider without userinfo URL."""
        oauth_manager.configure_provider(
            OAuth2Provider.HUBSPOT,
            client_id="hubspot_client",
            client_secret="hubspot_secret",
        )

        result = await oauth_manager.get_user_info(
            provider=OAuth2Provider.HUBSPOT,
            tokens=valid_tokens,
        )

        assert result is None


# =============================================================================
# Token Parsing Tests
# =============================================================================


class TestParseTokenResponse:
    """Tests for _parse_token_response method."""

    def test_parse_full_response(self, oauth_manager):
        """Test parsing full token response."""
        data = {
            "access_token": "access",
            "refresh_token": "refresh",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": "read write",
            "id_token": "id_token_jwt",
            "extra_field": "extra_value",
        }

        tokens = oauth_manager._parse_token_response(data)

        assert tokens.access_token == "access"
        assert tokens.refresh_token == "refresh"
        assert tokens.scopes == ["read", "write"]
        assert tokens.id_token == "id_token_jwt"
        assert tokens.extra["extra_field"] == "extra_value"

    def test_parse_minimal_response(self, oauth_manager):
        """Test parsing minimal token response."""
        data = {
            "access_token": "access_only",
        }

        tokens = oauth_manager._parse_token_response(data)

        assert tokens.access_token == "access_only"
        assert tokens.refresh_token is None
        assert tokens.expires_at is None


# =============================================================================
# Global Manager Tests
# =============================================================================


class TestGlobalManager:
    """Tests for global OAuth2 manager."""

    def test_get_oauth_manager_singleton(self):
        """Test get_oauth_manager returns singleton."""
        # Reset global
        import src.connectors.auth.oauth2
        src.connectors.auth.oauth2._oauth_manager = None

        manager1 = get_oauth_manager()
        manager2 = get_oauth_manager()

        assert manager1 is manager2

    def test_configure_oauth_from_args(self):
        """Test configure_oauth with arguments."""
        import src.connectors.auth.oauth2
        src.connectors.auth.oauth2._oauth_manager = None

        manager = configure_oauth(
            google_client_id="test_google_id",
            google_client_secret="test_google_secret",
        )

        config = manager._configs[OAuth2Provider.GOOGLE]
        assert config.client_id == "test_google_id"


# =============================================================================
# Provider Configs Tests
# =============================================================================


class TestProviderConfigs:
    """Tests for provider configurations."""

    def test_google_config(self):
        """Test Google provider config."""
        config = PROVIDER_CONFIGS[OAuth2Provider.GOOGLE]

        assert "accounts.google.com" in config["authorization_url"]
        assert "oauth2.googleapis.com/token" in config["token_url"]
        assert "gmail.readonly" in " ".join(config["default_scopes"])
        assert config["extra_auth_params"]["access_type"] == "offline"

    def test_microsoft_config(self):
        """Test Microsoft provider config."""
        config = PROVIDER_CONFIGS[OAuth2Provider.MICROSOFT]

        assert "login.microsoftonline.com" in config["authorization_url"]
        assert "Mail.Read" in config["default_scopes"]

    def test_slack_config(self):
        """Test Slack provider config."""
        config = PROVIDER_CONFIGS[OAuth2Provider.SLACK]

        assert "slack.com/oauth" in config["authorization_url"]
        assert "channels:history" in config["default_scopes"]

    def test_notion_config(self):
        """Test Notion provider config."""
        config = PROVIDER_CONFIGS[OAuth2Provider.NOTION]

        assert "api.notion.com" in config["authorization_url"]
        assert config["supports_refresh"] is False


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for error handling."""

    def test_get_config_unconfigured_provider(self):
        """Test getting unconfigured provider raises error."""
        manager = OAuth2Manager()

        with pytest.raises(ValueError, match="not configured"):
            manager._get_config(OAuth2Provider.GOOGLE)

    def test_get_config_unknown_provider(self):
        """Test getting unknown provider raises error."""
        manager = OAuth2Manager()
        manager._configs = {}

        with pytest.raises(ValueError, match="Unknown provider"):
            manager._get_config(OAuth2Provider.GOOGLE)
