from __future__ import annotations

from dataclasses import dataclass

from src.config import get_settings
from src.kernel.errors import ValidationError
from src.plugins.accounting import AccountingPlugin
from src.plugins.contracts import (
    ExtensionTypeSpec,
    PluginManifest,
    StorageRuleSet,
    UIOTypeSpec,
    VerticalPlugin,
)
from src.plugins.core import CorePlugin
from src.plugins.legal import LegalPlugin


_KNOWN_PLUGINS: dict[str, type[VerticalPlugin]] = {
    "core": CorePlugin,
    "legal": LegalPlugin,
    "accounting": AccountingPlugin,
}


@dataclass(frozen=True)
class PluginRegistry:
    plugins: list[VerticalPlugin]
    _uio_types: dict[str, UIOTypeSpec]
    _extension_types: dict[str, ExtensionTypeSpec]
    _extension_plugin_map: dict[str, VerticalPlugin]

    def uio_types(self) -> list[UIOTypeSpec]:
        return list(self._uio_types.values())

    def extension_types(self) -> list[ExtensionTypeSpec]:
        return list(self._extension_types.values())

    def uio_type_names(self) -> list[str]:
        return sorted(self._uio_types.keys())

    def extension_type_names(self) -> list[str]:
        return sorted(self._extension_types.keys())

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

    def resolve_extension_type(
        self,
        value: str,
    ) -> tuple[VerticalPlugin, ExtensionTypeSpec]:
        raw = (value or "").strip()
        spec = self._extension_types.get(raw)
        plugin = self._extension_plugin_map.get(raw)
        if not spec or plugin is None:
            raise ValidationError(
                code="extension.type_invalid",
                message=f"Invalid extension type: {raw}",
                status_code=400,
                meta={"valid_types": self.extension_type_names()},
            )
        return plugin, spec

    def validate_extension_payload(
        self,
        *,
        type_name: str,
        payload: dict[str, object],
    ) -> tuple[VerticalPlugin, ExtensionTypeSpec, dict[str, object]]:
        plugin, spec = self.resolve_extension_type(type_name)
        normalized = plugin.validate_extension_payload(
            type_name=type_name,
            payload=dict(payload or {}),
        )
        return plugin, spec, normalized

    def migration_revisions(self) -> list[str]:
        revisions: set[str] = set()
        for plugin in self.plugins:
            revisions.update(plugin.migration_revisions())
        return sorted(revisions)

    def manifest(self) -> PluginManifest:
        capabilities: dict[str, bool] = {}
        ui_hints: dict[str, object] = {}
        plugin_ids: list[str] = []
        uio_types: dict[str, UIOTypeSpec] = {}
        extension_types: dict[str, ExtensionTypeSpec] = {}
        typed_tables: dict[str, str] = {}

        for plugin in self.plugins:
            plugin_ids.append(plugin.plugin_id)
            capabilities.update(plugin.capabilities())
            # Later we may want deep-merge; for now, last-wins per key.
            ui_hints.update(plugin.ui_hints())
            for spec in plugin.uio_types():
                uio_types[spec.type] = spec
            for extension in plugin.extension_types():
                extension_types[extension.type] = extension
            typed_tables.update(plugin.storage_rules())

        return PluginManifest(
            plugins=plugin_ids,
            uio_types=list(uio_types.values()),
            extension_types=list(extension_types.values()),
            capabilities=capabilities,
            ui_hints=ui_hints,
            storage_rules=StorageRuleSet(typed_tables=typed_tables),
        )


def get_plugin_registry() -> PluginRegistry:
    """Load enabled plugins from settings with deterministic ordering."""
    enabled = list(get_settings().enabled_plugins or [])
    if not enabled:
        enabled = ["core"]

    plugins: list[VerticalPlugin] = []
    uio_types: dict[str, UIOTypeSpec] = {}
    extension_types: dict[str, ExtensionTypeSpec] = {}
    extension_plugin_map: dict[str, VerticalPlugin] = {}

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
        for spec in plugin.extension_types():
            extension_types[spec.type] = spec
            extension_plugin_map[spec.type] = plugin

    return PluginRegistry(
        plugins=plugins,
        _uio_types=uio_types,
        _extension_types=extension_types,
        _extension_plugin_map=extension_plugin_map,
    )
