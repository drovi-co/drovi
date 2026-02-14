from __future__ import annotations

from src.plugins import get_plugin_registry
from src.plugins.contracts import PluginManifest


def get_org_plugin_manifest(*, org_id: str) -> PluginManifest:
    """Return the plugin manifest for an org.

    This is intentionally simple today (settings-driven). In later phases, this
    becomes org/vertical-aware (e.g. org-specific capability gates, allowed
    connectors, vertical overlays).
    """
    _ = org_id
    registry = get_plugin_registry()
    return registry.manifest()

