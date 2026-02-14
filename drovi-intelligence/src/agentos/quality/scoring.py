from __future__ import annotations

from datetime import timedelta
from statistics import mean
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import QualityTrendPoint, QualityTrendResponse, RunQualityScoreRecord


_RUN_FEEDBACK_SCORE = {
    "accepted": 1.0,
    "edited": 0.7,
    "needs_review": 0.4,
    "rejected": 0.0,
}

_RECEIPT_SUCCESS_STATES = {
    "completed",
    "sent",
    "approved",
    "allow",
    "delivered",
    "executed",
}

_RECEIPT_BLOCKED_STATES = {"denied", "blocked", "failed", "error"}


class RunQualityScoringService:
    """Computes and persists online quality scores for AgentOS runs."""

    async def score_run(
        self,
        *,
        organization_id: str,
        run_id: str,
    ) -> RunQualityScoreRecord:
        run = await self._load_run(organization_id=organization_id, run_id=run_id)
        if run is None:
            raise ValueError("Run not found")

        steps = await self._load_steps(run_id=run_id)
        receipts = await self._load_receipts(organization_id=organization_id, run_id=run_id)
        feedback = await self._load_feedback(organization_id=organization_id, run_id=run_id)

        completed_steps = sum(1 for step in steps if str(step.get("status", "")).lower() == "completed")
        total_steps = len(steps)
        step_completion_ratio = completed_steps / total_steps if total_steps else 0.0

        evidence_steps = sum(1 for step in steps if bool(step.get("evidence_refs")))
        evidence_coverage = evidence_steps / total_steps if total_steps else 0.0

        successful_receipts = sum(
            1 for receipt in receipts if str(receipt.get("final_status", "")).lower() in _RECEIPT_SUCCESS_STATES
        )
        blocked_receipts = sum(
            1 for receipt in receipts if str(receipt.get("final_status", "")).lower() in _RECEIPT_BLOCKED_STATES
        )
        receipt_total = len(receipts)
        receipt_success_ratio = successful_receipts / receipt_total if receipt_total else 1.0

        completion_score = _completion_score(status=str(run.get("status") or "accepted"))
        feedback_values = [_RUN_FEEDBACK_SCORE.get(str(item.get("verdict", "")).lower(), 0.4) for item in feedback]
        feedback_score = mean(feedback_values) if feedback_values else 0.6
        outcome_score = mean(feedback_values) if feedback_values else None

        policy_block_penalty = min(0.25, blocked_receipts * 0.05)
        quality_score = clamp(
            (completion_score * 0.30)
            + (step_completion_ratio * 0.20)
            + (evidence_coverage * 0.20)
            + (receipt_success_ratio * 0.20)
            + (feedback_score * 0.10)
            - policy_block_penalty,
            0.0,
            1.0,
        )
        confidence_score = clamp(
            0.35 + (step_completion_ratio * 0.25) + (evidence_coverage * 0.2) + (receipt_success_ratio * 0.2),
            0.0,
            1.0,
        )
        status = "calibrated" if outcome_score is not None else "pending_feedback"

        breakdown = {
            "completion_score": completion_score,
            "step_completion_ratio": step_completion_ratio,
            "evidence_coverage": evidence_coverage,
            "receipt_success_ratio": receipt_success_ratio,
            "feedback_score": feedback_score,
            "policy_block_penalty": policy_block_penalty,
            "blocked_receipts": blocked_receipts,
            "total_receipts": receipt_total,
            "total_steps": total_steps,
        }

        now = utc_now()
        score_id = new_prefixed_id("agqsc")
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_run_quality_score (
                        id,
                        organization_id,
                        run_id,
                        deployment_id,
                        role_id,
                        quality_score,
                        confidence_score,
                        outcome_score,
                        status,
                        score_breakdown,
                        evaluated_at,
                        created_at,
                        updated_at
                    ) VALUES (
                        :id,
                        :organization_id,
                        :run_id,
                        :deployment_id,
                        :role_id,
                        :quality_score,
                        :confidence_score,
                        :outcome_score,
                        :status,
                        CAST(:score_breakdown AS JSONB),
                        :evaluated_at,
                        :created_at,
                        :updated_at
                    )
                    ON CONFLICT (run_id) DO UPDATE
                    SET quality_score = EXCLUDED.quality_score,
                        confidence_score = EXCLUDED.confidence_score,
                        outcome_score = EXCLUDED.outcome_score,
                        status = EXCLUDED.status,
                        score_breakdown = EXCLUDED.score_breakdown,
                        deployment_id = EXCLUDED.deployment_id,
                        role_id = EXCLUDED.role_id,
                        evaluated_at = EXCLUDED.evaluated_at,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": score_id,
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "deployment_id": run.get("deployment_id"),
                    "role_id": run.get("role_id"),
                    "quality_score": quality_score,
                    "confidence_score": confidence_score,
                    "outcome_score": outcome_score,
                    "status": status,
                    "score_breakdown": json_dumps_canonical(breakdown),
                    "evaluated_at": now,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            row_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, run_id, deployment_id, role_id, quality_score, confidence_score,
                           outcome_score, status, score_breakdown, evaluated_at, created_at, updated_at
                    FROM agent_run_quality_score
                    WHERE run_id = :run_id
                    """
                ),
                {"run_id": run_id},
            )
            row = row_result.fetchone()
            await session.commit()

        if row is None:
            raise RuntimeError("Failed to persist run quality score")
        return RunQualityScoreRecord.model_validate(_row_dict(row, json_fields={"score_breakdown"}))

    async def list_trends(
        self,
        *,
        organization_id: str,
        role_id: str | None = None,
        deployment_id: str | None = None,
        lookback_days: int = 30,
    ) -> QualityTrendResponse:
        start_time = utc_now() - timedelta(days=lookback_days)
        score_rows = await self._load_trend_scores(
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            start_time=start_time,
        )
        eval_rows = await self._load_trend_evals(
            organization_id=organization_id,
            deployment_id=deployment_id,
            start_time=start_time,
        )

        eval_by_bucket: dict[str, float] = {}
        for row in eval_rows:
            bucket_key = str(row["bucket_start"])
            total = int(row["total_count"] or 0)
            passed = int(row["passed_count"] or 0)
            eval_by_bucket[bucket_key] = (passed / total) if total else 0.0

        points: list[QualityTrendPoint] = []
        for row in score_rows:
            bucket_key = str(row["bucket_start"])
            points.append(
                QualityTrendPoint(
                    bucket_start=row["bucket_start"],
                    run_count=int(row["run_count"] or 0),
                    avg_quality_score=_float_or_none(row["avg_quality_score"]),
                    avg_confidence_score=_float_or_none(row["avg_confidence_score"]),
                    avg_outcome_score=_float_or_none(row["avg_outcome_score"]),
                    eval_pass_rate=eval_by_bucket.get(bucket_key),
                )
            )

        summary = {
            "points": len(points),
            "run_count": sum(point.run_count for point in points),
            "avg_quality_score": _mean_or_none([point.avg_quality_score for point in points]),
            "avg_confidence_score": _mean_or_none([point.avg_confidence_score for point in points]),
            "avg_outcome_score": _mean_or_none([point.avg_outcome_score for point in points]),
            "avg_eval_pass_rate": _mean_or_none([point.eval_pass_rate for point in points]),
        }

        return QualityTrendResponse(
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            lookback_days=lookback_days,
            points=points,
            summary=summary,
        )

    async def list_scores(
        self,
        *,
        organization_id: str,
        run_id: str | None = None,
        role_id: str | None = None,
        deployment_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[RunQualityScoreRecord]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, run_id, deployment_id, role_id, quality_score, confidence_score,
                           outcome_score, status, score_breakdown, evaluated_at, created_at, updated_at
                    FROM agent_run_quality_score
                    WHERE organization_id = :organization_id
                      AND (:run_id IS NULL OR run_id = :run_id)
                      AND (:role_id IS NULL OR role_id = :role_id)
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    ORDER BY evaluated_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "role_id": role_id,
                    "deployment_id": deployment_id,
                    "limit": limit,
                    "offset": offset,
                },
            )
            rows = result.fetchall()
        return [
            RunQualityScoreRecord.model_validate(_row_dict(row, json_fields={"score_breakdown"}))
            for row in rows
        ]

    async def _load_run(self, *, organization_id: str, run_id: str) -> dict[str, Any] | None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT r.id,
                           r.organization_id,
                           r.deployment_id,
                           r.status,
                           d.role_id
                    FROM agent_run r
                    LEFT JOIN agent_deployment d ON d.id = r.deployment_id
                    WHERE r.organization_id = :organization_id
                      AND r.id = :run_id
                    """
                ),
                {"organization_id": organization_id, "run_id": run_id},
            )
            row = result.fetchone()
        if row is None:
            return None
        return dict(row._mapping)

    async def _load_steps(self, *, run_id: str) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT status, evidence_refs
                    FROM agent_run_step
                    WHERE run_id = :run_id
                    """
                ),
                {"run_id": run_id},
            )
            rows = result.fetchall()
        return [_row_dict(row, json_fields={"evidence_refs"}) for row in rows]

    async def _load_receipts(self, *, organization_id: str, run_id: str) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT final_status
                    FROM agent_action_receipt
                    WHERE organization_id = :organization_id
                      AND run_id = :run_id
                    """
                ),
                {"organization_id": organization_id, "run_id": run_id},
            )
            rows = result.fetchall()
        return [dict(row._mapping) for row in rows]

    async def _load_feedback(self, *, organization_id: str, run_id: str) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT verdict
                    FROM agent_feedback
                    WHERE organization_id = :organization_id
                      AND run_id = :run_id
                    ORDER BY created_at DESC
                    """
                ),
                {"organization_id": organization_id, "run_id": run_id},
            )
            rows = result.fetchall()
        return [dict(row._mapping) for row in rows]

    async def _load_trend_scores(
        self,
        *,
        organization_id: str,
        role_id: str | None,
        deployment_id: str | None,
        start_time: Any,
    ) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT date_trunc('day', evaluated_at) AS bucket_start,
                           COUNT(*) AS run_count,
                           AVG(quality_score) AS avg_quality_score,
                           AVG(confidence_score) AS avg_confidence_score,
                           AVG(outcome_score) AS avg_outcome_score
                    FROM agent_run_quality_score
                    WHERE organization_id = :organization_id
                      AND evaluated_at >= :start_time
                      AND (:role_id IS NULL OR role_id = :role_id)
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    GROUP BY date_trunc('day', evaluated_at)
                    ORDER BY bucket_start ASC
                    """
                ),
                {
                    "organization_id": organization_id,
                    "start_time": start_time,
                    "role_id": role_id,
                    "deployment_id": deployment_id,
                },
            )
            rows = result.fetchall()
        return [dict(row._mapping) for row in rows]

    async def _load_trend_evals(
        self,
        *,
        organization_id: str,
        deployment_id: str | None,
        start_time: Any,
    ) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT date_trunc('day', evaluated_at) AS bucket_start,
                           COUNT(*) AS total_count,
                           COUNT(*) FILTER (WHERE passed = true) AS passed_count
                    FROM agent_eval_result
                    WHERE organization_id = :organization_id
                      AND evaluated_at >= :start_time
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    GROUP BY date_trunc('day', evaluated_at)
                    ORDER BY bucket_start ASC
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "start_time": start_time,
                },
            )
            rows = result.fetchall()
        return [dict(row._mapping) for row in rows]


def _completion_score(*, status: str) -> float:
    lowered = status.lower()
    if lowered == "completed":
        return 1.0
    if lowered in {"running", "waiting_approval"}:
        return 0.6
    if lowered in {"accepted", "paused"}:
        return 0.4
    if lowered in {"cancelled", "failed", "killed"}:
        return 0.0
    return 0.3


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


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _mean_or_none(values: list[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return mean(present)
