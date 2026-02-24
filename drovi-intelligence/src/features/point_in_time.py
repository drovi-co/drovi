"""Point-in-time-correct feature extraction from historical observations."""

from __future__ import annotations

from datetime import datetime
from typing import Iterable

from src.features.schemas import FeatureDefinition, FeatureRecord, FeatureSnapshot


class PointInTimeFeatureExtractor:
    """Builds leakage-safe feature snapshots for training and backtests."""

    def __init__(self, *, definitions: list[FeatureDefinition] | None = None) -> None:
        self._definitions = {definition.name: definition for definition in definitions or []}

    def extract_snapshot(
        self,
        *,
        records: Iterable[FeatureRecord],
        entity_id: str,
        as_of: datetime,
        include_features: set[str] | None = None,
    ) -> FeatureSnapshot:
        latest: dict[str, FeatureRecord] = {}
        for record in records:
            if record.entity_id != entity_id:
                continue
            if include_features and record.feature_name not in include_features:
                continue
            # Prevent temporal leakage: both event and availability must be <= as_of.
            if record.event_time > as_of or record.available_at > as_of:
                continue
            existing = latest.get(record.feature_name)
            if existing is None or (record.available_at, record.event_time) > (
                existing.available_at,
                existing.event_time,
            ):
                latest[record.feature_name] = record

        values: dict[str, float | int | str | bool | None] = {}
        provenance: dict[str, dict[str, object]] = {}

        for feature_name, definition in self._definitions.items():
            if include_features and feature_name not in include_features:
                continue
            selected = latest.get(feature_name)
            if selected is None:
                values[feature_name] = definition.default_value
                provenance[feature_name] = {
                    "source_table": definition.source_table,
                    "fallback_default": True,
                }
            else:
                values[feature_name] = selected.feature_value
                provenance[feature_name] = {
                    "source_table": selected.source_table,
                    "event_time": selected.event_time.isoformat(),
                    "available_at": selected.available_at.isoformat(),
                    "fallback_default": False,
                }

        for feature_name, record in latest.items():
            if feature_name in values:
                continue
            if include_features and feature_name not in include_features:
                continue
            values[feature_name] = record.feature_value
            provenance[feature_name] = {
                "source_table": record.source_table,
                "event_time": record.event_time.isoformat(),
                "available_at": record.available_at.isoformat(),
                "fallback_default": False,
            }

        return FeatureSnapshot(
            entity_id=entity_id,
            as_of=as_of,
            values=values,
            provenance=provenance,
        )

    def build_dataset(
        self,
        *,
        records: Iterable[FeatureRecord],
        entity_as_of: dict[str, datetime],
        include_features: set[str] | None = None,
    ) -> list[FeatureSnapshot]:
        materialized = list(records)
        return [
            self.extract_snapshot(
                records=materialized,
                entity_id=entity_id,
                as_of=as_of,
                include_features=include_features,
            )
            for entity_id, as_of in entity_as_of.items()
        ]

