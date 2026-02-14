import inspect

from src.connectors.base.connector import ConnectorRegistry
from src.connectors.bootstrap import ensure_connectors_registered
from src.connectors.definitions.registry import list_connector_definitions


def test_connector_definitions_are_unique_and_complete() -> None:
    definitions = list_connector_definitions()
    assert definitions, "No connector definitions registered"

    seen: set[str] = set()
    for definition in definitions:
        assert definition.connector_type, "connector_type is required"
        assert definition.display_name, f"{definition.connector_type} missing display_name"
        assert definition.source_type, f"{definition.connector_type} missing source_type"

        assert definition.connector_type not in seen, f"Duplicate connector_type: {definition.connector_type}"
        seen.add(definition.connector_type)

        cap = definition.capabilities
        assert cap.max_concurrent_streams >= 1, f"{definition.connector_type} invalid max_concurrent_streams"
        assert cap.default_rate_limit_per_minute >= 0, f"{definition.connector_type} invalid rate limit"

        streams = definition.default_streams()
        names = [s.stream_name for s in streams]
        assert len(names) == len(set(names)), f"{definition.connector_type} has duplicate stream names"
        for stream in streams:
            if stream.sync_mode.value == "incremental":
                assert stream.cursor_field, f"{definition.connector_type}.{stream.stream_name} missing cursor_field"


def test_connector_registry_matches_definitions() -> None:
    ensure_connectors_registered()
    definitions = list_connector_definitions()
    for definition in definitions:
        connector_class = ConnectorRegistry.get(definition.connector_type)
        assert connector_class is not None, f"ConnectorRegistry missing {definition.connector_type}"
        assert not inspect.isabstract(connector_class), f"{definition.connector_type} is abstract"
        # Should be instantiable without args.
        connector = connector_class()
        assert connector.connector_type == definition.connector_type

