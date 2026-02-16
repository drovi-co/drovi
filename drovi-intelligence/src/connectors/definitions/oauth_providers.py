"""OAuth provider specs for connectors.

Centralizes:
- required Settings fields (for UI readiness checks)
- how to build `AuthConfig.extra` for connector execution
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from src.connectors.definitions.models import RequiredSetting


@dataclass(frozen=True)
class OAuthProviderSpec:
    provider: str
    required_settings: tuple[RequiredSetting, ...]
    build_auth_extra: Callable[[Any], dict[str, Any]]


def _google_extra(settings: Any) -> dict[str, Any]:
    return {
        "client_id": getattr(settings, "google_client_id", None),
        "client_secret": getattr(settings, "google_client_secret", None),
    }


def _microsoft_extra(settings: Any) -> dict[str, Any]:
    return {
        "client_id": getattr(settings, "microsoft_client_id", None),
        "client_secret": getattr(settings, "microsoft_client_secret", None),
        "tenant_id": getattr(settings, "microsoft_tenant_id", None) or "common",
    }


def _hubspot_extra(settings: Any) -> dict[str, Any]:
    return {
        "client_id": getattr(settings, "hubspot_client_id", None),
        "client_secret": getattr(settings, "hubspot_client_secret", None),
    }


def _slack_extra(settings: Any) -> dict[str, Any]:
    return {
        "client_id": getattr(settings, "slack_client_id", None),
        "client_secret": getattr(settings, "slack_client_secret", None),
    }


def _notion_extra(settings: Any) -> dict[str, Any]:
    return {
        "client_id": getattr(settings, "notion_client_id", None),
        "client_secret": getattr(settings, "notion_client_secret", None),
    }


def _meta_extra(settings: Any) -> dict[str, Any]:
    # Used for WhatsApp Business OAuth flows.
    return {
        "app_id": getattr(settings, "meta_app_id", None),
        "app_secret": getattr(settings, "meta_app_secret", None),
        "whatsapp_business_id": getattr(settings, "whatsapp_business_id", None),
    }


_OAUTH_PROVIDER_SPECS: dict[str, OAuthProviderSpec] = {
    "google": OAuthProviderSpec(
        provider="google",
        required_settings=(
            RequiredSetting("google_client_id", "GOOGLE_CLIENT_ID"),
            RequiredSetting("google_client_secret", "GOOGLE_CLIENT_SECRET"),
        ),
        build_auth_extra=_google_extra,
    ),
    "microsoft": OAuthProviderSpec(
        provider="microsoft",
        required_settings=(
            RequiredSetting("microsoft_client_id", "MICROSOFT_CLIENT_ID"),
            RequiredSetting("microsoft_client_secret", "MICROSOFT_CLIENT_SECRET"),
        ),
        build_auth_extra=_microsoft_extra,
    ),
    "hubspot": OAuthProviderSpec(
        provider="hubspot",
        required_settings=(
            RequiredSetting("hubspot_client_id", "HUBSPOT_CLIENT_ID"),
            RequiredSetting("hubspot_client_secret", "HUBSPOT_CLIENT_SECRET"),
        ),
        build_auth_extra=_hubspot_extra,
    ),
    "slack": OAuthProviderSpec(
        provider="slack",
        required_settings=(
            RequiredSetting("slack_client_id", "SLACK_CLIENT_ID"),
            RequiredSetting("slack_client_secret", "SLACK_CLIENT_SECRET"),
        ),
        build_auth_extra=_slack_extra,
    ),
    "notion": OAuthProviderSpec(
        provider="notion",
        required_settings=(
            RequiredSetting("notion_client_id", "NOTION_CLIENT_ID"),
            RequiredSetting("notion_client_secret", "NOTION_CLIENT_SECRET"),
        ),
        build_auth_extra=_notion_extra,
    ),
    "meta": OAuthProviderSpec(
        provider="meta",
        required_settings=(
            RequiredSetting("meta_app_id", "META_APP_ID"),
            RequiredSetting("meta_app_secret", "META_APP_SECRET"),
            RequiredSetting("whatsapp_business_id", "WHATSAPP_BUSINESS_ID"),
        ),
        build_auth_extra=_meta_extra,
    ),
}


def get_oauth_provider_spec(provider: str) -> OAuthProviderSpec | None:
    return _OAUTH_PROVIDER_SPECS.get(provider)

