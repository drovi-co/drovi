from __future__ import annotations

from statistics import mean
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import CalibrationBucket, CalibrationSnapshot
from .scoring import clamp


class ConfidenceCalibrationService:
    """Computes calibration metrics from run quality predictions and outcomes."""

    async def recompute(
        self,
        *,
        organization_id: str,
        role_id: str | None = None,
        min_samples: int = 5,
    ) -> CalibrationSnapshot:
        observations = await self._load_observations(organization_id=organization_id, role_id=role_id)
        if len(observations) < min_samples:
            return CalibrationSnapshot(
                id="",
                organization_id=organization_id,
                role_id=role_id,
                sample_count=len(observations),
                mean_absolute_error=0.0,
                brier_score=0.0,
                calibration_error=0.0,
                adjustment_factor=1.0,
                bucket_stats=[],
                metadata={"status": "insufficient_samples", "required_samples": min_samples},
                computed_at=utc_now(),
                created_at=utc_now(),
            )

        errors = [abs(item["confidence"] - item["outcome"]) for item in observations]
        squared_errors = [(item["confidence"] - item["outcome"]) ** 2 for item in observations]
        mean_absolute_error = mean(errors)
        brier_score = mean(squared_errors)
        calibration_error = abs(
            mean(item["confidence"] for item in observations) - mean(item["outcome"] for item in observations)
        )
        adjustment_factor = clamp(1.0 - (mean_absolute_error * 0.75), 0.5, 1.15)
        bucket_stats = _build_buckets(observations)

        snapshot = CalibrationSnapshot(
            id=new_prefixed_id("agcal"),
            organization_id=organization_id,
            role_id=role_id,
            sample_count=len(observations),
            mean_absolute_error=mean_absolute_error,
            brier_score=brier_score,
            calibration_error=calibration_error,
            adjustment_factor=adjustment_factor,
            bucket_stats=bucket_stats,
            metadata={"source": "agent_run_quality_score"},
            computed_at=utc_now(),
            created_at=utc_now(),
        )
        await self._persist_snapshot(snapshot=snapshot)
        return snapshot

    async def get_latest(self, *, organization_id: str, role_id: str | None = None) -> CalibrationSnapshot | None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id,
                           organization_id,
                           role_id,
                           sample_count,
                           mean_absolute_error,
                           brier_score,
                           calibration_error,
                           adjustment_factor,
                           bucket_stats,
                           metadata,
                           computed_at,
                           created_at
                    FROM agent_confidence_calibration
                    WHERE organization_id = :organization_id
                      AND (:role_id IS NULL OR role_id = :role_id)
                    ORDER BY computed_at DESC
                    LIMIT 1
                    """
                ),
                {"organization_id": organization_id, "role_id": role_id},
            )
            row = result.fetchone()
        if row is None:
            return None
        return CalibrationSnapshot.model_validate(_row_dict(row, json_fields={"bucket_stats", "metadata"}))

    async def _persist_snapshot(self, *, snapshot: CalibrationSnapshot) -> None:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_confidence_calibration (
                        id,
                        organization_id,
                        role_id,
                        sample_count,
                        mean_absolute_error,
                        brier_score,
                        calibration_error,
                        adjustment_factor,
                        bucket_stats,
                        metadata,
                        computed_at,
                        created_at
                    ) VALUES (
                        :id,
                        :organization_id,
                        :role_id,
                        :sample_count,
                        :mean_absolute_error,
                        :brier_score,
                        :calibration_error,
                        :adjustment_factor,
                        CAST(:bucket_stats AS JSONB),
                        CAST(:metadata AS JSONB),
                        :computed_at,
                        :created_at
                    )
                    """
                ),
                {
                    "id": snapshot.id,
                    "organization_id": snapshot.organization_id,
                    "role_id": snapshot.role_id,
                    "sample_count": snapshot.sample_count,
                    "mean_absolute_error": snapshot.mean_absolute_error,
                    "brier_score": snapshot.brier_score,
                    "calibration_error": snapshot.calibration_error,
                    "adjustment_factor": snapshot.adjustment_factor,
                    "bucket_stats": json_dumps_canonical(
                        [bucket.model_dump(mode="json") for bucket in snapshot.bucket_stats]
                    ),
                    "metadata": json_dumps_canonical(snapshot.metadata),
                    "computed_at": snapshot.computed_at,
                    "created_at": snapshot.created_at,
                },
            )
            await session.commit()

    async def _load_observations(self, *, organization_id: str, role_id: str | None) -> list[dict[str, float]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT confidence_score, outcome_score
                    FROM agent_run_quality_score
                    WHERE organization_id = :organization_id
                      AND outcome_score IS NOT NULL
                      AND (:role_id IS NULL OR role_id = :role_id)
                    """
                ),
                {"organization_id": organization_id, "role_id": role_id},
            )
            rows = result.fetchall()

        observations: list[dict[str, float]] = []
        for row in rows:
            confidence = float(row.confidence_score)
            outcome = float(row.outcome_score)
            observations.append({"confidence": confidence, "outcome": outcome})
        return observations


def _build_buckets(observations: list[dict[str, float]]) -> list[CalibrationBucket]:
    buckets: list[CalibrationBucket] = []
    for bucket_index in range(10):
        lower = bucket_index / 10
        upper = (bucket_index + 1) / 10
        members = [item for item in observations if lower <= item["confidence"] < upper or (upper == 1.0 and item["confidence"] == 1.0)]
        if not members:
            continue
        buckets.append(
            CalibrationBucket(
                bucket_start=lower,
                bucket_end=upper,
                count=len(members),
                avg_confidence=mean(item["confidence"] for item in members),
                avg_outcome=mean(item["outcome"] for item in members),
            )
        )
    return buckets


def _row_dict(row: Any, *, json_fields: set[str] | None = None) -> dict[str, Any]:
    payload = dict(row._mapping if hasattr(row, "_mapping") else row)
    if not json_fields:
        return payload
    for field in json_fields:
        raw = payload.get(field)
        if isinstance(raw, str):
            try:
                import json

                payload[field] = json.loads(raw)
            except Exception:
                pass
    return payload

