"""Source reliability calibration jobs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from typing import Any

from src.db.client import get_db_pool
from src.db.rls import rls_context


def _as_utc(value: datetime | None = None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _profile_id(organization_id: str, source_key: str) -> str:
    return hashlib.sha256(f"{organization_id}:{source_key}".encode("utf-8")).hexdigest()[:40]


def _derive_scores(*, total: int, evidence_linked: int) -> tuple[float, float, float]:
    if total <= 0:
        return 0.5, 0.0, 0.0
    corroboration_rate = max(0.0, min(float(evidence_linked) / float(total), 1.0))
    false_positive_rate = max(0.0, min(1.0 - corroboration_rate, 1.0))
    reliability_score = max(0.05, min(0.95, 0.25 + corroboration_rate * 0.7 - false_positive_rate * 0.2))
    return reliability_score, corroboration_rate, false_positive_rate


async def calibrate_source_reliability_profiles(
    *,
    organization_id: str,
    lookback_days: int = 30,
    limit_sources: int = 500,
) -> dict[str, Any]:
    if organization_id == "internal":
        with rls_context(None, is_internal=True):
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                org_rows = await conn.fetch(
                    "SELECT id FROM organization WHERE status = 'active' ORDER BY created_at DESC LIMIT 500"
                )
        updated_total = 0
        source_total = 0
        for row in org_rows:
            result = await calibrate_source_reliability_profiles(
                organization_id=str(row["id"]),
                lookback_days=lookback_days,
                limit_sources=limit_sources,
            )
            updated_total += int(result.get("updated_profiles") or 0)
            source_total += int(result.get("sources_scanned") or 0)
        return {
            "organization_id": organization_id,
            "sources_scanned": source_total,
            "updated_profiles": updated_total,
        }

    now = _as_utc()
    window_start = now - timedelta(days=max(1, int(lookback_days)))
    scanned = 0
    updated = 0

    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    o.source_type AS source_key,
                    COUNT(*)::int AS total_observations,
                    COUNT(*) FILTER (WHERE oel.evidence_artifact_id IS NOT NULL)::int AS evidence_linked
                FROM observation o
                LEFT JOIN observation_evidence_link oel
                    ON oel.organization_id = o.organization_id
                   AND oel.observation_id = o.id
                WHERE o.organization_id = $1
                  AND o.observed_at >= $2::timestamptz
                GROUP BY o.source_type
                ORDER BY COUNT(*) DESC
                LIMIT $3
                """,
                organization_id,
                window_start,
                max(1, int(limit_sources)),
            )

            for row in rows:
                source_key = str(row["source_key"] or "unknown")
                total = int(row["total_observations"] or 0)
                evidence_linked = int(row["evidence_linked"] or 0)
                reliability_score, corroboration_rate, false_positive_rate = _derive_scores(
                    total=total,
                    evidence_linked=evidence_linked,
                )
                scanned += 1
                profile_id = _profile_id(organization_id, source_key)
                await conn.execute(
                    """
                    INSERT INTO source_reliability_profile (
                        id,
                        organization_id,
                        source_key,
                        reliability_score,
                        corroboration_rate,
                        false_positive_rate,
                        stats,
                        last_evaluated_at,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, NOW(), NOW()
                    )
                    ON CONFLICT (organization_id, source_key) DO UPDATE
                    SET
                        reliability_score = EXCLUDED.reliability_score,
                        corroboration_rate = EXCLUDED.corroboration_rate,
                        false_positive_rate = EXCLUDED.false_positive_rate,
                        stats = EXCLUDED.stats,
                        last_evaluated_at = EXCLUDED.last_evaluated_at,
                        updated_at = NOW()
                    """,
                    profile_id,
                    organization_id,
                    source_key,
                    reliability_score,
                    corroboration_rate,
                    false_positive_rate,
                    {
                        "window_days": int(lookback_days),
                        "window_start": window_start.isoformat(),
                        "window_end": now.isoformat(),
                        "total_observations": total,
                        "evidence_linked": evidence_linked,
                    },
                    now,
                )
                updated += 1

    return {
        "organization_id": organization_id,
        "sources_scanned": scanned,
        "updated_profiles": updated,
        "lookback_days": int(lookback_days),
    }
