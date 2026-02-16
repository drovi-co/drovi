from __future__ import annotations

import pytest

from src.kernel.ids import is_prefixed_id, new_prefixed_id


@pytest.mark.unit
def test_new_prefixed_id_format():
    value = new_prefixed_id("org")
    assert is_prefixed_id(value, "org")
    assert len(value.split("_", 1)[1]) == 32


@pytest.mark.unit
def test_new_prefixed_id_rejects_invalid_prefix():
    with pytest.raises(ValueError):
        new_prefixed_id("ORG")  # uppercase

