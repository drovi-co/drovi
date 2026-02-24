from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True, slots=True)
class FeatureDefinition:
    name: str
    source_table: str
    value_type: str
    description: str = ""
    default_value: float | int | str | bool | None = None


@dataclass(frozen=True, slots=True)
class FeatureRecord:
    entity_id: str
    feature_name: str
    feature_value: float | int | str | bool | None
    event_time: datetime
    available_at: datetime
    source_table: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class FeatureSnapshot:
    entity_id: str
    as_of: datetime
    values: dict[str, float | int | str | bool | None]
    provenance: dict[str, dict[str, Any]]


@dataclass(frozen=True, slots=True)
class LabelRecord:
    label_id: str
    target_ref: str
    label_name: str
    label_value: int
    label_time: datetime
    source_event_type: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class DatasetQualityReport:
    sample_count: int
    null_drift: dict[str, float]
    leakage_violations: int
    class_balance: dict[str, float]
    passed: bool
    details: dict[str, Any] = field(default_factory=dict)

