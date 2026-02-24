"""Automated label generation from correction and outcome events."""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

from src.features.schemas import LabelRecord


def _to_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        return datetime.fromisoformat(normalized)
    raise ValueError(f"Unsupported datetime value: {value!r}")


class LabelPipeline:
    """Builds consistent labels for supervised learning from system feedback streams."""

    def from_events(self, events: list[dict[str, Any]]) -> list[LabelRecord]:
        labels: list[LabelRecord] = []
        for event in events:
            event_type = str(event.get("event_type") or "").strip().lower()
            if not event_type:
                continue

            target_ref = str(event.get("target_ref") or event.get("object_ref") or "").strip()
            if not target_ref:
                continue
            occurred_at = _to_datetime(event.get("occurred_at"))

            if event_type == "user_correction":
                labels.extend(self._from_user_correction(event, target_ref, occurred_at))
            elif event_type == "contradiction_outcome":
                labels.extend(self._from_contradiction_outcome(event, target_ref, occurred_at))
            elif event_type == "intervention_outcome":
                labels.extend(self._from_intervention_outcome(event, target_ref, occurred_at))
        return labels

    def _from_user_correction(
        self,
        event: dict[str, Any],
        target_ref: str,
        occurred_at: datetime,
    ) -> list[LabelRecord]:
        verdict = str(event.get("verdict") or event.get("status") or "accepted").strip().lower()
        value = 0 if verdict in {"rejected", "false_positive"} else 1
        return [
            self._label(
                target_ref=target_ref,
                label_name="user_correction_quality",
                label_value=value,
                label_time=occurred_at,
                source_event_type="user_correction",
                metadata={"verdict": verdict},
            )
        ]

    def _from_contradiction_outcome(
        self,
        event: dict[str, Any],
        target_ref: str,
        occurred_at: datetime,
    ) -> list[LabelRecord]:
        outcome = str(event.get("outcome") or event.get("resolution") or "").strip().lower()
        contradiction_confirmed = 1 if outcome in {"confirmed", "validated", "true"} else 0
        return [
            self._label(
                target_ref=target_ref,
                label_name="contradiction_confirmed",
                label_value=contradiction_confirmed,
                label_time=occurred_at,
                source_event_type="contradiction_outcome",
                metadata={"outcome": outcome},
            )
        ]

    def _from_intervention_outcome(
        self,
        event: dict[str, Any],
        target_ref: str,
        occurred_at: datetime,
    ) -> list[LabelRecord]:
        score = event.get("outcome_score")
        success_flag = event.get("success")
        if isinstance(success_flag, bool):
            value = 1 if success_flag else 0
        else:
            try:
                value = 1 if float(score) >= 0.5 else 0
            except (TypeError, ValueError):
                value = 0

        return [
            self._label(
                target_ref=target_ref,
                label_name="intervention_effective",
                label_value=value,
                label_time=occurred_at,
                source_event_type="intervention_outcome",
                metadata={"outcome_score": score},
            )
        ]

    @staticmethod
    def _label(
        *,
        target_ref: str,
        label_name: str,
        label_value: int,
        label_time: datetime,
        source_event_type: str,
        metadata: dict[str, Any],
    ) -> LabelRecord:
        digest = hashlib.sha256(
            f"{target_ref}|{label_name}|{label_time.isoformat()}|{label_value}|{source_event_type}".encode("utf-8")
        ).hexdigest()[:16]
        return LabelRecord(
            label_id=f"lbl_{digest}",
            target_ref=target_ref,
            label_name=label_name,
            label_value=1 if int(label_value) > 0 else 0,
            label_time=label_time,
            source_event_type=source_event_type,
            metadata=metadata,
        )

