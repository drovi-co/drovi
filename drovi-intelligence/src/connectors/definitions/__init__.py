"""Public connector definition exports.

Keep this package import-light to avoid circular imports during connector
bootstrap. The registry is imported lazily from the accessors below.
"""

from src.connectors.definitions.models import (
    BackfillDefaults,
    ConnectorDefinition,
    HttpRetryPolicy,
    RequiredSetting,
)


def get_connector_definition(connector_type: str):
    from src.connectors.definitions.registry import get_connector_definition as _get

    return _get(connector_type)


def list_connector_definitions():
    from src.connectors.definitions.registry import list_connector_definitions as _list

    return _list()

__all__ = [
    "BackfillDefaults",
    "ConnectorDefinition",
    "HttpRetryPolicy",
    "RequiredSetting",
    "get_connector_definition",
    "list_connector_definitions",
]
