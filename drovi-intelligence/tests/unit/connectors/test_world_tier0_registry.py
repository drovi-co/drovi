from __future__ import annotations

import pytest

from src.connectors.base.connector import ConnectorRegistry
from src.connectors.bootstrap import ensure_connectors_registered
from src.connectors.definitions.registry import iter_required_settings, list_connector_definitions

pytestmark = [pytest.mark.unit]


def test_world_tier0_connectors_registered_in_registry_and_definitions() -> None:
    ensure_connectors_registered()

    expected_types = {
        "sec_edgar",
        "federal_register",
        "fred",
        "crossref",
        "cisa_kev",
    }
    by_type = {definition.connector_type for definition in list_connector_definitions()}

    for connector_type in expected_types:
        connector_class = ConnectorRegistry.get(connector_type)
        assert connector_class is not None, f"{connector_type} missing in ConnectorRegistry"
        connector = connector_class()
        assert connector.connector_type == connector_type
        assert connector_type in by_type, f"{connector_type} missing in definitions registry"


def test_fred_definition_requires_fred_api_key_setting() -> None:
    required = list(iter_required_settings("fred"))
    env_vars = {setting.env_var for setting in required}
    assert "FRED_API_KEY" in env_vars


def test_worldnewsapi_registered_and_requires_world_news_api_key_setting() -> None:
    ensure_connectors_registered()

    connector_class = ConnectorRegistry.get("worldnewsapi")
    assert connector_class is not None, "worldnewsapi missing in ConnectorRegistry"

    required = list(iter_required_settings("worldnewsapi"))
    env_vars = {setting.env_var for setting in required}
    assert "WORLD_NEWS_API_KEY" in env_vars
