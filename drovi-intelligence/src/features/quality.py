"""Feature/label dataset quality checks used before model training."""

from __future__ import annotations

from datetime import datetime

from src.features.schemas import DatasetQualityReport, FeatureSnapshot, LabelRecord


class FeatureLabelQualityValidator:
    """Runs null-drift, leakage, and class-balance validations."""

    def validate(
        self,
        *,
        feature_snapshots: list[FeatureSnapshot],
        labels: list[LabelRecord],
        max_null_ratio: float = 0.2,
        min_positive_ratio: float = 0.1,
        max_leakage_violations: int = 0,
    ) -> DatasetQualityReport:
        sample_count = len(feature_snapshots)
        null_drift = self._null_drift(feature_snapshots)
        leakage_violations = self._leakage_violations(feature_snapshots, labels)
        class_balance = self._class_balance(labels)

        null_ok = all(ratio <= max_null_ratio for ratio in null_drift.values())
        balance_ok = all(ratio >= min_positive_ratio for ratio in class_balance.values())
        leakage_ok = leakage_violations <= max_leakage_violations
        passed = bool(null_ok and balance_ok and leakage_ok)

        return DatasetQualityReport(
            sample_count=sample_count,
            null_drift={key: round(value, 4) for key, value in null_drift.items()},
            leakage_violations=leakage_violations,
            class_balance={key: round(value, 4) for key, value in class_balance.items()},
            passed=passed,
            details={
                "null_ok": null_ok,
                "balance_ok": balance_ok,
                "leakage_ok": leakage_ok,
                "max_null_ratio": max_null_ratio,
                "min_positive_ratio": min_positive_ratio,
                "max_leakage_violations": max_leakage_violations,
            },
        )

    def _null_drift(self, snapshots: list[FeatureSnapshot]) -> dict[str, float]:
        if not snapshots:
            return {}

        total = len(snapshots)
        feature_nulls: dict[str, int] = {}
        feature_counts: dict[str, int] = {}
        for snapshot in snapshots:
            for name, value in snapshot.values.items():
                feature_counts[name] = feature_counts.get(name, 0) + 1
                if value is None:
                    feature_nulls[name] = feature_nulls.get(name, 0) + 1

        return {
            name: feature_nulls.get(name, 0) / max(1, min(total, feature_counts.get(name, total)))
            for name in feature_counts
        }

    def _class_balance(self, labels: list[LabelRecord]) -> dict[str, float]:
        grouped: dict[str, list[int]] = {}
        for label in labels:
            grouped.setdefault(label.label_name, []).append(1 if label.label_value > 0 else 0)
        return {
            label_name: (sum(values) / len(values)) if values else 0.0
            for label_name, values in grouped.items()
        }

    def _leakage_violations(
        self,
        snapshots: list[FeatureSnapshot],
        labels: list[LabelRecord],
    ) -> int:
        by_entity: dict[str, FeatureSnapshot] = {snapshot.entity_id: snapshot for snapshot in snapshots}
        violations = 0
        for label in labels:
            snapshot = by_entity.get(label.target_ref)
            if snapshot is None:
                continue
            for provenance in snapshot.provenance.values():
                available_at = provenance.get("available_at")
                if isinstance(available_at, str):
                    normalized = available_at[:-1] + "+00:00" if available_at.endswith("Z") else available_at
                    try:
                        if label.label_time < datetime.fromisoformat(normalized):
                            violations += 1
                    except ValueError:
                        continue
        return violations
