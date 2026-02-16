"""
Connector Configuration Requirements

The UI needs to know whether a connector is "Ready" to connect, and if not,
which environment variables are missing. This module centralizes those rules
so API routes can expose them consistently.
"""

from __future__ import annotations

from typing import Any


from src.connectors.definitions.models import RequiredSetting
from src.connectors.definitions.registry import iter_required_settings


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
    for req in iter_required_settings(connector_type):
        value = getattr(settings, req.settings_attr, None)
        if not value:
            missing.append(req.env_var)
    return missing
