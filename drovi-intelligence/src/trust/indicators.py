"""Trust indicator computation for UIOs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.memory.service import get_memory_service, utc_now

logger = structlog.get_logger()


def _parse_datetime(value: str | datetime | None) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _to_utc_naive(value: datetime) -> datetime:
    """
    Convert a datetime into naive UTC.

    Our DB layer sometimes returns offset-aware timestamps (timestamptz) while other parts
    of the codebase (and `utc_now()` in particular) use naive datetimes for Postgres.
    Normalizing here prevents "can't subtract offset-naive and offset-aware datetimes".
    """

    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _compute_trust_score(
    confidence: float,
    evidence_count: int,
    is_contradicted: bool,
    last_updated_at: datetime | None,
) -> float:
    score = confidence
    if evidence_count > 0:
        score += 0.1
    if evidence_count >= 3:
        score += 0.05
    if is_contradicted:
        score -= 0.2
    if last_updated_at:
        normalized_last_updated_at = _to_utc_naive(last_updated_at)
        age_days = max((utc_now() - normalized_last_updated_at).days, 0)
        if age_days > 180:
            score -= 0.1
        elif age_days > 30:
            score -= 0.05
    return max(0.0, min(1.0, score))


def _build_reasoning(
    *,
    confidence: float,
    evidence_count: int,
    last_updated_at: datetime | None,
    belief_state: str | None,
    truth_state: str | None,
    is_contradicted: bool,
) -> list[str]:
    reasoning = [f"Model confidence {confidence:.2f}"]
    if evidence_count:
        reasoning.append(f"{evidence_count} evidence snippet(s) attached")
    else:
        reasoning.append("No evidence snippets attached")
    if last_updated_at:
        reasoning.append(f"Last updated {last_updated_at.date().isoformat()}")
    if belief_state:
        reasoning.append(f"Belief state: {belief_state}")
    if truth_state:
        reasoning.append(f"Truth state: {truth_state}")
    if is_contradicted:
        reasoning.append("Marked as contradicted")
    return reasoning


async def get_trust_indicators(
    *,
    organization_id: str,
    uio_ids: list[str],
    evidence_limit: int = 3,
) -> list[dict[str, Any]]:
    if not uio_ids:
        return []

    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, overall_confidence, belief_state, truth_state,
                           last_update_reason, last_updated_at, contradicts_existing
                    FROM unified_intelligence_object
                    WHERE organization_id = :org_id AND id = ANY(:uio_ids)
                    """
                ),
                {"org_id": organization_id, "uio_ids": uio_ids},
            )
            rows = result.fetchall()
    finally:
        set_rls_context(None, is_internal=False)

    memory = await get_memory_service(organization_id)
    evidence_map = await memory.get_uio_evidence(uio_ids, limit_per_uio=evidence_limit)

    indicators: list[dict[str, Any]] = []
    for row in rows:
        evidence = evidence_map.get(row.id, [])
        confidence = float(row.overall_confidence or 0.5)
        last_updated_at = row.last_updated_at
        trust_score = _compute_trust_score(
            confidence=confidence,
            evidence_count=len(evidence),
            is_contradicted=bool(row.contradicts_existing),
            last_updated_at=last_updated_at,
        )
        indicators.append(
            {
                "uio_id": row.id,
                "trust_score": trust_score,
                "confidence": confidence,
                "belief_state": row.belief_state,
                "truth_state": row.truth_state,
                "last_update_reason": row.last_update_reason,
                "last_updated_at": last_updated_at.isoformat() if last_updated_at else None,
                "evidence_count": len(evidence),
                "evidence": evidence,
                "confidence_reasoning": _build_reasoning(
                    confidence=confidence,
                    evidence_count=len(evidence),
                    last_updated_at=last_updated_at,
                    belief_state=row.belief_state,
                    truth_state=row.truth_state,
                    is_contradicted=bool(row.contradicts_existing),
                ),
            }
        )

    return indicators
