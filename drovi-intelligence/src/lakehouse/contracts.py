"""Lakehouse table schemas and compatibility rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FieldSpec:
    name: str
    required: bool
    expected_types: tuple[type, ...]


@dataclass(frozen=True)
class TableSchema:
    table_name: str
    layer: str
    schema_version: str
    primary_key: str
    event_time_field: str
    fields: tuple[FieldSpec, ...]


SCHEMA_REGISTRY: dict[str, dict[str, TableSchema]] = {
    "bronze.raw_observations": {
        "1.0": TableSchema(
            table_name="bronze.raw_observations",
            layer="bronze",
            schema_version="1.0",
            primary_key="record_key",
            event_time_field="event_time",
            fields=(
                FieldSpec("record_key", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("event_time", True, (str,)),
                FieldSpec("payload", True, (dict,)),
                FieldSpec("metadata", False, (dict,)),
            ),
        )
    },
    "silver.observations": {
        "1.0": TableSchema(
            table_name="silver.observations",
            layer="silver",
            schema_version="1.0",
            primary_key="observation_id",
            event_time_field="observed_at",
            fields=(
                FieldSpec("observation_id", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("observed_at", True, (str,)),
                FieldSpec("normalized_text", True, (str,)),
                FieldSpec("entities", False, (list,)),
                FieldSpec("evidence_links", False, (list,)),
                FieldSpec("metadata", False, (dict,)),
            ),
        )
    },
    "silver.entities": {
        "1.0": TableSchema(
            table_name="silver.entities",
            layer="silver",
            schema_version="1.0",
            primary_key="entity_key",
            event_time_field="event_time",
            fields=(
                FieldSpec("entity_key", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("event_time", True, (str,)),
                FieldSpec("entity_type", True, (str,)),
                FieldSpec("attributes", False, (dict,)),
            ),
        )
    },
    "silver.evidence_links": {
        "1.0": TableSchema(
            table_name="silver.evidence_links",
            layer="silver",
            schema_version="1.0",
            primary_key="link_key",
            event_time_field="event_time",
            fields=(
                FieldSpec("link_key", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("event_time", True, (str,)),
                FieldSpec("observation_id", True, (str,)),
                FieldSpec("artifact_ref", False, (str, type(None))),
                FieldSpec("metadata", False, (dict,)),
            ),
        )
    },
    "gold.impact_features": {
        "1.0": TableSchema(
            table_name="gold.impact_features",
            layer="gold",
            schema_version="1.0",
            primary_key="feature_key",
            event_time_field="event_time",
            fields=(
                FieldSpec("feature_key", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("event_time", True, (str,)),
                FieldSpec("feature_vector", True, (dict,)),
                FieldSpec("labels", False, (dict,)),
            ),
        )
    },
    "gold.simulation_features": {
        "1.0": TableSchema(
            table_name="gold.simulation_features",
            layer="gold",
            schema_version="1.0",
            primary_key="simulation_key",
            event_time_field="event_time",
            fields=(
                FieldSpec("simulation_key", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("event_time", True, (str,)),
                FieldSpec("inputs", True, (dict,)),
                FieldSpec("outputs", False, (dict,)),
            ),
        )
    },
    "gold.eval_features": {
        "1.0": TableSchema(
            table_name="gold.eval_features",
            layer="gold",
            schema_version="1.0",
            primary_key="eval_key",
            event_time_field="event_time",
            fields=(
                FieldSpec("eval_key", True, (str,)),
                FieldSpec("organization_id", True, (str,)),
                FieldSpec("source_key", True, (str,)),
                FieldSpec("event_time", True, (str,)),
                FieldSpec("metrics", True, (dict,)),
                FieldSpec("labels", False, (dict,)),
            ),
        )
    },
}


def get_table_schema(table_name: str, schema_version: str = "1.0") -> TableSchema:
    versions = SCHEMA_REGISTRY.get(table_name)
    if not versions:
        raise ValueError(f"Unknown lakehouse table schema: {table_name}")
    schema = versions.get(schema_version)
    if not schema:
        supported = ", ".join(sorted(versions.keys()))
        raise ValueError(
            f"Unknown schema version {schema_version} for {table_name}; supported: {supported}"
        )
    return schema


def validate_schema_payload(
    *,
    table_name: str,
    schema_version: str,
    payload: dict[str, Any],
) -> tuple[bool, list[str]]:
    schema = get_table_schema(table_name, schema_version=schema_version)
    errors: list[str] = []
    for field in schema.fields:
        if field.required and field.name not in payload:
            errors.append(f"missing_required:{field.name}")
            continue
        if field.name in payload and payload[field.name] is not None:
            if not isinstance(payload[field.name], field.expected_types):
                expected = "|".join(tp.__name__ for tp in field.expected_types)
                errors.append(f"type_mismatch:{field.name}:expected={expected}")
    return len(errors) == 0, errors


def assert_schema_evolution_compatible(*, table_name: str, from_version: str, to_version: str) -> None:
    """
    Compatibility rule:
    - required fields from old schema must exist and remain required in new schema.
    """
    older = get_table_schema(table_name, schema_version=from_version)
    newer = get_table_schema(table_name, schema_version=to_version)

    newer_fields = {field.name: field for field in newer.fields}
    for old_field in older.fields:
        if not old_field.required:
            continue
        if old_field.name not in newer_fields:
            raise ValueError(f"Incompatible schema evolution: removed required field {old_field.name}")
        if not newer_fields[old_field.name].required:
            raise ValueError(
                f"Incompatible schema evolution: required field downgraded {old_field.name}"
            )
