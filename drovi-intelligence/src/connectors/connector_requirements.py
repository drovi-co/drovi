"""
Connector Configuration Requirements

The UI needs to know whether a connector is "Ready" to connect, and if not,
which environment variables are missing. This module centralizes those rules
so API routes can expose them consistently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RequiredSetting:
    settings_attr: str
    env_var: str


# NOTE: These map onto `src.config.Settings` fields.
CONNECTOR_REQUIRED_SETTINGS: dict[str, list[RequiredSetting]] = {
    # Google OAuth
    "gmail": [
        RequiredSetting("google_client_id", "GOOGLE_CLIENT_ID"),
        RequiredSetting("google_client_secret", "GOOGLE_CLIENT_SECRET"),
    ],
    "google_docs": [
        RequiredSetting("google_client_id", "GOOGLE_CLIENT_ID"),
        RequiredSetting("google_client_secret", "GOOGLE_CLIENT_SECRET"),
    ],
    "google_calendar": [
        RequiredSetting("google_client_id", "GOOGLE_CLIENT_ID"),
        RequiredSetting("google_client_secret", "GOOGLE_CLIENT_SECRET"),
    ],
    # Slack OAuth
    "slack": [
        RequiredSetting("slack_client_id", "SLACK_CLIENT_ID"),
        RequiredSetting("slack_client_secret", "SLACK_CLIENT_SECRET"),
    ],
    # Microsoft OAuth
    "outlook": [
        RequiredSetting("microsoft_client_id", "MICROSOFT_CLIENT_ID"),
        RequiredSetting("microsoft_client_secret", "MICROSOFT_CLIENT_SECRET"),
    ],
    "teams": [
        RequiredSetting("microsoft_client_id", "MICROSOFT_CLIENT_ID"),
        RequiredSetting("microsoft_client_secret", "MICROSOFT_CLIENT_SECRET"),
    ],
    # Notion OAuth
    "notion": [
        RequiredSetting("notion_client_id", "NOTION_CLIENT_ID"),
        RequiredSetting("notion_client_secret", "NOTION_CLIENT_SECRET"),
    ],
    # HubSpot OAuth
    "hubspot": [
        RequiredSetting("hubspot_client_id", "HUBSPOT_CLIENT_ID"),
        RequiredSetting("hubspot_client_secret", "HUBSPOT_CLIENT_SECRET"),
    ],
    # Meta / WhatsApp Business OAuth
    "whatsapp": [
        RequiredSetting("meta_app_id", "META_APP_ID"),
        RequiredSetting("meta_app_secret", "META_APP_SECRET"),
        RequiredSetting("whatsapp_business_id", "WHATSAPP_BUSINESS_ID"),
    ],
}


def get_missing_env_for_connector(
    connector_type: str,
    settings: Any,
) -> list[str]:
    """
    Returns the list of missing env var names for a connector.

    The caller passes `settings` (usually `get_settings()`), which we treat
    as a duck-typed object with the expected attributes.
    """
    missing: list[str] = []
    for req in CONNECTOR_REQUIRED_SETTINGS.get(connector_type, []):
        value = getattr(settings, req.settings_attr, None)
        if not value:
            missing.append(req.env_var)
    return missing

