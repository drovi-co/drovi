from __future__ import annotations

from datetime import timedelta
from statistics import mean
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now
from src.monitoring import get_metrics

from .models import QualityRecommendationRecord


class QualityRecommendationService:
    """Generates prompt and policy recommendations from quality drift signals."""

    async def generate(
        self,
        *,
        organization_id: str,
        role_id: str | None = None,
        deployment_id: str | None = None,
        lookback_days: int = 30,
    ) -> list[QualityRecommendationRecord]:
        start_time = utc_now() - timedelta(days=lookback_days)
        feedback_stats = await self._feedback_stats(
            organization_id=organization_id,
            deployment_id=deployment_id,
            start_time=start_time,
        )
        eval_stats = await self._eval_stats(
            organization_id=organization_id,
            deployment_id=deployment_id,
            start_time=start_time,
        )
        score_stats = await self._score_stats(
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            start_time=start_time,
        )
        drift_score = self._compute_drift_score(
            feedback_stats=feedback_stats,
            eval_stats=eval_stats,
            score_stats=score_stats,
        )
        get_metrics().set_agent_quality_drift_score(
            organization_id=organization_id,
            role_scope=role_id or "all",
            score=drift_score,
        )

        recommendations = self._build_recommendations(
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            feedback_stats=feedback_stats,
            eval_stats=eval_stats,
            score_stats=score_stats,
        )
        if recommendations:
            await self._persist_recommendations(recommendations)
        return recommendations

    @staticmethod
    def _compute_drift_score(
        *,
        feedback_stats: dict[str, float],
        eval_stats: dict[str, float],
        score_stats: dict[str, float],
    ) -> float:
        rejection_pressure = (
            float(feedback_stats.get("rejection_rate", 0.0)) / 0.2
            if feedback_stats.get("total_feedback", 0.0) >= 5
            else 0.0
        )
        eval_pressure = (
            float(eval_stats.get("eval_fail_rate", 0.0)) / 0.25
            if eval_stats.get("eval_count", 0.0) >= 5
            else 0.0
        )
        low_quality_pressure = (
            float(score_stats.get("low_quality_rate", 0.0)) / 0.3
            if score_stats.get("run_count", 0.0) >= 5
            else 0.0
        )
        quality_floor = 1.0 - float(score_stats.get("avg_quality_score", 0.0))
        return max(min(max(rejection_pressure, eval_pressure, low_quality_pressure, quality_floor), 1.0), 0.0)

    async def list_recommendations(
        self,
        *,
        organization_id: str,
        role_id: str | None = None,
        deployment_id: str | None = None,
        status: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[QualityRecommendationRecord]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, role_id, deployment_id, recommendation_type, priority, status,
                           summary, details, source_signals, created_at, updated_at, resolved_at
                    FROM agent_quality_recommendation
                    WHERE organization_id = :organization_id
                      AND (:role_id IS NULL OR role_id = :role_id)
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                      AND (:status IS NULL OR status = :status)
                    ORDER BY created_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "role_id": role_id,
                    "deployment_id": deployment_id,
                    "status": status,
                    "limit": limit,
                    "offset": offset,
                },
            )
            rows = result.fetchall()
        return [
            QualityRecommendationRecord.model_validate(
                _row_dict(row, json_fields={"details", "source_signals"})
            )
            for row in rows
        ]

    async def _persist_recommendations(self, recommendations: list[QualityRecommendationRecord]) -> None:
        async with get_db_session() as session:
            for recommendation in recommendations:
                existing = await session.execute(
                    text(
                        """
                        SELECT id
                        FROM agent_quality_recommendation
                        WHERE organization_id = :organization_id
                          AND recommendation_type = :recommendation_type
                          AND COALESCE(role_id, '') = COALESCE(:role_id, '')
                          AND COALESCE(deployment_id, '') = COALESCE(:deployment_id, '')
                          AND status = 'open'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """
                    ),
                    {
                        "organization_id": recommendation.organization_id,
                        "recommendation_type": recommendation.recommendation_type,
                        "role_id": recommendation.role_id,
                        "deployment_id": recommendation.deployment_id,
                    },
                )
                if existing.fetchone() is not None:
                    continue

                await session.execute(
                    text(
                        """
                        INSERT INTO agent_quality_recommendation (
                            id,
                            organization_id,
                            role_id,
                            deployment_id,
                            recommendation_type,
                            priority,
                            status,
                            summary,
                            details,
                            source_signals,
                            created_at,
                            updated_at,
                            resolved_at
                        ) VALUES (
                            :id,
                            :organization_id,
                            :role_id,
                            :deployment_id,
                            :recommendation_type,
                            :priority,
                            :status,
                            :summary,
                            CAST(:details AS JSONB),
                            CAST(:source_signals AS JSONB),
                            :created_at,
                            :updated_at,
                            :resolved_at
                        )
                        """
                    ),
                    {
                        "id": recommendation.id,
                        "organization_id": recommendation.organization_id,
                        "role_id": recommendation.role_id,
                        "deployment_id": recommendation.deployment_id,
                        "recommendation_type": recommendation.recommendation_type,
                        "priority": recommendation.priority,
                        "status": recommendation.status,
                        "summary": recommendation.summary,
                        "details": json_dumps_canonical(recommendation.details),
                        "source_signals": json_dumps_canonical(recommendation.source_signals),
                        "created_at": recommendation.created_at,
                        "updated_at": recommendation.updated_at,
                        "resolved_at": recommendation.resolved_at,
                    },
                )
            await session.commit()

    async def _feedback_stats(
        self,
        *,
        organization_id: str,
        deployment_id: str | None,
        start_time: Any,
    ) -> dict[str, float]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS total_count,
                           COUNT(*) FILTER (WHERE verdict = 'accepted') AS accepted_count,
                           COUNT(*) FILTER (WHERE verdict = 'edited') AS edited_count,
                           COUNT(*) FILTER (WHERE verdict = 'rejected') AS rejected_count
                    FROM agent_feedback
                    WHERE organization_id = :organization_id
                      AND created_at >= :start_time
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "start_time": start_time,
                },
            )
            row = result.fetchone()

        total = float(row.total_count or 0.0)
        accepted = float(row.accepted_count or 0.0)
        edited = float(row.edited_count or 0.0)
        rejected = float(row.rejected_count or 0.0)
        return {
            "total_feedback": total,
            "acceptance_rate": (accepted / total) if total else 0.0,
            "edited_rate": (edited / total) if total else 0.0,
            "rejection_rate": (rejected / total) if total else 0.0,
        }

    async def _eval_stats(
        self,
        *,
        organization_id: str,
        deployment_id: str | None,
        start_time: Any,
    ) -> dict[str, float]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS total_count,
                           COUNT(*) FILTER (WHERE passed = false) AS failed_count
                    FROM agent_eval_result
                    WHERE organization_id = :organization_id
                      AND evaluated_at >= :start_time
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "start_time": start_time,
                },
            )
            row = result.fetchone()

        total = float(row.total_count or 0.0)
        failed = float(row.failed_count or 0.0)
        return {
            "eval_count": total,
            "eval_fail_rate": (failed / total) if total else 0.0,
        }

    async def _score_stats(
        self,
        *,
        organization_id: str,
        role_id: str | None,
        deployment_id: str | None,
        start_time: Any,
    ) -> dict[str, float]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS total_count,
                           COUNT(*) FILTER (WHERE quality_score < 0.6) AS low_quality_count,
                           AVG(quality_score) AS avg_quality_score,
                           AVG(COALESCE((score_breakdown ->> 'evidence_coverage')::float, 0.0)) AS avg_evidence_coverage
                    FROM agent_run_quality_score
                    WHERE organization_id = :organization_id
                      AND evaluated_at >= :start_time
                      AND (:role_id IS NULL OR role_id = :role_id)
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    """
                ),
                {
                    "organization_id": organization_id,
                    "role_id": role_id,
                    "deployment_id": deployment_id,
                    "start_time": start_time,
                },
            )
            row = result.fetchone()
        total = float(row.total_count or 0.0)
        low_quality = float(row.low_quality_count or 0.0)
        return {
            "run_count": total,
            "low_quality_rate": (low_quality / total) if total else 0.0,
            "avg_quality_score": float(row.avg_quality_score) if row.avg_quality_score is not None else 0.0,
            "avg_evidence_coverage": (
                float(row.avg_evidence_coverage) if row.avg_evidence_coverage is not None else 0.0
            ),
        }

    def _build_recommendations(
        self,
        *,
        organization_id: str,
        role_id: str | None,
        deployment_id: str | None,
        feedback_stats: dict[str, float],
        eval_stats: dict[str, float],
        score_stats: dict[str, float],
    ) -> list[QualityRecommendationRecord]:
        now = utc_now()
        recommendations: list[QualityRecommendationRecord] = []

        if feedback_stats["rejection_rate"] >= 0.2:
            recommendations.append(
                self._new_recommendation(
                    organization_id=organization_id,
                    role_id=role_id,
                    deployment_id=deployment_id,
                    recommendation_type="prompt_refinement",
                    priority="high",
                    summary="High rejection rate detected. Tighten output prompt constraints.",
                    details={
                        "action": "Review role prompt for tone, structure, and approval-sensitive language.",
                        "target_rejection_rate": "< 10%",
                    },
                    source_signals={"feedback": feedback_stats},
                    created_at=now,
                )
            )

        if score_stats["avg_evidence_coverage"] < 0.65 and score_stats["run_count"] >= 5:
            recommendations.append(
                self._new_recommendation(
                    organization_id=organization_id,
                    role_id=role_id,
                    deployment_id=deployment_id,
                    recommendation_type="evidence_policy_tightening",
                    priority="medium",
                    summary="Evidence coverage is below target. Increase citation requirements before send.",
                    details={
                        "action": "Require minimum evidence references for high-stakes work products.",
                        "target_evidence_coverage": ">= 0.75",
                    },
                    source_signals={"scores": score_stats},
                    created_at=now,
                )
            )

        if eval_stats["eval_fail_rate"] >= 0.25 and eval_stats["eval_count"] >= 8:
            recommendations.append(
                self._new_recommendation(
                    organization_id=organization_id,
                    role_id=role_id,
                    deployment_id=deployment_id,
                    recommendation_type="eval_drift_mitigation",
                    priority="critical",
                    summary="Offline eval drift detected. Freeze promotion and run remediation suite.",
                    details={
                        "action": "Run offline eval remediation and update playbook constraints.",
                        "target_eval_fail_rate": "< 15%",
                    },
                    source_signals={"evals": eval_stats},
                    created_at=now,
                )
            )

        if score_stats["low_quality_rate"] >= 0.3 and score_stats["run_count"] >= 10:
            recommendations.append(
                self._new_recommendation(
                    organization_id=organization_id,
                    role_id=role_id,
                    deployment_id=deployment_id,
                    recommendation_type="policy_tooling_review",
                    priority="high",
                    summary="Run quality is unstable. Review tool policy and fallback behavior.",
                    details={
                        "action": "Audit denied/failed tool calls and adjust policy overlays.",
                        "target_low_quality_rate": "< 20%",
                    },
                    source_signals={"scores": score_stats},
                    created_at=now,
                )
            )

        return recommendations

    @staticmethod
    def _new_recommendation(
        *,
        organization_id: str,
        role_id: str | None,
        deployment_id: str | None,
        recommendation_type: str,
        priority: str,
        summary: str,
        details: dict[str, Any],
        source_signals: dict[str, Any],
        created_at: Any,
    ) -> QualityRecommendationRecord:
        return QualityRecommendationRecord(
            id=new_prefixed_id("agrec"),
            organization_id=organization_id,
            role_id=role_id,
            deployment_id=deployment_id,
            recommendation_type=recommendation_type,
            priority=priority,  # type: ignore[arg-type]
            status="open",
            summary=summary,
            details=details,
            source_signals=source_signals,
            created_at=created_at,
            updated_at=created_at,
            resolved_at=None,
        )


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


def _avg_or_zero(values: list[float]) -> float:
    if not values:
        return 0.0
    return mean(values)
