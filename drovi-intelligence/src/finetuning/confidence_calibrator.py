"""Supervised confidence calibration using user feedback events."""
from __future__ import annotations

from datetime import datetime, timedelta
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import set_rls_context

logger = structlog.get_logger()


async def record_calibration_event(
    organization_id: str,
    item_type: str,
    confidence: float,
    was_correct: bool,
    uio_id: str | None = None,
    source: str | None = None,
) -> None:
    """Record a calibration event for later supervised adjustment."""
    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO confidence_calibration_event (
                        id, organization_id, uio_id,
                        item_type, confidence, was_correct, source, created_at
                    ) VALUES (
                        :id, :org_id, :uio_id,
                        :item_type, :confidence, :was_correct, :source, :created_at
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "org_id": organization_id,
                    "uio_id": uio_id,
                    "item_type": item_type,
                    "confidence": max(0.0, min(confidence, 1.0)),
                    "was_correct": was_correct,
                    "source": source,
                    "created_at": datetime.utcnow(),
                },
            )
    finally:
        set_rls_context(None, is_internal=False)


async def get_adjustment_factors(
    organization_id: str,
    days: int = 30,
) -> dict[str, float]:
    """Return adjustment factors per item type based on recent feedback."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT item_type,
                           AVG(confidence) as avg_confidence,
                           AVG(CASE WHEN was_correct THEN 1.0 ELSE 0.0 END) as accuracy,
                           COUNT(*) as samples
                    FROM confidence_calibration_event
                    WHERE organization_id = :org_id
                      AND created_at >= :cutoff
                    GROUP BY item_type
                    """
                ),
                {"org_id": organization_id, "cutoff": cutoff},
            )
            rows = result.fetchall()
    finally:
        set_rls_context(None, is_internal=False)

    factors: dict[str, float] = {}
    for row in rows:
        avg_conf = row.avg_confidence or 0.0
        accuracy = row.accuracy or 0.0
        if avg_conf <= 0.05:
            factor = 1.0
        else:
            factor = accuracy / avg_conf
        # Clamp to keep calibration stable
        factor = max(0.5, min(1.5, factor))
        factors[row.item_type] = factor

    if not factors:
        logger.debug("No calibration events found", organization_id=organization_id)

    return factors
