"""Connector definitions.

This module is intentionally lightweight:
- It must not import connector implementation modules (many have heavy optional deps).
- It is safe to import from API routes to list capabilities and requirements.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from src.connectors.base.config import StreamConfig
from src.connectors.base.connector import ConnectorCapabilities


def _empty_streams_factory() -> list[StreamConfig]:
    return []


def _default_streams_factory() -> Callable[[], list[StreamConfig]]:
    return _empty_streams_factory


@dataclass(frozen=True)
class RequiredSetting:
    """A required Settings attribute + its env var name for UI/operator messaging."""

    settings_attr: str
    env_var: str


@dataclass(frozen=True)
class HttpRetryPolicy:
    """Retry/backoff configuration for connector HTTP calls (where httpx is used)."""

    max_attempts: int = 5
    base_backoff_seconds: float = 0.5
    max_backoff_seconds: float = 8.0
    retry_statuses: tuple[int, ...] = (429, 500, 502, 503, 504)


@dataclass(frozen=True)
class BackfillDefaults:
    """Default backfill windowing policy (can be overridden per connection/provider_config)."""

    window_days: int = 7
    throttle_seconds: float = 1.0


@dataclass(frozen=True)
class ConnectorDefinition:
    """Static metadata for a connector type.

    This is the canonical place for:
    - display metadata (for UIs)
    - auth provider + scopes
    - default streams
    - limits/policies (rate limits, backfill windowing)
    """

    connector_type: str
    display_name: str
    source_type: str

    # Auth
    oauth_provider: str | None = None
    oauth_scopes: tuple[str, ...] = ()
    required_settings: tuple[RequiredSetting, ...] = ()

    # Capabilities / limits
    capabilities: ConnectorCapabilities = field(default_factory=ConnectorCapabilities)
    http_retry: HttpRetryPolicy = field(default_factory=HttpRetryPolicy)
    backfill_defaults: BackfillDefaults = field(default_factory=BackfillDefaults)

    # Streams
    default_streams_factory: Callable[[], list[StreamConfig]] = field(default_factory=_default_streams_factory)

    # Misc, connector-specific extras for UI or policies.
    ui_hints: dict[str, Any] = field(default_factory=dict)

    def default_streams(self) -> list[StreamConfig]:
        # Return a new list each time to avoid shared mutations.
        streams = self.default_streams_factory()
        return list(streams)
