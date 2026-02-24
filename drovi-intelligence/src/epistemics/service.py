"""Belief intelligence service for revision, replay, and epistemic queries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import json
import math
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.epistemics.engine import BeliefState, EpistemicEngine, EvidenceSignal
from src.epistemics.state_machine import EpistemicStateMachine
from src.security.cognitive_payload_crypto import decode_reason_payload, encode_reason_payload


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _bucket_for_probability(value: float) -> str:
    probability = _clamp(value, 0.0, 1.0)
    lower = math.floor(probability * 10) / 10
    upper = min(1.0, lower + 0.1)
    return f"{lower:.1f}-{upper:.1f}"


def _signal_key(payload: dict[str, Any]) -> tuple[str, str, float, float]:
    return (
        str(payload.get("source_ref") or payload.get("source_key") or ""),
        str(payload.get("direction") or "support"),
        float(payload.get("strength") or 0.0),
        float(payload.get("freshness_hours") or 0.0),
    )


def _safe_json_loads(value: str | None) -> dict[str, Any]:
    return decode_reason_payload(value)


@dataclass(slots=True)
class BeliefRevisionResult:
    belief_id: str
    previous_state: str
    next_state: str
    previous_probability: float
    next_probability: float
    uncertainty: float
    calibration_bucket: str
    support_count_increment: int
    contradiction_count_increment: int
    revision_id: str
    revised_at: str
    reason: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "belief_id": self.belief_id,
            "previous_state": self.previous_state,
            "next_state": self.next_state,
            "previous_probability": round(self.previous_probability, 4),
            "next_probability": round(self.next_probability, 4),
            "uncertainty": round(self.uncertainty, 4),
            "calibration_bucket": self.calibration_bucket,
            "support_count_increment": self.support_count_increment,
            "contradiction_count_increment": self.contradiction_count_increment,
            "revision_id": self.revision_id,
            "revised_at": self.revised_at,
            "reason": dict(self.reason),
        }


class BeliefIntelligenceService:
    """Service for belief lifecycle operations and APIs."""

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self._engine = EpistemicEngine()
        self._state_machine = EpistemicStateMachine()

    async def revise_belief(
        self,
        *,
        belief_id: str,
        signals: list[dict[str, Any]],
        reason: str,
        model_version: str | None = None,
        contradiction_ids: list[str] | None = None,
    ) -> BeliefRevisionResult:
        ordered_signals = sorted((dict(item) for item in signals), key=_signal_key)
        contradiction_ids = list(contradiction_ids or [])

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                belief_row_result = await session.execute(
                    text(
                        """
                        SELECT id, proposition, belief_state, probability,
                               contradiction_count, supporting_evidence_count,
                               updated_at
                        FROM belief
                        WHERE organization_id = :org_id
                          AND id = :belief_id
                        """
                    ),
                    {"org_id": self.organization_id, "belief_id": belief_id},
                )
                belief_row = belief_row_result.fetchone()
                if not belief_row:
                    raise ValueError(f"Belief not found: {belief_id}")

                reliability_map = await self._load_source_reliability(session)

                previous_probability = _clamp(float(belief_row.probability or 0.5), 0.0, 1.0)
                decayed_probability = self.apply_confidence_decay(
                    probability=previous_probability,
                    last_updated_at=_as_utc(getattr(belief_row, "updated_at", None)),
                    contradiction_count=int(belief_row.contradiction_count or 0),
                )

                evidence_signals = self._build_evidence_signals(
                    ordered_signals,
                    reliability_map=reliability_map,
                )
                transition = self._engine.transition(
                    current_state=self._state_machine.coerce(belief_row.belief_state),
                    current_probability=decayed_probability,
                    signals=evidence_signals,
                    prior_uncertainty=self._derive_prior_uncertainty(evidence_signals),
                )

                support_increment = sum(1 for signal in evidence_signals if signal.direction.lower() == "support")
                contradiction_increment = sum(
                    1 for signal in evidence_signals if signal.direction.lower() == "contradict"
                ) + len(contradiction_ids)

                state_decision = self._state_machine.resolve(
                    current=transition.previous_state,
                    proposed=transition.next_state,
                    contradiction_hits=contradiction_increment,
                )
                next_state = state_decision.next_state
                next_probability = transition.next_probability
                if contradiction_increment > 0 and next_state in {BeliefState.ASSERTED, BeliefState.CORROBORATED}:
                    next_state = BeliefState.CONTESTED
                    next_probability = min(next_probability, 0.55)

                calibration_bucket = _bucket_for_probability(next_probability)
                now = datetime.now(UTC)
                revision_id = str(uuid4())

                evidence_link_ids = [
                    str(item.get("evidence_link_id"))
                    for item in ordered_signals
                    if item.get("evidence_link_id")
                ]

                signal_hash = hashlib.sha256(
                    json.dumps(ordered_signals, sort_keys=True, default=str).encode("utf-8")
                ).hexdigest()
                reason_payload = {
                    "reason": reason,
                    "model_version": model_version or "unspecified",
                    "signal_hash": signal_hash,
                    "state_decision": state_decision.reason,
                    "decayed_probability": round(decayed_probability, 6),
                    "support_increment": support_increment,
                    "contradiction_increment": contradiction_increment,
                }

                await session.execute(
                    text(
                        """
                        UPDATE belief
                        SET belief_state = :next_state,
                            probability = :next_probability,
                            calibration_bucket = :calibration_bucket,
                            supporting_evidence_count = COALESCE(supporting_evidence_count, 0) + :support_inc,
                            contradiction_count = COALESCE(contradiction_count, 0) + :contradict_inc,
                            believed_to = NULL,
                            updated_at = :updated_at
                        WHERE organization_id = :org_id
                          AND id = :belief_id
                        """
                    ),
                    {
                        "next_state": next_state.value,
                        "next_probability": next_probability,
                        "calibration_bucket": calibration_bucket,
                        "support_inc": support_increment,
                        "contradict_inc": contradiction_increment,
                        "updated_at": now,
                        "org_id": self.organization_id,
                        "belief_id": belief_id,
                    },
                )

                await session.execute(
                    text(
                        """
                        INSERT INTO belief_revision (
                            id,
                            organization_id,
                            belief_id,
                            previous_state,
                            next_state,
                            previous_probability,
                            next_probability,
                            reason,
                            evidence_link_ids,
                            revised_at,
                            created_at
                        ) VALUES (
                            :id,
                            :org_id,
                            :belief_id,
                            :previous_state,
                            :next_state,
                            :previous_probability,
                            :next_probability,
                            :reason,
                            :evidence_link_ids,
                            :revised_at,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": revision_id,
                        "org_id": self.organization_id,
                        "belief_id": belief_id,
                        "previous_state": transition.previous_state.value,
                        "next_state": next_state.value,
                        "previous_probability": transition.previous_probability,
                        "next_probability": next_probability,
                        "reason": encode_reason_payload(reason_payload),
                        "evidence_link_ids": evidence_link_ids,
                        "revised_at": now,
                        "created_at": now,
                    },
                )

                uncertainty_band = {
                    "p10": round(max(0.0, next_probability - transition.uncertainty), 4),
                    "p90": round(min(1.0, next_probability + transition.uncertainty), 4),
                }
                await session.execute(
                    text(
                        """
                        INSERT INTO uncertainty_state (
                            id,
                            organization_id,
                            object_ref,
                            object_type,
                            uncertainty_score,
                            uncertainty_band,
                            measured_at,
                            created_at
                        ) VALUES (
                            :id,
                            :org_id,
                            :object_ref,
                            :object_type,
                            :uncertainty_score,
                            :uncertainty_band,
                            :measured_at,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "org_id": self.organization_id,
                        "object_ref": belief_id,
                        "object_type": "belief",
                        "uncertainty_score": transition.uncertainty,
                        "uncertainty_band": uncertainty_band,
                        "measured_at": now,
                        "created_at": now,
                    },
                )
        finally:
            set_rls_context(None, is_internal=False)

        return BeliefRevisionResult(
            belief_id=belief_id,
            previous_state=transition.previous_state.value,
            next_state=next_state.value,
            previous_probability=transition.previous_probability,
            next_probability=next_probability,
            uncertainty=transition.uncertainty,
            calibration_bucket=calibration_bucket,
            support_count_increment=support_increment,
            contradiction_count_increment=contradiction_increment,
            revision_id=revision_id,
            revised_at=now.isoformat(),
            reason=reason_payload,
        )

    async def list_beliefs(
        self,
        *,
        belief_state: str | None,
        min_probability: float,
        max_probability: float,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        conditions: list[str] = ["b.organization_id = :org_id", "b.probability BETWEEN :min_prob AND :max_prob"]
        params: dict[str, Any] = {
            "org_id": self.organization_id,
            "min_prob": min_probability,
            "max_prob": max_probability,
            "limit": limit,
            "offset": offset,
        }
        if belief_state:
            conditions.append("b.belief_state = :belief_state")
            params["belief_state"] = belief_state.strip().lower()

        where_clause = " AND ".join(conditions)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT
                                b.id,
                                b.proposition,
                                b.belief_state,
                                b.probability,
                                b.calibration_bucket,
                                b.supporting_evidence_count,
                                b.contradiction_count,
                                b.created_at,
                                b.updated_at,
                                u.uncertainty_score,
                                u.uncertainty_band,
                                u.measured_at AS uncertainty_measured_at
                            FROM belief b
                            LEFT JOIN LATERAL (
                                SELECT uncertainty_score, uncertainty_band, measured_at
                                FROM uncertainty_state us
                                WHERE us.organization_id = b.organization_id
                                  AND us.object_ref = b.id
                                  AND us.object_type = 'belief'
                                ORDER BY us.measured_at DESC
                                LIMIT 1
                            ) u ON TRUE
                            WHERE {where_clause}
                            ORDER BY b.updated_at DESC
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
                "proposition": row.proposition,
                "belief_state": row.belief_state,
                "probability": float(row.probability),
                "calibration_bucket": row.calibration_bucket,
                "supporting_evidence_count": int(row.supporting_evidence_count or 0),
                "contradiction_count": int(row.contradiction_count or 0),
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "uncertainty_score": float(row.uncertainty_score) if row.uncertainty_score is not None else None,
                "uncertainty_band": row.uncertainty_band,
                "uncertainty_measured_at": (
                    row.uncertainty_measured_at.isoformat() if row.uncertainty_measured_at else None
                ),
            }
            for row in rows
        ]

    async def get_belief_trail(self, belief_id: str) -> dict[str, Any] | None:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                belief = (
                    await session.execute(
                        text(
                            """
                            SELECT id, proposition, belief_state, probability,
                                   calibration_bucket, supporting_evidence_count,
                                   contradiction_count, created_at, updated_at
                            FROM belief
                            WHERE organization_id = :org_id
                              AND id = :belief_id
                            """
                        ),
                        {"org_id": self.organization_id, "belief_id": belief_id},
                    )
                ).fetchone()
                if not belief:
                    return None

                revisions = (
                    await session.execute(
                        text(
                            """
                            SELECT id, previous_state, next_state,
                                   previous_probability, next_probability,
                                   reason, evidence_link_ids, revised_at, created_at
                            FROM belief_revision
                            WHERE organization_id = :org_id
                              AND belief_id = :belief_id
                            ORDER BY revised_at ASC, created_at ASC
                            """
                        ),
                        {"org_id": self.organization_id, "belief_id": belief_id},
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return {
            "belief": {
                "id": belief.id,
                "proposition": belief.proposition,
                "belief_state": belief.belief_state,
                "probability": float(belief.probability),
                "calibration_bucket": belief.calibration_bucket,
                "supporting_evidence_count": int(belief.supporting_evidence_count or 0),
                "contradiction_count": int(belief.contradiction_count or 0),
                "created_at": belief.created_at.isoformat() if belief.created_at else None,
                "updated_at": belief.updated_at.isoformat() if belief.updated_at else None,
            },
            "revisions": [
                {
                    "id": row.id,
                    "previous_state": row.previous_state,
                    "next_state": row.next_state,
                    "previous_probability": float(row.previous_probability)
                    if row.previous_probability is not None
                    else None,
                    "next_probability": float(row.next_probability) if row.next_probability is not None else None,
                    "reason": _safe_json_loads(row.reason) or {"raw": row.reason},
                    "evidence_link_ids": list(row.evidence_link_ids or []),
                    "revised_at": row.revised_at.isoformat() if row.revised_at else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in revisions
            ],
        }

    async def get_belief_evidence(self, *, belief_id: str, limit: int = 100) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT
                                r.id AS revision_id,
                                r.revised_at,
                                e.link_id AS evidence_link_id,
                                oel.observation_id,
                                oel.evidence_artifact_id,
                                oel.link_type,
                                oel.quote,
                                oel.confidence,
                                o.source_type,
                                o.observation_type,
                                o.title,
                                o.observed_at
                            FROM belief_revision r
                            LEFT JOIN LATERAL jsonb_array_elements_text(r.evidence_link_ids) AS e(link_id) ON TRUE
                            LEFT JOIN observation_evidence_link oel
                              ON oel.organization_id = r.organization_id
                             AND oel.id = e.link_id
                            LEFT JOIN observation o
                              ON o.organization_id = oel.organization_id
                             AND o.id = oel.observation_id
                            WHERE r.organization_id = :org_id
                              AND r.belief_id = :belief_id
                            ORDER BY r.revised_at DESC
                            LIMIT :limit
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "belief_id": belief_id,
                            "limit": limit,
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return [
            {
                "revision_id": row.revision_id,
                "revised_at": row.revised_at.isoformat() if row.revised_at else None,
                "evidence_link_id": row.evidence_link_id,
                "observation_id": row.observation_id,
                "evidence_artifact_id": row.evidence_artifact_id,
                "link_type": row.link_type,
                "quote": row.quote,
                "confidence": float(row.confidence) if row.confidence is not None else None,
                "source_type": row.source_type,
                "observation_type": row.observation_type,
                "title": row.title,
                "observed_at": row.observed_at.isoformat() if row.observed_at else None,
            }
            for row in rows
        ]

    async def replay_belief(self, *, belief_id: str) -> dict[str, Any] | None:
        trail = await self.get_belief_trail(belief_id)
        if not trail:
            return None

        revisions = list(trail.get("revisions") or [])
        state_hash_parts: list[str] = []
        violations: list[str] = []

        for index, revision in enumerate(revisions):
            previous_state = self._state_machine.coerce(revision.get("previous_state"))
            next_state = self._state_machine.coerce(revision.get("next_state"))
            is_allowed = self._state_machine.is_allowed(previous_state, next_state)
            if not is_allowed:
                violations.append(
                    f"invalid_transition@{index}:{previous_state.value}->{next_state.value}"
                )
            reason_payload = revision.get("reason") or {}
            signal_hash = str(reason_payload.get("signal_hash") or "")
            state_hash_parts.append(
                "|".join(
                    [
                        previous_state.value,
                        next_state.value,
                        str(revision.get("previous_probability")),
                        str(revision.get("next_probability")),
                        signal_hash,
                    ]
                )
            )

        deterministic_hash = hashlib.sha256("\n".join(state_hash_parts).encode("utf-8")).hexdigest()

        return {
            "belief_id": belief_id,
            "revision_count": len(revisions),
            "deterministic_hash": deterministic_hash,
            "valid_transitions": len(violations) == 0,
            "violations": violations,
        }

    async def get_calibration_metrics(
        self,
        *,
        days: int,
        source_key: str | None = None,
        model_version: str | None = None,
    ) -> dict[str, Any]:
        window_start = datetime.now(UTC) - timedelta(days=max(1, days))

        source_metrics = await self._get_source_metrics(
            window_start=window_start,
            source_key=source_key,
        )
        model_metrics = await self._get_model_metrics(
            window_start=window_start,
            model_version=model_version,
        )

        return {
            "organization_id": self.organization_id,
            "window_days": max(1, days),
            "window_start": window_start.isoformat(),
            "source_metrics": source_metrics,
            "model_metrics": model_metrics,
        }

    @staticmethod
    def apply_confidence_decay(
        *,
        probability: float,
        last_updated_at: datetime,
        contradiction_count: int,
        half_life_days: int = 45,
    ) -> float:
        age_days = max((_as_utc(datetime.now(UTC)) - _as_utc(last_updated_at)).total_seconds() / 86400.0, 0.0)
        decay_factor = 0.5 ** (age_days / max(float(half_life_days), 1.0))
        centered = 0.5 + ((probability - 0.5) * decay_factor)
        contradiction_penalty = min(0.2, max(0, contradiction_count) * 0.01)
        return _clamp(centered - contradiction_penalty, 0.01, 0.99)

    async def _get_source_metrics(
        self,
        *,
        window_start: datetime,
        source_key: str | None,
    ) -> list[dict[str, Any]]:
        conditions = ["organization_id = :org_id"]
        params: dict[str, Any] = {"org_id": self.organization_id, "window_start": window_start}
        if source_key:
            conditions.append("source_key = :source_key")
            params["source_key"] = source_key

        where_clause = " AND ".join(conditions)

        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT source_key, reliability_score,
                                   corroboration_rate, false_positive_rate,
                                   stats, last_evaluated_at
                            FROM source_reliability_profile
                            WHERE {where_clause}
                              AND (last_evaluated_at IS NULL OR last_evaluated_at >= :window_start)
                            ORDER BY reliability_score DESC, source_key ASC
                            """
                        ),
                        params,
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        return [
            {
                "source_key": row.source_key,
                "reliability_score": float(row.reliability_score),
                "corroboration_rate": float(row.corroboration_rate),
                "false_positive_rate": float(row.false_positive_rate),
                "stats": row.stats,
                "last_evaluated_at": row.last_evaluated_at.isoformat() if row.last_evaluated_at else None,
            }
            for row in rows
        ]

    async def _get_model_metrics(
        self,
        *,
        window_start: datetime,
        model_version: str | None,
    ) -> list[dict[str, Any]]:
        set_rls_context(self.organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            """
                            SELECT reason, previous_probability, next_probability,
                                   previous_state, next_state, revised_at
                            FROM belief_revision
                            WHERE organization_id = :org_id
                              AND revised_at >= :window_start
                            ORDER BY revised_at DESC
                            """
                        ),
                        {
                            "org_id": self.organization_id,
                            "window_start": window_start,
                        },
                    )
                ).fetchall()
        finally:
            set_rls_context(None, is_internal=False)

        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            reason_payload = _safe_json_loads(row.reason)
            candidate_version = str(reason_payload.get("model_version") or "unspecified")
            if model_version and candidate_version != model_version:
                continue

            entry = grouped.setdefault(
                candidate_version,
                {
                    "model_version": candidate_version,
                    "revision_count": 0,
                    "avg_probability_shift": 0.0,
                    "avg_next_probability": 0.0,
                    "state_counts": {},
                },
            )
            entry["revision_count"] += 1
            prev = float(row.previous_probability) if row.previous_probability is not None else 0.5
            nxt = float(row.next_probability) if row.next_probability is not None else 0.5
            entry["avg_probability_shift"] += abs(nxt - prev)
            entry["avg_next_probability"] += nxt
            state = str(row.next_state or "unknown")
            state_counts = entry["state_counts"]
            state_counts[state] = int(state_counts.get(state, 0)) + 1

        metrics: list[dict[str, Any]] = []
        for version in sorted(grouped.keys()):
            item = grouped[version]
            count = max(1, int(item["revision_count"]))
            metrics.append(
                {
                    "model_version": item["model_version"],
                    "revision_count": item["revision_count"],
                    "avg_probability_shift": round(float(item["avg_probability_shift"]) / count, 4),
                    "avg_next_probability": round(float(item["avg_next_probability"]) / count, 4),
                    "state_counts": item["state_counts"],
                }
            )

        return metrics

    @staticmethod
    def _derive_prior_uncertainty(signals: list[EvidenceSignal]) -> float:
        if not signals:
            return 0.65
        reliabilities = [_clamp(signal.reliability, 0.0, 1.0) for signal in signals]
        avg_reliability = sum(reliabilities) / len(reliabilities)
        return _clamp(1.0 - avg_reliability, 0.1, 0.9)

    @staticmethod
    def _build_evidence_signals(
        signals: list[dict[str, Any]],
        *,
        reliability_map: dict[str, float],
    ) -> list[EvidenceSignal]:
        built: list[EvidenceSignal] = []
        for item in signals:
            source_key = str(item.get("source_key") or "")
            default_reliability = reliability_map.get(source_key, 0.5)
            reliability = _clamp(float(item.get("reliability") or default_reliability), 0.0, 1.0)
            built.append(
                EvidenceSignal(
                    direction=str(item.get("direction") or "support").lower(),
                    strength=_clamp(float(item.get("strength") or 0.5), 0.0, 1.0),
                    reliability=reliability,
                    freshness_hours=max(0.0, float(item.get("freshness_hours") or 24.0)),
                    source_ref=str(item.get("source_ref") or source_key or "signal"),
                )
            )
        return built

    async def _load_source_reliability(self, session) -> dict[str, float]:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT source_key, reliability_score
                    FROM source_reliability_profile
                    WHERE organization_id = :org_id
                    """
                ),
                {"org_id": self.organization_id},
            )
        ).fetchall()
        return {
            str(row.source_key): _clamp(float(row.reliability_score or 0.5), 0.0, 1.0)
            for row in rows
        }


_services: dict[str, BeliefIntelligenceService] = {}


async def get_belief_intelligence_service(organization_id: str) -> BeliefIntelligenceService:
    if organization_id not in _services:
        _services[organization_id] = BeliefIntelligenceService(organization_id=organization_id)
    return _services[organization_id]
