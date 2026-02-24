"""Online learning orchestration for correction ingest, cadence, and rollout planning."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from src.learning.engine import (
    CalibrationSnapshot,
    CorrectionEvent,
    LearningCadenceDecision,
    LearningEngine,
)


@dataclass(slots=True)
class LearningIngestResult:
    feedback_count: int
    snapshot: CalibrationSnapshot
    source_event_counts: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "feedback_count": self.feedback_count,
            "snapshot": self.snapshot.to_dict(),
            "source_event_counts": dict(self.source_event_counts),
        }


class LearningPipeline:
    """Coordinates online learning loops from user/system correction streams."""

    def __init__(self, *, engine: LearningEngine | None = None) -> None:
        self._engine = engine or LearningEngine()

    def ingest_corrections(self, events: list[CorrectionEvent]) -> LearningIngestResult:
        feedback = self._engine.ingest_correction_events(events)
        snapshot = self._engine.build_snapshot(feedback)

        by_source: dict[str, int] = {}
        for event in events:
            by_source[event.event_type] = by_source.get(event.event_type, 0) + 1

        return LearningIngestResult(
            feedback_count=len(feedback),
            snapshot=snapshot,
            source_event_counts=by_source,
        )

    def decide_retrain_cadence(
        self,
        *,
        last_recalibration_at: datetime,
        last_retrain_at: datetime,
        new_feedback_count: int,
        now: datetime | None = None,
    ) -> LearningCadenceDecision:
        return self._engine.decide_cadence(
            last_recalibration_at=last_recalibration_at,
            last_retrain_at=last_retrain_at,
            new_feedback_count=new_feedback_count,
            now=now,
        )

    def shadow_rollout_plan(
        self,
        *,
        candidate_model_id: str,
        baseline_model_id: str,
        calibration_snapshot: CalibrationSnapshot,
        max_shadow_traffic_pct: float = 20.0,
    ) -> dict[str, Any]:
        # Conservative rollout: only move meaningful traffic if calibration is healthy.
        if calibration_snapshot.sample_size < 50:
            traffic = 5.0
            rationale = "limited_feedback_keep_shadow_small"
        elif calibration_snapshot.brier_score <= 0.2:
            traffic = max_shadow_traffic_pct
            rationale = "healthy_calibration_allow_full_shadow_budget"
        else:
            traffic = min(max_shadow_traffic_pct, 10.0)
            rationale = "elevated_brier_cap_shadow_budget"

        return {
            "mode": "shadow",
            "candidate_model_id": candidate_model_id,
            "baseline_model_id": baseline_model_id,
            "traffic_percentage": round(max(1.0, min(50.0, traffic)), 2),
            "calibration_brier_score": round(calibration_snapshot.brier_score, 4),
            "sample_size": calibration_snapshot.sample_size,
            "rationale": rationale,
        }

    def scheduled_jobs_for_decision(
        self,
        *,
        organization_id: str,
        decision: LearningCadenceDecision,
    ) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        if decision.should_recalibrate:
            jobs.append(
                {
                    "job_type": "learning.recalibrate",
                    "organization_id": organization_id,
                    "priority": 3,
                    "payload": {"organization_id": organization_id},
                }
            )
        if decision.should_retrain:
            jobs.append(
                {
                    "job_type": "mlops.shadow.evaluate",
                    "organization_id": organization_id,
                    "priority": 2,
                    "payload": {
                        "organization_id": organization_id,
                        "trigger": "scheduled_retrain",
                    },
                }
            )
        return jobs

