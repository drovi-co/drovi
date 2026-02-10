from __future__ import annotations

from dataclasses import dataclass

from src.config import get_settings
from src.kernel.errors import ValidationError
from src.plugins.contracts import PluginManifest, UIOTypeSpec, VerticalPlugin
from src.plugins.core import CorePlugin


_KNOWN_PLUGINS: dict[str, type[VerticalPlugin]] = {
    "core": CorePlugin,
}


@dataclass(frozen=True)
class PluginRegistry:
    plugins: list[VerticalPlugin]
    _uio_types: dict[str, UIOTypeSpec]

    def uio_types(self) -> list[UIOTypeSpec]:
        return list(self._uio_types.values())

    def uio_type_names(self) -> list[str]:
        return sorted(self._uio_types.keys())

    def validate_uio_type(self, value: str) -> str:
        raw = (value or "").strip()
        if raw not in self._uio_types:
            raise ValidationError(
                code="uio.type_invalid",
                message=f"Invalid UIO type: {raw}",
                status_code=400,
                meta={"valid_types": self.uio_type_names()},
            )
        return raw

    def manifest(self) -> PluginManifest:
        capabilities: dict[str, bool] = {}
        ui_hints: dict[str, object] = {}
        plugin_ids: list[str] = []
        uio_types: dict[str, UIOTypeSpec] = {}

        for plugin in self.plugins:
            plugin_ids.append(plugin.plugin_id)
            capabilities.update(plugin.capabilities())
            # Later we may want deep-merge; for now, last-wins per key.
            ui_hints.update(plugin.ui_hints())
            for spec in plugin.uio_types():
                uio_types[spec.type] = spec

        return PluginManifest(
            plugins=plugin_ids,
            uio_types=list(uio_types.values()),
            capabilities=capabilities,
            ui_hints=ui_hints,
        )


def get_plugin_registry() -> PluginRegistry:
    """Load enabled plugins from settings with deterministic ordering."""
    enabled = list(get_settings().enabled_plugins or [])
    if not enabled:
        enabled = ["core"]

    plugins: list[VerticalPlugin] = []
    uio_types: dict[str, UIOTypeSpec] = {}

    for plugin_id in enabled:
        plugin_id = str(plugin_id).strip()
        if not plugin_id:
            continue
        plugin_cls = _KNOWN_PLUGINS.get(plugin_id)
        if not plugin_cls:
            raise RuntimeError(f"Unknown plugin id: {plugin_id!r}. Known: {sorted(_KNOWN_PLUGINS.keys())}")
        plugin = plugin_cls()
        plugins.append(plugin)
        for spec in plugin.uio_types():
            uio_types[spec.type] = spec

    return PluginRegistry(plugins=plugins, _uio_types=uio_types)

