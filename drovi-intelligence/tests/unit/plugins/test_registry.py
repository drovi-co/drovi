from __future__ import annotations

import os

import pytest

from src.config import get_settings
from src.plugins.registry import get_plugin_registry


@pytest.mark.unit
def test_registry_defaults_to_core_plugin():
    # Ensure we don't leak env from other tests.
    os.environ.pop("ENABLED_PLUGINS", None)
    get_settings.cache_clear()

    reg = get_plugin_registry()
    assert reg.uio_type_names() == ["brief", "claim", "commitment", "decision", "risk", "task"]


@pytest.mark.unit
def test_registry_rejects_unknown_plugin():
    os.environ["ENABLED_PLUGINS"] = '["not_a_real_plugin"]'
    get_settings.cache_clear()

    with pytest.raises(RuntimeError):
        get_plugin_registry()

