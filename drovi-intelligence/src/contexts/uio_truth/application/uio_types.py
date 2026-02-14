from __future__ import annotations

from src.plugins import get_plugin_registry


def list_allowed_uio_types() -> list[str]:
    return get_plugin_registry().uio_type_names()


def validate_uio_type(value: str) -> str:
    return get_plugin_registry().validate_uio_type(value)

