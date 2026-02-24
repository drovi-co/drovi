"""Online calibration and source-learning loops."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from src.kernel.time import utc_now


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(slots=True)
class OutcomeFeedback:
    object_ref: str
    source_key: str
    predicted_probability: float
    observed_outcome: int  # 0 or 1
    observed_at: datetime


@dataclass(slots=True)
class CorrectionEvent:
    event_id: str
    object_ref: str
    source_key: str
    event_type: str
    occurred_at: datetime
    predicted_probability: float | None = None
    corrected_outcome: int | None = None
    metadata: dict[str, Any] | None = None


@dataclass(slots=True)
class CalibrationSnapshot:
    sample_size: int
    brier_score: float
    reliability: float
    resolution: float
    uncertainty: float
    source_adjustments: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "sample_size": self.sample_size,
            "brier_score": round(self.brier_score, 4),
            "reliability": round(self.reliability, 4),
            "resolution": round(self.resolution, 4),
            "uncertainty": round(self.uncertainty, 4),
            "source_adjustments": {
                key: round(value, 4)
                for key, value in sorted(self.source_adjustments.items(), key=lambda item: item[0])
            },
        }


@dataclass(slots=True)
class LearningCadenceDecision:
    should_recalibrate: bool
    should_retrain: bool
    reason: str
    next_recalibration_at: datetime
    next_retrain_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "should_recalibrate": self.should_recalibrate,
            "should_retrain": self.should_retrain,
            "reason": self.reason,
            "next_recalibration_at": self.next_recalibration_at.isoformat(),
            "next_retrain_at": self.next_retrain_at.isoformat(),
        }


class LearningEngine:
    """Maintains lightweight online calibration from realized outcomes."""

    def build_snapshot(self, feedback: list[OutcomeFeedback]) -> CalibrationSnapshot:
        if not feedback:
            return CalibrationSnapshot(
                sample_size=0,
                brier_score=0.0,
                reliability=0.0,
                resolution=0.0,
                uncertainty=0.0,
                source_adjustments={},
            )

        predictions = [_clamp(item.predicted_probability, 0.0, 1.0) for item in feedback]
        outcomes = [1.0 if int(item.observed_outcome) > 0 else 0.0 for item in feedback]

        brier = sum((prob - outcome) ** 2 for prob, outcome in zip(predictions, outcomes, strict=True)) / len(predictions)

        mean_outcome = sum(outcomes) / len(outcomes)
        uncertainty = mean_outcome * (1.0 - mean_outcome)

        buckets: dict[int, list[tuple[float, float]]] = {}
        for prob, outcome in zip(predictions, outcomes, strict=True):
            bucket = int(prob * 10)
            buckets.setdefault(bucket, []).append((prob, outcome))

        reliability = 0.0
        resolution = 0.0
        for rows in buckets.values():
            weight = len(rows) / len(predictions)
            mean_prob = sum(item[0] for item in rows) / len(rows)
            mean_bucket_outcome = sum(item[1] for item in rows) / len(rows)
            reliability += weight * ((mean_prob - mean_bucket_outcome) ** 2)
            resolution += weight * ((mean_bucket_outcome - mean_outcome) ** 2)

        adjustments = self._compute_source_adjustments(feedback)

        return CalibrationSnapshot(
            sample_size=len(feedback),
            brier_score=brier,
            reliability=reliability,
            resolution=resolution,
            uncertainty=uncertainty,
            source_adjustments=adjustments,
        )

    def ingest_correction_events(
        self,
        events: list[CorrectionEvent],
    ) -> list[OutcomeFeedback]:
        feedback: list[OutcomeFeedback] = []
        for event in events:
            prob = event.predicted_probability
            if prob is None and event.metadata:
                raw = event.metadata.get("predicted_probability")
                if raw is not None:
                    try:
                        prob = float(raw)
                    except (TypeError, ValueError):
                        prob = None
            if prob is None:
                prob = 0.5

            outcome = event.corrected_outcome
            if outcome is None:
                outcome = self._derive_event_outcome(event)

            feedback.append(
                OutcomeFeedback(
                    object_ref=event.object_ref,
                    source_key=event.source_key,
                    predicted_probability=_clamp(prob, 0.0, 1.0),
                    observed_outcome=1 if int(outcome) > 0 else 0,
                    observed_at=event.occurred_at,
                )
            )
        return feedback

    def decide_cadence(
        self,
        *,
        last_recalibration_at: datetime,
        last_retrain_at: datetime,
        new_feedback_count: int,
        recalibration_min_events: int = 20,
        retrain_min_events: int = 100,
        recalibration_cadence_hours: int = 24,
        retrain_cadence_hours: int = 24 * 7,
        now: datetime | None = None,
    ) -> LearningCadenceDecision:
        reference_now = now or utc_now()
        recalibration_due = (reference_now - last_recalibration_at).total_seconds() >= (
            max(1, recalibration_cadence_hours) * 3600
        )
        retrain_due = (reference_now - last_retrain_at).total_seconds() >= (
            max(1, retrain_cadence_hours) * 3600
        )

        should_recalibrate = recalibration_due and new_feedback_count >= max(1, recalibration_min_events)
        should_retrain = retrain_due and new_feedback_count >= max(1, retrain_min_events)

        if should_retrain:
            reason = "retrain_due_with_sufficient_feedback"
        elif should_recalibrate:
            reason = "recalibration_due_with_sufficient_feedback"
        elif new_feedback_count < min(recalibration_min_events, retrain_min_events):
            reason = "insufficient_feedback_volume"
        elif retrain_due or recalibration_due:
            reason = "cadence_due_waiting_for_feedback_threshold"
        else:
            reason = "cadence_not_due"

        next_recalibration_at = (
            reference_now if should_recalibrate else last_recalibration_at
        )
        next_retrain_at = reference_now if should_retrain else last_retrain_at

        return LearningCadenceDecision(
            should_recalibrate=should_recalibrate,
            should_retrain=should_retrain,
            reason=reason,
            next_recalibration_at=next_recalibration_at,
            next_retrain_at=next_retrain_at,
        )

    def recalibrate_probability(
        self,
        *,
        probability: float,
        reliability_error: float,
    ) -> float:
        prob = _clamp(probability, 0.0, 1.0)
        shrink = _clamp(reliability_error, 0.0, 1.0) * 0.3
        return _clamp((0.5 * shrink) + (prob * (1.0 - shrink)), 0.01, 0.99)

    def _compute_source_adjustments(self, feedback: list[OutcomeFeedback]) -> dict[str, float]:
        by_source: dict[str, list[float]] = {}
        for item in feedback:
            prob = _clamp(item.predicted_probability, 0.0, 1.0)
            outcome = 1.0 if int(item.observed_outcome) > 0 else 0.0
            error = outcome - prob
            by_source.setdefault(item.source_key, []).append(error)

        adjustments: dict[str, float] = {}
        for source, errors in by_source.items():
            avg_error = sum(errors) / len(errors)
            adjustments[source] = _clamp(avg_error * 0.5, -0.25, 0.25)

        return adjustments

    @staticmethod
    def _derive_event_outcome(event: CorrectionEvent) -> int:
        event_type = str(event.event_type).strip().lower()
        metadata = event.metadata or {}

        if event_type == "user_correction":
            verdict = str(metadata.get("verdict") or metadata.get("status") or "").strip().lower()
            return 0 if verdict in {"rejected", "false_positive"} else 1

        if event_type == "contradiction_outcome":
            resolved = str(metadata.get("resolved") or metadata.get("outcome") or "").strip().lower()
            return 1 if resolved in {"true", "confirmed", "validated"} else 0

        if event_type == "intervention_outcome":
            success = metadata.get("success")
            if isinstance(success, bool):
                return 1 if success else 0
            score = metadata.get("outcome_score")
            try:
                return 1 if float(score) >= 0.5 else 0
            except (TypeError, ValueError):
                return 0

        return 1 if bool(metadata.get("positive")) else 0

    def make_feedback(
        self,
        *,
        object_ref: str,
        source_key: str,
        predicted_probability: float,
        observed_outcome: int,
        observed_at: datetime | None = None,
    ) -> OutcomeFeedback:
        return OutcomeFeedback(
            object_ref=object_ref,
            source_key=source_key,
            predicted_probability=predicted_probability,
            observed_outcome=1 if observed_outcome else 0,
            observed_at=observed_at or utc_now(),
        )
