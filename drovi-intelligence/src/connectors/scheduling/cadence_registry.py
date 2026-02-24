"""Cadence policy registry for continuous world-source ingestion."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from src.connectors.source_catalog import SourceCatalogEntry, SourceCadence, get_source_catalog


class CadencePolicy(str, Enum):
    HOT = "hot"
    WARM = "warm"
    COLD = "cold"
    EVENT_DRIVEN = "event_driven"


@dataclass(frozen=True)
class CadenceDecision:
    interval_minutes: int
    catchup_mode: bool
    freshness_lag_minutes: int
    reason_codes: tuple[str, ...]


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _minutes_since(reference: datetime | None, now: datetime) -> int:
    if reference is None:
        return 10_000
    delta = max((now - reference).total_seconds(), 0.0)
    return int(delta // 60)


def get_source_catalog_entry(connector_type: str) -> SourceCatalogEntry | None:
    catalog = get_source_catalog()
    for source in catalog.sources:
        if source.source_key == connector_type:
            return source
    return None


def is_world_source_connector(connector_type: str) -> bool:
    return get_source_catalog_entry(connector_type) is not None


def resolve_cadence(connector_type: str) -> SourceCadence | None:
    source = get_source_catalog_entry(connector_type)
    if source is None:
        return None
    return source.cadence


def resolve_owner_team(connector_type: str) -> str | None:
    source = get_source_catalog_entry(connector_type)
    if source is None:
        return None
    return source.onboarding.owner_team


def resolve_freshness_slo_minutes(connector_type: str, fallback: int) -> int:
    source = get_source_catalog_entry(connector_type)
    if source is None:
        return max(1, int(fallback))
    return max(1, int(source.sla.freshness_slo_minutes))


def compute_cadence_decision(
    *,
    connector_type: str,
    last_sync_at: datetime | None,
    default_interval_minutes: int,
    freshness_slo_minutes: int,
    quota_headroom_ratio: float | None,
    voi_priority: float | None,
    now: datetime | None = None,
) -> CadenceDecision:
    """
    Compute the next cadence interval using freshness lag, quota headroom, and VOI.

    Rules:
    - Base interval comes from source catalog cadence metadata.
    - If stale beyond backlog multiplier, force catch-up mode.
    - Low quota headroom slows cadence.
    - High VOI tightens cadence; low VOI relaxes cadence.
    """
    cadence = resolve_cadence(connector_type)
    min_interval = max(1, int(cadence.min_interval_minutes if cadence else 1))
    max_interval = max(min_interval, int(cadence.max_interval_minutes if cadence else 1440))
    default_interval = int(cadence.default_interval_minutes if cadence else default_interval_minutes)
    default_interval = max(min_interval, min(default_interval, max_interval))
    catchup_interval = int(cadence.catchup_interval_minutes if cadence else max(1, default_interval // 2))
    catchup_interval = max(min_interval, min(catchup_interval, default_interval))
    backlog_multiplier = float(cadence.backlog_multiplier if cadence else 2.0)
    voi = float(voi_priority if voi_priority is not None else (cadence.voi_priority if cadence else 0.5))
    voi = max(0.0, min(voi, 1.0))

    now_utc = _as_utc(now) or datetime.now(timezone.utc)
    lag_minutes = _minutes_since(_as_utc(last_sync_at), now_utc)
    freshness_slo = max(1, int(freshness_slo_minutes))

    interval = default_interval
    reason_codes: list[str] = []
    catchup_mode = False

    if lag_minutes > int(freshness_slo * backlog_multiplier):
        interval = catchup_interval
        catchup_mode = True
        reason_codes.append("backlog_catchup")
    elif lag_minutes > freshness_slo:
        interval = max(min_interval, int(round(default_interval * 0.75)))
        reason_codes.append("freshness_lag")

    if quota_headroom_ratio is not None:
        quota = max(0.0, min(float(quota_headroom_ratio), 1.0))
        if quota <= 0.1:
            interval = min(max_interval, int(round(interval * 2.5)))
            reason_codes.append("quota_critical")
        elif quota <= 0.25:
            interval = min(max_interval, int(round(interval * 1.6)))
            reason_codes.append("quota_low")

    if voi >= 0.8:
        interval = max(min_interval, int(round(interval * 0.6)))
        reason_codes.append("voi_high")
    elif voi <= 0.2:
        interval = min(max_interval, int(round(interval * 1.3)))
        reason_codes.append("voi_low")

    interval = max(min_interval, min(interval, max_interval))
    if not reason_codes:
        reason_codes.append("steady_state")

    return CadenceDecision(
        interval_minutes=interval,
        catchup_mode=catchup_mode,
        freshness_lag_minutes=lag_minutes,
        reason_codes=tuple(reason_codes),
    )


def build_continuous_ingest_idempotency_key(
    *,
    connection_id: str,
    interval_minutes: int,
    now: datetime | None = None,
) -> str:
    now_utc = _as_utc(now) or datetime.now(timezone.utc)
    bucket_seconds = max(60, int(interval_minutes) * 60)
    bucket = int(now_utc.timestamp()) // bucket_seconds
    return f"continuous_ingest:{connection_id}:{bucket}"
