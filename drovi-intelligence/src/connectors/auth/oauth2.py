"""
OAuth2 Manager

Handles OAuth2 authentication flows for all supported providers.
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class OAuth2Provider(str, Enum):
    """Supported OAuth2 providers."""

    GOOGLE = "google"
    MICROSOFT = "microsoft"
    SLACK = "slack"
    NOTION = "notion"
    HUBSPOT = "hubspot"
    SALESFORCE = "salesforce"


class OAuth2ProviderConfig(BaseModel):
    """Configuration for an OAuth2 provider."""

    provider: OAuth2Provider
    client_id: str
    client_secret: str

    # URLs
    authorization_url: str
    token_url: str
    revoke_url: str | None = None
    userinfo_url: str | None = None

    # Scopes
    default_scopes: list[str] = Field(default_factory=list)

    # Provider quirks
    supports_refresh: bool = True
    token_expiry_buffer_seconds: int = 300  # Refresh 5 min before expiry
    requires_pkce: bool = False

    # Extra parameters
    extra_auth_params: dict[str, str] = Field(default_factory=dict)


class OAuth2Tokens(BaseModel):
    """OAuth2 token data."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "Bearer"
    expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)

    # Provider-specific data
    id_token: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)

    class Config:
        """Pydantic config."""
        extra = "allow"

    @property
    def is_expired(self) -> bool:
        """Check if token is expired."""
        if not self.expires_at:
            return False
        return datetime.utcnow() >= self.expires_at

    @property
    def needs_refresh(self) -> bool:
        """Check if token needs refresh (with buffer)."""
        if not self.expires_at:
            return False
        buffer = timedelta(minutes=5)
        return datetime.utcnow() >= (self.expires_at - buffer)


# Pre-configured provider settings
PROVIDER_CONFIGS: dict[OAuth2Provider, dict[str, Any]] = {
    OAuth2Provider.GOOGLE: {
        "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "revoke_url": "https://oauth2.googleapis.com/revoke",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "default_scopes": [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
        "extra_auth_params": {
            "access_type": "offline",
            "prompt": "consent",
        },
    },
    OAuth2Provider.MICROSOFT: {
        "authorization_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "revoke_url": None,  # Microsoft doesn't have a revoke endpoint
        "userinfo_url": "https://graph.microsoft.com/v1.0/me",
        "default_scopes": [
            "openid",
            "email",
            "profile",
            "offline_access",
            "Mail.Read",
            "Calendar.Read",
            "Files.Read",
        ],
        "extra_auth_params": {},
    },
    OAuth2Provider.SLACK: {
        "authorization_url": "https://slack.com/oauth/v2/authorize",
        "token_url": "https://slack.com/api/oauth.v2.access",
        "revoke_url": "https://slack.com/api/auth.revoke",
        "userinfo_url": "https://slack.com/api/users.identity",
        "default_scopes": [
            "channels:history",
            "channels:read",
            "groups:history",
            "groups:read",
            "im:history",
            "im:read",
            "mpim:history",
            "mpim:read",
            "users:read",
            "users:read.email",
        ],
        "extra_auth_params": {},
    },
    OAuth2Provider.NOTION: {
        "authorization_url": "https://api.notion.com/v1/oauth/authorize",
        "token_url": "https://api.notion.com/v1/oauth/token",
        "revoke_url": None,
        "userinfo_url": None,
        "default_scopes": [],  # Notion uses page-based permissions
        "extra_auth_params": {
            "owner": "user",
        },
        "supports_refresh": False,  # Notion tokens don't expire
    },
    OAuth2Provider.HUBSPOT: {
        "authorization_url": "https://app.hubspot.com/oauth/authorize",
        "token_url": "https://api.hubapi.com/oauth/v1/token",
        "revoke_url": None,
        "userinfo_url": None,
        "default_scopes": [
            "crm.objects.contacts.read",
            "crm.objects.deals.read",
            "crm.objects.companies.read",
        ],
        "extra_auth_params": {},
    },
    OAuth2Provider.SALESFORCE: {
        "authorization_url": "https://login.salesforce.com/services/oauth2/authorize",
        "token_url": "https://login.salesforce.com/services/oauth2/token",
        "revoke_url": "https://login.salesforce.com/services/oauth2/revoke",
        "userinfo_url": None,
        "default_scopes": [
            "api",
            "refresh_token",
        ],
        "extra_auth_params": {},
    },
}


class OAuth2Manager:
    """
    Centralized OAuth2 management for all connectors.

    Handles:
    - Authorization URL generation
    - Token exchange (authorization code -> tokens)
    - Token refresh
    - Token revocation
    - Multi-tenant token storage

    Example usage:
        manager = OAuth2Manager()

        # Generate authorization URL
        auth_url = manager.get_authorization_url(
            provider=OAuth2Provider.GOOGLE,
            redirect_uri="https://example.com/callback",
            state="unique_state_string",
        )

        # Exchange code for tokens
        tokens = await manager.exchange_code(
            provider=OAuth2Provider.GOOGLE,
            code="authorization_code",
            redirect_uri="https://example.com/callback",
        )

        # Refresh tokens
        new_tokens = await manager.refresh_tokens(
            provider=OAuth2Provider.GOOGLE,
            tokens=tokens,
        )
    """

    def __init__(
        self,
        provider_configs: dict[OAuth2Provider, OAuth2ProviderConfig] | None = None,
    ):
        """
        Initialize OAuth2 manager.

        Args:
            provider_configs: Override default provider configurations
        """
        self._configs: dict[OAuth2Provider, OAuth2ProviderConfig] = {}

        # Load default configs
        for provider in OAuth2Provider:
            if provider in PROVIDER_CONFIGS:
                defaults = PROVIDER_CONFIGS[provider]
                self._configs[provider] = OAuth2ProviderConfig(
                    provider=provider,
                    client_id="",  # Must be set via configure()
                    client_secret="",
                    **defaults,
                )

        # Apply overrides
        if provider_configs:
            for provider, config in provider_configs.items():
                self._configs[provider] = config

    def configure_provider(
        self,
        provider: OAuth2Provider,
        client_id: str,
        client_secret: str,
        **kwargs: Any,
    ) -> None:
        """
        Configure a provider with credentials.

        Args:
            provider: OAuth2 provider
            client_id: OAuth2 client ID
            client_secret: OAuth2 client secret
            **kwargs: Additional provider-specific settings
        """
        if provider not in self._configs:
            raise ValueError(f"Unknown provider: {provider}")

        config = self._configs[provider]
        config.client_id = client_id
        config.client_secret = client_secret

        for key, value in kwargs.items():
            if hasattr(config, key):
                setattr(config, key, value)

    def get_authorization_url(
        self,
        provider: OAuth2Provider,
        redirect_uri: str,
        state: str,
        scopes: list[str] | None = None,
        extra_params: dict[str, str] | None = None,
    ) -> str:
        """
        Generate OAuth2 authorization URL.

        Args:
            provider: OAuth2 provider
            redirect_uri: Callback URL after authorization
            state: CSRF protection state parameter
            scopes: Override default scopes
            extra_params: Additional URL parameters

        Returns:
            Authorization URL
        """
        config = self._get_config(provider)

        params = {
            "client_id": config.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
        }

        # Add scopes
        scope_list = scopes or config.default_scopes
        if scope_list:
            params["scope"] = " ".join(scope_list)

        # Add provider-specific params
        params.update(config.extra_auth_params)

        # Add extra params
        if extra_params:
            params.update(extra_params)

        return f"{config.authorization_url}?{urlencode(params)}"

    async def exchange_code(
        self,
        provider: OAuth2Provider,
        code: str,
        redirect_uri: str,
    ) -> OAuth2Tokens:
        """
        Exchange authorization code for tokens.

        Args:
            provider: OAuth2 provider
            code: Authorization code from callback
            redirect_uri: Same redirect URI used in authorization

        Returns:
            OAuth2Tokens
        """
        config = self._get_config(provider)

        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": config.client_id,
            "client_secret": config.client_secret,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                config.token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            token_data = response.json()

        return self._parse_token_response(token_data)

    async def refresh_tokens(
        self,
        provider: OAuth2Provider,
        tokens: OAuth2Tokens,
    ) -> OAuth2Tokens:
        """
        Refresh access token using refresh token.

        Args:
            provider: OAuth2 provider
            tokens: Current tokens with refresh_token

        Returns:
            New OAuth2Tokens
        """
        config = self._get_config(provider)

        if not config.supports_refresh:
            logger.warning(
                "Provider doesn't support token refresh",
                provider=provider.value,
            )
            return tokens

        if not tokens.refresh_token:
            raise ValueError("No refresh token available")

        data = {
            "grant_type": "refresh_token",
            "refresh_token": tokens.refresh_token,
            "client_id": config.client_id,
            "client_secret": config.client_secret,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                config.token_url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            token_data = response.json()

        new_tokens = self._parse_token_response(token_data)

        # Preserve refresh token if not returned
        if not new_tokens.refresh_token:
            new_tokens.refresh_token = tokens.refresh_token

        logger.info(
            "Tokens refreshed",
            provider=provider.value,
            expires_at=new_tokens.expires_at,
        )

        return new_tokens

    async def revoke_token(
        self,
        provider: OAuth2Provider,
        tokens: OAuth2Tokens,
    ) -> bool:
        """
        Revoke OAuth2 tokens.

        Args:
            provider: OAuth2 provider
            tokens: Tokens to revoke

        Returns:
            True if revoked successfully
        """
        config = self._get_config(provider)

        if not config.revoke_url:
            logger.warning(
                "Provider doesn't support token revocation",
                provider=provider.value,
            )
            return False

        async with httpx.AsyncClient() as client:
            response = await client.post(
                config.revoke_url,
                data={"token": tokens.access_token},
            )

            if response.status_code == 200:
                logger.info("Token revoked", provider=provider.value)
                return True

        return False

    async def get_user_info(
        self,
        provider: OAuth2Provider,
        tokens: OAuth2Tokens,
    ) -> dict[str, Any] | None:
        """
        Get user info from provider.

        Args:
            provider: OAuth2 provider
            tokens: Valid access tokens

        Returns:
            User info dict or None
        """
        config = self._get_config(provider)

        if not config.userinfo_url:
            return None

        async with httpx.AsyncClient() as client:
            response = await client.get(
                config.userinfo_url,
                headers={"Authorization": f"Bearer {tokens.access_token}"},
            )

            if response.status_code == 200:
                return response.json()

        return None

    def _get_config(self, provider: OAuth2Provider) -> OAuth2ProviderConfig:
        """Get provider configuration."""
        if provider not in self._configs:
            raise ValueError(f"Unknown provider: {provider}")

        config = self._configs[provider]
        if not config.client_id:
            raise ValueError(f"Provider {provider.value} not configured")

        return config

    def _parse_token_response(self, data: dict[str, Any]) -> OAuth2Tokens:
        """Parse token response from provider."""
        expires_at = None
        if "expires_in" in data:
            expires_at = datetime.utcnow() + timedelta(seconds=data["expires_in"])

        return OAuth2Tokens(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            token_type=data.get("token_type", "Bearer"),
            expires_at=expires_at,
            scopes=data.get("scope", "").split() if data.get("scope") else [],
            id_token=data.get("id_token"),
            extra={k: v for k, v in data.items() if k not in [
                "access_token", "refresh_token", "token_type",
                "expires_in", "scope", "id_token"
            ]},
        )


# Global OAuth2 manager instance
_oauth_manager: OAuth2Manager | None = None


def get_oauth_manager() -> OAuth2Manager:
    """Get the global OAuth2 manager instance."""
    global _oauth_manager
    if _oauth_manager is None:
        _oauth_manager = OAuth2Manager()
    return _oauth_manager


def configure_oauth(
    google_client_id: str | None = None,
    google_client_secret: str | None = None,
    microsoft_client_id: str | None = None,
    microsoft_client_secret: str | None = None,
    slack_client_id: str | None = None,
    slack_client_secret: str | None = None,
    notion_client_id: str | None = None,
    notion_client_secret: str | None = None,
    hubspot_client_id: str | None = None,
    hubspot_client_secret: str | None = None,
    salesforce_client_id: str | None = None,
    salesforce_client_secret: str | None = None,
) -> OAuth2Manager:
    """
    Configure OAuth2 manager with provider credentials.

    Reads from arguments or environment variables.
    """
    import os

    manager = get_oauth_manager()

    # Google
    if google_client_id or os.getenv("GOOGLE_CLIENT_ID"):
        manager.configure_provider(
            OAuth2Provider.GOOGLE,
            client_id=google_client_id or os.getenv("GOOGLE_CLIENT_ID", ""),
            client_secret=google_client_secret or os.getenv("GOOGLE_CLIENT_SECRET", ""),
        )

    # Microsoft
    if microsoft_client_id or os.getenv("MICROSOFT_CLIENT_ID"):
        manager.configure_provider(
            OAuth2Provider.MICROSOFT,
            client_id=microsoft_client_id or os.getenv("MICROSOFT_CLIENT_ID", ""),
            client_secret=microsoft_client_secret or os.getenv("MICROSOFT_CLIENT_SECRET", ""),
        )

    # Slack
    if slack_client_id or os.getenv("SLACK_CLIENT_ID"):
        manager.configure_provider(
            OAuth2Provider.SLACK,
            client_id=slack_client_id or os.getenv("SLACK_CLIENT_ID", ""),
            client_secret=slack_client_secret or os.getenv("SLACK_CLIENT_SECRET", ""),
        )

    # Notion
    if notion_client_id or os.getenv("NOTION_CLIENT_ID"):
        manager.configure_provider(
            OAuth2Provider.NOTION,
            client_id=notion_client_id or os.getenv("NOTION_CLIENT_ID", ""),
            client_secret=notion_client_secret or os.getenv("NOTION_CLIENT_SECRET", ""),
        )

    # HubSpot
    if hubspot_client_id or os.getenv("HUBSPOT_CLIENT_ID"):
        manager.configure_provider(
            OAuth2Provider.HUBSPOT,
            client_id=hubspot_client_id or os.getenv("HUBSPOT_CLIENT_ID", ""),
            client_secret=hubspot_client_secret or os.getenv("HUBSPOT_CLIENT_SECRET", ""),
        )

    # Salesforce
    if salesforce_client_id or os.getenv("SALESFORCE_CLIENT_ID"):
        manager.configure_provider(
            OAuth2Provider.SALESFORCE,
            client_id=salesforce_client_id or os.getenv("SALESFORCE_CLIENT_ID", ""),
            client_secret=salesforce_client_secret or os.getenv("SALESFORCE_CLIENT_SECRET", ""),
        )

    return manager
