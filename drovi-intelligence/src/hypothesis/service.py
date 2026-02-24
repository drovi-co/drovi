"""Hypothesis persistence, scoring, and worker-facing orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import math
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.events.publisher import get_event_publisher
from src.hypothesis.engine import HypothesisCandidate, HypothesisEngine


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_text(value: Any, fallback: str = "") -> str:
    text = str(value or fallback).strip()
    return text or fallback


@dataclass(slots=True)
class HypothesisScoreBreakdown:
    evidence_fit: float
    consistency: float
    prior_probability: float
    posterior_probability: float
    novelty: float
    model_confidence: float
    overall_score: float

    def to_dict(self) -> dict[str, float]:
        return {
            "evidence_fit": round(self.evidence_fit, 4),
            "consistency": round(self.consistency, 4),
            "prior_probability": round(self.prior_probability, 4),
            "posterior_probability": round(self.posterior_probability, 4),
            "novelty": round(self.novelty, 4),
            "model_confidence": round(self.model_confidence, 4),
            "overall_score": round(self.overall_score, 4),
        }


class HypothesisService:
    """Generates, scores, and persists hypothesis alternatives."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._engine = HypothesisEngine()

    async def generate_for_belief(
        self,
        *,
        belief_id: str,
        top_k: int = 3,
        min_score: float = 0.5,
        trigger: str = "belief_update",
        model_version: str = "hypothesis-v1",
        force_credible: bool = False,
        contradiction_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        belief = await self._get_belief_row(belief_id)
        if not belief:
            raise ValueError(f"Belief not found: {belief_id}")

        proposition = _normalize_text(belief["proposition"], fallback=f"belief:{belief_id}")
        base_probability = _as_float(belief.get("probability"), 0.5)
        observations = await self._collect_observations_for_belief(
            belief_id=belief_id,
            derived_observation_id=belief.get("derived_from_observation_id"),
            limit=max(12, int(top_k) * 4),
        )

        candidates = self._engine.generate_alternatives(
            belief_id=belief_id,
            proposition=proposition,
            observations=observations,
            base_probability=base_probability,
            max_candidates=max(4, int(top_k) * 3),
        )

        scored = self._score_candidates(
            candidates,
            base_probability=base_probability,
            contradiction_weight=self._contradiction_weight(contradiction_context),
        )

        accepted, rejected = self._partition_candidates(
            scored,
            min_score=min_score,
            top_k=top_k,
            force_credible=force_credible,
            contradiction_context=contradiction_context,
        )

        persisted = await self._persist_candidates(
            belief_id=belief_id,
            accepted=accepted,
            rejected=rejected,
            trigger=trigger,
            model_version=model_version,
            context={
                "belief_id": belief_id,
                "proposition": proposition,
                "contradiction": contradiction_context or {},
            },
        )

        return {
            "organization_id": self.organization_id,
            "belief_id": belief_id,
            "trigger": trigger,
            "generated": len(accepted) + len(rejected),
            "accepted": len(accepted),
            "rejected": len(rejected),
            "accepted_items": [item for item in persisted if item["status"] == "accepted"],
            "rejected_items": [item for item in persisted if item["status"] == "rejected"],
        }

    async def generate_for_anomaly(
        self,
        *,
        anomaly_ref: str,
        anomaly_summary: str,
        impact_score: float,
        observations: list[str],
        top_k: int = 3,
        min_score: float = 0.5,
        trigger: str = "anomaly",
        model_version: str = "hypothesis-v1",
        contradiction_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        proposition = _normalize_text(anomaly_summary, fallback=f"anomaly:{anomaly_ref}")
        pseudo_belief_id = f"anomaly::{anomaly_ref}"
        base_probability = _clamp(0.2 + (_clamp(impact_score, 0.0, 1.0) * 0.6), 0.05, 0.95)

        normalized_observations = [item.strip() for item in observations if item and item.strip()]
        if not normalized_observations:
            normalized_observations = [proposition]

        candidates = self._engine.generate_alternatives(
            belief_id=pseudo_belief_id,
            proposition=proposition,
            observations=normalized_observations,
            base_probability=base_probability,
            max_candidates=max(4, int(top_k) * 3),
        )
        scored = self._score_candidates(
            candidates,
            base_probability=base_probability,
            contradiction_weight=self._contradiction_weight(contradiction_context),
        )
        accepted, rejected = self._partition_candidates(
            scored,
            min_score=min_score,
            top_k=top_k,
            force_credible=bool(contradiction_context),
            contradiction_context=contradiction_context,
        )

        persisted = await self._persist_candidates(
            belief_id=None,
            accepted=accepted,
            rejected=rejected,
            trigger=trigger,
            model_version=model_version,
            context={
                "anomaly_ref": anomaly_ref,
                "anomaly_summary": proposition,
                "impact_score": _clamp(impact_score, 0.0, 1.0),
                "contradiction": contradiction_context or {},
            },
        )

        return {
            "organization_id": self.organization_id,
            "anomaly_ref": anomaly_ref,
            "trigger": trigger,
            "generated": len(accepted) + len(rejected),
            "accepted": len(accepted),
            "rejected": len(rejected),
            "accepted_items": [item for item in persisted if item["status"] == "accepted"],
            "rejected_items": [item for item in persisted if item["status"] == "rejected"],
        }

    async def generate_for_contradiction(
        self,
        *,
        contradiction_id: str,
        contradiction_type: str,
        severity: str,
        uio_a_id: str | None = None,
        uio_b_id: str | None = None,
        evidence_quote: str | None = None,
        top_k: int = 3,
        min_score: float = 0.5,
        model_version: str = "hypothesis-v1",
    ) -> dict[str, Any]:
        severity_normalized = str(severity or "medium").strip().lower()
        impact_score = {
            "critical": 0.95,
            "high": 0.85,
            "medium": 0.65,
            "low": 0.45,
        }.get(severity_normalized, 0.55)

        summary_parts = [
            f"Contradiction detected ({contradiction_type})",
            f"between {uio_a_id}" if uio_a_id else "",
            f"and {uio_b_id}" if uio_b_id else "",
        ]
        summary = " ".join(part for part in summary_parts if part).strip()
        observations = [
            f"contradiction:{contradiction_id}",
            f"type:{contradiction_type}",
            f"severity:{severity_normalized}",
        ]
        if evidence_quote:
            observations.append(evidence_quote[:600])

        return await self.generate_for_anomaly(
            anomaly_ref=f"contradiction:{contradiction_id}",
            anomaly_summary=summary,
            impact_score=impact_score,
            observations=observations,
            top_k=top_k,
            min_score=min_score,
            trigger="contradiction",
            model_version=model_version,
            contradiction_context={
                "id": contradiction_id,
                "type": contradiction_type,
                "severity": severity_normalized,
                "uio_a_id": uio_a_id,
                "uio_b_id": uio_b_id,
            },
        )

    async def rescore_hypotheses(
        self,
        *,
        belief_id: str | None = None,
        hypothesis_ids: list[str] | None = None,
        evidence_signals: list[dict[str, Any]] | None = None,
        model_version: str = "hypothesis-v1-rescore",
        rejection_threshold: float = 0.45,
    ) -> dict[str, Any]:
        signals = list(evidence_signals or [])
        support = sum(_as_float(item.get("strength"), 0.0) for item in signals if str(item.get("direction") or "support") == "support")
        contradict = sum(
            _as_float(item.get("strength"), 0.0)
            for item in signals
            if str(item.get("direction") or "support") == "contradict"
        )
        net_signal = support - contradict

        rows = await self._load_hypotheses_for_rescore(
            belief_id=belief_id,
            hypothesis_ids=hypothesis_ids,
        )

        updated = 0
        rejected = 0
        results: list[dict[str, Any]] = []

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                for row in rows:
                    prior = _clamp(_as_float(row.prior_probability, 0.5), 0.01, 0.99)
                    posterior_before = _clamp(_as_float(row.posterior_probability, 0.5), 0.01, 0.99)
                    posterior_after = _clamp(posterior_before + (0.2 * math.tanh(net_signal)), 0.01, 0.99)

                    evidence_fit = _clamp(0.5 + (0.25 * math.tanh(abs(net_signal))), 0.0, 1.0)
                    consistency = _clamp(1.0 - abs(posterior_after - prior), 0.0, 1.0)
                    novelty = _clamp(_as_float(row.novelty_score, 0.6), 0.0, 1.0)
                    confidence = _clamp(_as_float(row.model_confidence, 0.5), 0.0, 1.0)
                    breakdown = self._build_score_breakdown(
                        evidence_fit=evidence_fit,
                        consistency=consistency,
                        prior_probability=prior,
                        posterior_probability=posterior_after,
                        novelty=novelty,
                        model_confidence=confidence,
                    )

                    status = str(row.status or "accepted")
                    next_status = status
                    if breakdown.overall_score < rejection_threshold:
                        next_status = "rejected"

                    await session.execute(
                        text(
                            """
                            UPDATE hypothesis
                            SET posterior_probability = :posterior_probability,
                                status = :status,
                                updated_at = :updated_at
                            WHERE organization_id = :org_id
                              AND id = :hypothesis_id
                            """
                        ),
                        {
                            "posterior_probability": posterior_after,
                            "status": next_status,
                            "updated_at": datetime.now(UTC),
                            "org_id": self.organization_id,
                            "hypothesis_id": row.id,
                        },
                    )

                    await self._insert_score_rows(
                        session=session,
                        hypothesis_id=str(row.id),
                        breakdown=breakdown,
                        model_version=model_version,
                        overall_score_type="overall_score_rescore",
                        metadata={
                            "rescore": True,
                            "signal_summary": {
                                "support": round(support, 4),
                                "contradict": round(contradict, 4),
                                "net": round(net_signal, 4),
                            },
                        },
                        scored_at=datetime.now(UTC),
                    )

                    updated += 1
                    if status != "rejected" and next_status == "rejected":
                        rejected += 1
                        await self._publish_rejected_event(
                            hypothesis_id=str(row.id),
                            confidence=breakdown.overall_score,
                            model_version=model_version,
                        )

                    results.append(
                        {
                            "hypothesis_id": str(row.id),
                            "status_before": status,
                            "status_after": next_status,
                            "posterior_before": round(posterior_before, 4),
                            "posterior_after": round(posterior_after, 4),
                            "overall_score": round(breakdown.overall_score, 4),
                        }
                    )
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "organization_id": self.organization_id,
            "updated": updated,
            "rejected": rejected,
            "results": results,
        }

    async def list_hypotheses(
        self,
        *,
        status: str | None,
        belief_id: str | None,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        conditions = ["h.organization_id = :org_id"]
        params: dict[str, Any] = {
            "org_id": self.organization_id,
            "limit": limit,
            "offset": offset,
        }
        if status:
            conditions.append("h.status = :status")
            params["status"] = status.strip().lower()
        if belief_id:
            conditions.append("h.related_belief_id = :belief_id")
            params["belief_id"] = belief_id

        where_clause = " AND ".join(conditions)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT h.id, h.hypothesis_text, h.status,
                                   h.prior_probability, h.posterior_probability,
                                   h.related_belief_id, h.created_at, h.updated_at,
                                   score.score_value AS overall_score,
                                   score.model_version,
                                   score.metadata AS score_metadata,
                                   score.scored_at
                            FROM hypothesis h
                            LEFT JOIN LATERAL (
                                SELECT hs.score_value, hs.model_version, hs.metadata, hs.scored_at
                                FROM hypothesis_score hs
                                WHERE hs.organization_id = h.organization_id
                                  AND hs.hypothesis_id = h.id
                                  AND hs.score_type IN ('overall_score', 'overall_score_rescore')
                                ORDER BY hs.scored_at DESC
                                LIMIT 1
                            ) score ON TRUE
                            WHERE {where_clause}
                            ORDER BY COALESCE(score.score_value, 0) DESC, h.updated_at DESC
                            LIMIT :limit OFFSET :offset
                            """
                        ),
                        params,
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return [
            {
                "id": row.id,
                "hypothesis_text": row.hypothesis_text,
                "status": row.status,
                "prior_probability": float(row.prior_probability),
                "posterior_probability": float(row.posterior_probability),
                "related_belief_id": row.related_belief_id,
                "overall_score": float(row.overall_score) if row.overall_score is not None else None,
                "model_version": row.model_version,
                "score_metadata": row.score_metadata,
                "scored_at": row.scored_at.isoformat() if row.scored_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ]

    async def get_hypothesis(self, hypothesis_id: str) -> dict[str, Any] | None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                hypothesis = (
                    await session.execute(
                        text(
                            """
                            SELECT id, hypothesis_text, status,
                                   prior_probability, posterior_probability,
                                   related_belief_id, created_at, updated_at
                            FROM hypothesis
                            WHERE organization_id = :org_id
                              AND id = :hypothesis_id
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "hypothesis_id": hypothesis_id,
                        },
                    )
                ).fetchone()
                if not hypothesis:
                    return None

                scores = (
                    await session.execute(
                        text(
                            """
                            SELECT score_type, score_value, model_version, metadata, scored_at
                            FROM hypothesis_score
                            WHERE organization_id = :org_id
                              AND hypothesis_id = :hypothesis_id
                            ORDER BY scored_at DESC
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "hypothesis_id": hypothesis_id,
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "id": hypothesis.id,
            "hypothesis_text": hypothesis.hypothesis_text,
            "status": hypothesis.status,
            "prior_probability": float(hypothesis.prior_probability),
            "posterior_probability": float(hypothesis.posterior_probability),
            "related_belief_id": hypothesis.related_belief_id,
            "created_at": hypothesis.created_at.isoformat() if hypothesis.created_at else None,
            "updated_at": hypothesis.updated_at.isoformat() if hypothesis.updated_at else None,
            "scores": [
                {
                    "score_type": row.score_type,
                    "score_value": float(row.score_value),
                    "model_version": row.model_version,
                    "metadata": row.metadata,
                    "scored_at": row.scored_at.isoformat() if row.scored_at else None,
                }
                for row in scores
            ],
        }

    async def _get_belief_row(self, belief_id: str) -> dict[str, Any] | None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                row = (
                    await session.execute(
                        text(
                            """
                            SELECT id, proposition, probability, belief_state,
                                   derived_from_observation_id
                            FROM belief
                            WHERE organization_id = :org_id
                              AND id = :belief_id
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "belief_id": belief_id,
                        },
                    )
                ).fetchone()
        finally:
            set_rls_context(None, is_internal=False)

        if not row:
            return None
        return {
            "id": row.id,
            "proposition": row.proposition,
            "probability": float(row.probability),
            "belief_state": row.belief_state,
            "derived_from_observation_id": row.derived_from_observation_id,
        }

    async def _collect_observations_for_belief(
        self,
        *,
        belief_id: str,
        derived_observation_id: str | None,
        limit: int,
    ) -> list[str]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT title, content
                            FROM observation
                            WHERE organization_id = :org_id
                              AND (
                                  id = :derived_observation_id
                                  OR :derived_observation_id IS NULL
                                  OR observed_at >= (NOW() - interval '90 days')
                              )
                            ORDER BY (CASE WHEN id = :derived_observation_id THEN 0 ELSE 1 END), observed_at DESC
                            LIMIT :limit
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "derived_observation_id": derived_observation_id,
                            "limit": max(5, int(limit)),
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        observations: list[str] = []
        for row in rows:
            title = _normalize_text(row.title)
            content = row.content if isinstance(row.content, dict) else {}
            detail = _normalize_text(content.get("summary") or content.get("content") or content.get("text"))
            combined = " ".join(item for item in [title, detail] if item)
            if combined:
                observations.append(combined[:600])

        if not observations:
            observations.append(f"belief_context:{belief_id}")

        return observations

    def _score_candidates(
        self,
        candidates: list[HypothesisCandidate],
        *,
        base_probability: float,
        contradiction_weight: float,
    ) -> list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]]:
        scored: list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]] = []
        for candidate in candidates:
            consistency = _clamp(1.0 - abs(candidate.posterior_probability - base_probability), 0.0, 1.0)
            evidence_fit = _clamp(candidate.evidence_fit + contradiction_weight, 0.0, 1.0)
            breakdown = self._build_score_breakdown(
                evidence_fit=evidence_fit,
                consistency=consistency,
                prior_probability=_clamp(candidate.prior_probability, 0.0, 1.0),
                posterior_probability=_clamp(candidate.posterior_probability, 0.0, 1.0),
                novelty=_clamp(candidate.novelty, 0.0, 1.0),
                model_confidence=_clamp(candidate.confidence, 0.0, 1.0),
            )
            scored.append((candidate, breakdown))

        scored.sort(key=lambda item: item[1].overall_score, reverse=True)
        return scored

    @staticmethod
    def _build_score_breakdown(
        *,
        evidence_fit: float,
        consistency: float,
        prior_probability: float,
        posterior_probability: float,
        novelty: float,
        model_confidence: float,
    ) -> HypothesisScoreBreakdown:
        overall = _clamp(
            (0.40 * evidence_fit)
            + (0.25 * consistency)
            + (0.20 * prior_probability)
            + (0.10 * posterior_probability)
            + (0.03 * novelty)
            + (0.02 * model_confidence),
            0.0,
            1.0,
        )
        return HypothesisScoreBreakdown(
            evidence_fit=evidence_fit,
            consistency=consistency,
            prior_probability=prior_probability,
            posterior_probability=posterior_probability,
            novelty=novelty,
            model_confidence=model_confidence,
            overall_score=overall,
        )

    def _partition_candidates(
        self,
        scored: list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]],
        *,
        min_score: float,
        top_k: int,
        force_credible: bool,
        contradiction_context: dict[str, Any] | None,
    ) -> tuple[list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]], list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]]]:
        threshold = _clamp(min_score, 0.0, 1.0)
        accepted: list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]] = []
        rejected: list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]] = []

        for candidate, breakdown in scored:
            if len(accepted) < max(1, top_k) and breakdown.overall_score >= threshold:
                accepted.append((candidate, breakdown))
            else:
                rejected.append((candidate, breakdown))

        has_major_contradiction = bool(
            contradiction_context
            and str(contradiction_context.get("severity") or "").lower() in {"high", "critical"}
        )
        if force_credible or has_major_contradiction:
            if not accepted and scored:
                accepted.append(scored[0])
                rejected = [item for item in scored[1:]]

        return accepted, rejected

    @staticmethod
    def _contradiction_weight(contradiction_context: dict[str, Any] | None) -> float:
        if not contradiction_context:
            return 0.0
        severity = str(contradiction_context.get("severity") or "").lower()
        if severity == "critical":
            return 0.2
        if severity == "high":
            return 0.15
        if severity == "medium":
            return 0.08
        return 0.03

    async def _persist_candidates(
        self,
        *,
        belief_id: str | None,
        accepted: list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]],
        rejected: list[tuple[HypothesisCandidate, HypothesisScoreBreakdown]],
        trigger: str,
        model_version: str,
        context: dict[str, Any],
    ) -> list[dict[str, Any]]:
        now = datetime.now(UTC)
        persisted: list[dict[str, Any]] = []

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                for status, items in (("accepted", accepted), ("rejected", rejected)):
                    for candidate, breakdown in items:
                        hypothesis_id = str(uuid4())
                        hypothesis_hash = hashlib.sha256(
                            f"{self.organization_id}:{candidate.hypothesis_text}:{candidate.belief_id}".encode("utf-8")
                        ).hexdigest()

                        await session.execute(
                            text(
                                """
                                INSERT INTO hypothesis (
                                    id,
                                    organization_id,
                                    hypothesis_text,
                                    status,
                                    prior_probability,
                                    posterior_probability,
                                    hypothesis_hash,
                                    related_belief_id,
                                    created_at,
                                    updated_at
                                ) VALUES (
                                    :id,
                                    :org_id,
                                    :hypothesis_text,
                                    :status,
                                    :prior_probability,
                                    :posterior_probability,
                                    :hypothesis_hash,
                                    :related_belief_id,
                                    :created_at,
                                    :updated_at
                                )
                                """
                            ),
                            {
                                "id": hypothesis_id,
                                "org_id": self.organization_id,
                                "hypothesis_text": candidate.hypothesis_text,
                                "status": status,
                                "prior_probability": candidate.prior_probability,
                                "posterior_probability": candidate.posterior_probability,
                                "hypothesis_hash": hypothesis_hash,
                                "related_belief_id": belief_id,
                                "created_at": now,
                                "updated_at": now,
                            },
                        )

                        await self._insert_score_rows(
                            session=session,
                            hypothesis_id=hypothesis_id,
                            breakdown=breakdown,
                            model_version=model_version,
                            metadata={
                                "trigger": trigger,
                                "context": context,
                                "status": status,
                                "candidate_tags": list(candidate.tags),
                            },
                            scored_at=now,
                        )

                        persisted_item = {
                            "id": hypothesis_id,
                            "status": status,
                            "hypothesis_text": candidate.hypothesis_text,
                            "related_belief_id": belief_id,
                            "scores": breakdown.to_dict(),
                            "model_version": model_version,
                            "trigger": trigger,
                        }
                        persisted.append(persisted_item)

                        if status == "accepted":
                            await self._publish_generated_event(
                                hypothesis_id=hypothesis_id,
                                belief_id=belief_id,
                                candidate=candidate,
                                model_version=model_version,
                                occurred_at=now,
                            )
                        else:
                            await self._publish_rejected_event(
                                hypothesis_id=hypothesis_id,
                                confidence=breakdown.overall_score,
                                model_version=model_version,
                                occurred_at=now,
                            )
        finally:
            set_rls_context(None, is_internal=False)

        return persisted

    async def _insert_score_rows(
        self,
        *,
        session,
        hypothesis_id: str,
        breakdown: HypothesisScoreBreakdown,
        model_version: str,
        overall_score_type: str = "overall_score",
        metadata: dict[str, Any],
        scored_at: datetime,
    ) -> None:
        score_rows = [
            ("evidence_fit", breakdown.evidence_fit),
            ("consistency", breakdown.consistency),
            ("prior_probability", breakdown.prior_probability),
            ("posterior_probability", breakdown.posterior_probability),
            ("novelty", breakdown.novelty),
            ("model_confidence", breakdown.model_confidence),
            (overall_score_type, breakdown.overall_score),
        ]

        for score_type, score_value in score_rows:
            await session.execute(
                text(
                    """
                    INSERT INTO hypothesis_score (
                        id,
                        organization_id,
                        hypothesis_id,
                        score_type,
                        score_value,
                        model_version,
                        metadata,
                        scored_at
                    ) VALUES (
                        :id,
                        :org_id,
                        :hypothesis_id,
                        :score_type,
                        :score_value,
                        :model_version,
                        :metadata,
                        :scored_at
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "org_id": self.organization_id,
                    "hypothesis_id": hypothesis_id,
                    "score_type": score_type,
                    "score_value": score_value,
                    "model_version": model_version,
                    "metadata": metadata,
                    "scored_at": scored_at,
                },
            )

    async def _load_hypotheses_for_rescore(
        self,
        *,
        belief_id: str | None,
        hypothesis_ids: list[str] | None,
    ) -> list[Any]:
        conditions = ["organization_id = :org_id"]
        params: dict[str, Any] = {
            "org_id": self.organization_id,
        }
        if belief_id:
            conditions.append("related_belief_id = :belief_id")
            params["belief_id"] = belief_id
        if hypothesis_ids:
            conditions.append("id = ANY(:hypothesis_ids)")
            params["hypothesis_ids"] = list(hypothesis_ids)

        where_clause = " AND ".join(conditions)
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT id, status, prior_probability, posterior_probability,
                                   0.6 AS novelty_score,
                                   0.5 AS model_confidence
                            FROM hypothesis
                            WHERE {where_clause}
                            ORDER BY updated_at DESC
                            LIMIT 1000
                            """
                        ),
                        params,
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return rows

    async def _publish_generated_event(
        self,
        *,
        hypothesis_id: str,
        belief_id: str | None,
        candidate: HypothesisCandidate,
        model_version: str,
        occurred_at: datetime | None = None,
    ) -> None:
        publisher = await get_event_publisher()
        now = occurred_at or datetime.now(UTC)
        await publisher.publish_world_brain_contract_event(
            {
                "schema_version": "1.0",
                "organization_id": self.organization_id,
                "event_id": str(uuid4()),
                "occurred_at": now,
                "producer": "drovi-intelligence",
                "event_type": "hypothesis.generated.v1",
                "payload": {
                    "hypothesis_id": hypothesis_id,
                    "belief_id": belief_id,
                    "hypothesis_text": candidate.hypothesis_text,
                    "prior_probability": _clamp(candidate.prior_probability, 0.0, 1.0),
                    "posterior_probability": _clamp(candidate.posterior_probability, 0.0, 1.0),
                    "generated_at": now,
                    "model_version": model_version,
                },
            }
        )

    async def _publish_rejected_event(
        self,
        *,
        hypothesis_id: str,
        confidence: float,
        model_version: str,
        occurred_at: datetime | None = None,
    ) -> None:
        publisher = await get_event_publisher()
        now = occurred_at or datetime.now(UTC)
        await publisher.publish_world_brain_contract_event(
            {
                "schema_version": "1.0",
                "organization_id": self.organization_id,
                "event_id": str(uuid4()),
                "occurred_at": now,
                "producer": "drovi-intelligence",
                "event_type": "hypothesis.rejected.v1",
                "payload": {
                    "hypothesis_id": hypothesis_id,
                    "rejection_reason": "score_below_threshold",
                    "rejected_at": now,
                    "disproving_observation_ids": [],
                    "confidence": _clamp(confidence, 0.0, 1.0),
                },
            }
        )


_services: dict[str, HypothesisService] = {}


async def get_hypothesis_service(organization_id: str) -> HypothesisService:
    if organization_id not in _services:
        _services[organization_id] = HypothesisService(organization_id=organization_id)
    return _services[organization_id]
