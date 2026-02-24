"""Lightweight in-process schema registry for event contract enforcement."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

from src.streaming.world_brain_event_contracts import all_world_brain_event_schemas


def _required_fields(schema: dict[str, Any]) -> set[str]:
    required = schema.get("required")
    if not isinstance(required, list):
        return set()
    return {str(item) for item in required if str(item)}


def _properties(schema: dict[str, Any]) -> set[str]:
    props = schema.get("properties")
    if not isinstance(props, dict):
        return set()
    return {str(key) for key in props if str(key)}


@dataclass(frozen=True, slots=True)
class RegistrySubject:
    subject: str
    schema: dict[str, Any]


class SchemaRegistry:
    """Contract registry with basic compatibility checks."""

    def __init__(self) -> None:
        self._subjects: dict[str, RegistrySubject] = {}

    def register(self, *, subject: str, schema: dict[str, Any], compatibility: str = "backward") -> None:
        if not subject:
            raise ValueError("Schema subject is required")
        existing = self._subjects.get(subject)
        if existing is not None:
            self._assert_compatible(
                previous=existing.schema,
                current=schema,
                compatibility=compatibility,
            )
        self._subjects[subject] = RegistrySubject(subject=subject, schema=dict(schema))

    def get(self, subject: str) -> RegistrySubject | None:
        return self._subjects.get(subject)

    def subjects(self) -> list[str]:
        return sorted(self._subjects)

    def validate_payload_shape(self, *, subject: str, payload: dict[str, Any]) -> None:
        entry = self._subjects.get(subject)
        if entry is None:
            raise ValueError(f"Schema subject not registered: {subject}")
        schema = entry.schema
        required = _required_fields(schema)
        missing = [field for field in required if field not in payload]
        if missing:
            raise ValueError(f"Payload missing required fields for {subject}: {', '.join(sorted(missing))}")

    @staticmethod
    def _assert_compatible(
        *,
        previous: dict[str, Any],
        current: dict[str, Any],
        compatibility: str,
    ) -> None:
        mode = str(compatibility or "backward").strip().lower()
        if mode not in {"backward", "forward", "full"}:
            raise ValueError(f"Unsupported compatibility mode: {compatibility}")

        previous_required = _required_fields(previous)
        current_required = _required_fields(current)
        previous_props = _properties(previous)
        current_props = _properties(current)

        if mode in {"backward", "full"}:
            removed_required = previous_required - current_required
            if removed_required:
                raise ValueError(
                    "Backward compatibility violation; removed required fields: "
                    + ", ".join(sorted(removed_required))
                )
            removed_props = previous_props - current_props
            if removed_props:
                raise ValueError(
                    "Backward compatibility violation; removed properties: "
                    + ", ".join(sorted(removed_props))
                )

        if mode in {"forward", "full"}:
            added_required = current_required - previous_required
            if added_required:
                raise ValueError(
                    "Forward compatibility violation; added required fields: "
                    + ", ".join(sorted(added_required))
                )


_registry: SchemaRegistry | None = None


def _contracts_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "contracts" / "events" / "world_brain"


def build_contract_registry() -> SchemaRegistry:
    registry = SchemaRegistry()
    contracts_dir = _contracts_dir()
    if contracts_dir.exists():
        for path in sorted(contracts_dir.glob("*.schema.json")):
            schema = json.loads(path.read_text(encoding="utf-8"))
            subject = path.name.replace(".schema.json", "")
            registry.register(subject=subject, schema=schema, compatibility="backward")
        return registry

    # Fallback to in-code contracts if snapshot files are unavailable.
    for subject, schema in all_world_brain_event_schemas().items():
        registry.register(subject=subject, schema=schema, compatibility="backward")
    return registry


def get_schema_registry() -> SchemaRegistry:
    global _registry
    if _registry is None:
        _registry = build_contract_registry()
    return _registry

