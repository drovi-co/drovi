from __future__ import annotations

import pytest

from src.lakehouse.contracts import (
    assert_schema_evolution_compatible,
    get_table_schema,
    validate_schema_payload,
)


def test_validate_schema_payload_for_silver_observations() -> None:
    is_valid, errors = validate_schema_payload(
        table_name="silver.observations",
        schema_version="1.0",
        payload={
            "observation_id": "obs_1",
            "organization_id": "org_test",
            "source_key": "crawler",
            "observed_at": "2026-02-23T12:00:00+00:00",
            "normalized_text": "Text",
        },
    )
    assert is_valid is True
    assert errors == []


def test_validate_schema_payload_rejects_missing_required_field() -> None:
    is_valid, errors = validate_schema_payload(
        table_name="gold.impact_features",
        schema_version="1.0",
        payload={
            "feature_key": "feat_1",
            "organization_id": "org_test",
            "source_key": "crawler_diff",
            # missing event_time
            "feature_vector": {},
        },
    )
    assert is_valid is False
    assert any(error.startswith("missing_required:event_time") for error in errors)


def test_get_table_schema_raises_for_unknown_table() -> None:
    with pytest.raises(ValueError):
        get_table_schema("unknown.table", schema_version="1.0")


def test_schema_evolution_compatibility_same_version_is_valid() -> None:
    assert_schema_evolution_compatible(
        table_name="silver.observations",
        from_version="1.0",
        to_version="1.0",
    )
