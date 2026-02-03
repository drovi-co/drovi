"""
Connector Configuration Schemas

Defines the configuration structures for all connectors.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class AuthType(str, Enum):
    """Supported authentication types."""

    OAUTH2 = "oauth2"
    API_KEY = "api_key"
    BASIC = "basic"
    NONE = "none"


class SyncMode(str, Enum):
    """Data synchronization modes."""

    FULL_REFRESH = "full_refresh"  # Fetch all data from scratch
    INCREMENTAL = "incremental"    # Fetch only new/changed data


class AuthConfig(BaseModel):
    """Authentication configuration for a connector."""

    auth_type: AuthType = AuthType.OAUTH2

    # OAuth2 fields
    access_token: str | None = None
    refresh_token: str | None = None
    token_expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)

    # API key fields
    api_key: str | None = None
    api_secret: str | None = None

    # Basic auth fields
    username: str | None = None
    password: str | None = None

    # Provider-specific extra config
    extra: dict[str, Any] = Field(default_factory=dict)

    class Config:
        """Pydantic config."""
        extra = "allow"


class StreamConfig(BaseModel):
    """Configuration for a single data stream within a connector."""

    # Stream identification
    stream_name: str
    enabled: bool = True

    # Sync mode
    sync_mode: SyncMode = SyncMode.INCREMENTAL

    # Cursor configuration for incremental sync
    cursor_field: str | None = None  # e.g., "updated_at", "historyId"
    primary_key: list[str] = Field(default_factory=list)  # e.g., ["id"]

    # Stream-specific settings
    batch_size: int = 100
    max_records: int | None = None  # Limit for testing

    # Stream metadata
    json_schema: dict[str, Any] | None = None  # JSON Schema for validation

    class Config:
        """Pydantic config."""
        extra = "allow"


class ConnectorConfig(BaseModel):
    """
    Complete configuration for a connector instance.

    This represents a single connection to a data source,
    including authentication and stream configuration.
    """

    # Identity
    connection_id: str
    organization_id: str
    connector_type: str  # e.g., "gmail", "slack", "notion"

    # Display
    name: str
    description: str | None = None

    # Authentication
    auth: AuthConfig

    # Streams to sync
    streams: list[StreamConfig] = Field(default_factory=list)

    # Global sync settings
    default_sync_mode: SyncMode = SyncMode.INCREMENTAL
    sync_frequency_minutes: int = 5  # How often to sync

    # Backfill settings
    backfill_start_date: datetime | None = None  # For historical data
    backfill_enabled: bool = True

    # Status
    status: Literal["active", "connected", "syncing", "paused", "error", "pending_auth"] = "pending_auth"
    last_sync_at: datetime | None = None
    last_error: str | None = None

    # Provider-specific config
    provider_config: dict[str, Any] = Field(default_factory=dict)

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"

    def get_enabled_streams(self) -> list[StreamConfig]:
        """Get list of enabled streams."""
        return [s for s in self.streams if s.enabled]

    def get_stream(self, stream_name: str) -> StreamConfig | None:
        """Get a specific stream by name."""
        for stream in self.streams:
            if stream.stream_name == stream_name:
                return stream
        return None

    def get_credential(self, key: str, default: Any | None = None) -> Any | None:
        """
        Get a credential value with backwards-compatible fallbacks.

        Looks in provider_config.credentials first, then maps common keys from auth.
        """
        credentials = self.provider_config.get("credentials", {})
        if key in credentials:
            return credentials.get(key)

        # Map common auth fields
        if key == "access_token":
            return self.auth.access_token or default
        if key == "refresh_token":
            return self.auth.refresh_token or default
        if key == "api_key":
            return self.auth.api_key or default
        if key == "api_secret":
            return self.auth.api_secret or default
        if key == "username":
            return self.auth.username or default
        if key == "password":
            return self.auth.password or default

        return default

    def get_setting(self, key: str, default: Any | None = None) -> Any | None:
        """
        Get a provider setting with backwards-compatible fallbacks.

        Looks in provider_config.settings first, then provider_config directly.
        """
        settings = self.provider_config.get("settings", {})
        if key in settings:
            return settings.get(key)
        if key in self.provider_config:
            return self.provider_config.get(key)
        return default

    @property
    def is_authenticated(self) -> bool:
        """Check if connection has valid authentication."""
        if self.auth.auth_type == AuthType.OAUTH2:
            return bool(self.auth.access_token)
        elif self.auth.auth_type == AuthType.API_KEY:
            return bool(self.auth.api_key)
        elif self.auth.auth_type == AuthType.BASIC:
            return bool(self.auth.username and self.auth.password)
        return True  # No auth required

    @property
    def token_needs_refresh(self) -> bool:
        """Check if OAuth2 token needs refresh."""
        if self.auth.auth_type != AuthType.OAUTH2:
            return False
        if not self.auth.token_expires_at:
            return False
        # Refresh 5 minutes before expiry
        from datetime import timedelta
        return datetime.utcnow() > (self.auth.token_expires_at - timedelta(minutes=5))
