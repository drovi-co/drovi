"""Vertical plugin system (explicit registry).

Plugins extend Drovi's core model with:
- type registrations (UIOs and vertical entities)
- validation rules
- UI hints and capability flags (used by vertical runtimes)
"""

from .registry import get_plugin_registry

__all__ = ["get_plugin_registry"]

