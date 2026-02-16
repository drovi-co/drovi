from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from src.kernel.errors import ValidationError
from src.plugins.registry import get_plugin_registry


def test_registry_loads_reference_plugins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.plugins.registry.get_settings",
        lambda: SimpleNamespace(enabled_plugins=["core", "legal", "accounting"]),
    )
    registry = get_plugin_registry()

    assert set(plugin.plugin_id for plugin in registry.plugins) == {
        "core",
        "legal",
        "accounting",
    }
    assert "legal.matter" in registry.uio_type_names()
    assert "accounting.filing_deadline" in registry.uio_type_names()
    assert "legal.matter" in registry.extension_type_names()
    assert "legal.advice" in registry.extension_type_names()
    assert "accounting.filing_deadline" in registry.extension_type_names()


def test_registry_rejects_unknown_extension_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.plugins.registry.get_settings",
        lambda: SimpleNamespace(enabled_plugins=["core", "legal"]),
    )
    registry = get_plugin_registry()

    with pytest.raises(ValidationError) as exc:
        registry.resolve_extension_type("legal.unknown")

    assert exc.value.code == "extension.type_invalid"


def test_plugin_migration_revisions_exist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.plugins.registry.get_settings",
        lambda: SimpleNamespace(enabled_plugins=["core", "legal", "accounting"]),
    )
    registry = get_plugin_registry()

    revisions = registry.migration_revisions()
    assert "050_vertical_extension_tables" in revisions

    versions_dir = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    file_names = {path.name for path in versions_dir.iterdir() if path.is_file()}
    assert any(name.startswith("050_vertical_extension_tables") for name in file_names)

