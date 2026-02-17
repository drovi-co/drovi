"""
Connector source health evaluation.

Computes deterministic health status + reason codes from connection and sync metadata.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field


class SourceHealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    STALE = "stale"
    ERROR = "error"
    RECOVERING = "recovering"


class SourceHealthReason(str, Enum):
    HEALTHY = "healthy"
    AUTH_REQUIRED = "auth_required"
    SYNC_DISABLED = "sync_disabled"
    NEVER_SYNCED = "never_synced"
    STALE_SYNC = "stale_sync"
    RATE_LIMITED = "rate_limited"
    RECENT_FAILURES = "recent_failures"
    RECOVERY_IN_FLIGHT = "recovery_in_flight"


class SourceHealthSnapshot(BaseModel):
    connection_id: str
    organization_id: str
    connector_type: str
    status: SourceHealthStatus
    reason_code: SourceHealthReason
    reason: str
    last_sync_at: datetime | None = None
    minutes_since_last_sync: float | None = None
    stale_after_minutes: int
    sync_slo_breached: bool = False
    sync_slo_minutes: int
    recent_failures: int = 0
    recovery_action: str = "none"
    last_error: str | None = None
    checked_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _minutes_since(now: datetime, reference: datetime | None) -> float | None:
    if reference is None:
        return None
    return max((now - reference).total_seconds() / 60.0, 0.0)


def _contains_rate_limit_error(last_error: str | None) -> bool:
    if not last_error:
        return False
    lowered = last_error.lower()
    return any(
        marker in lowered
        for marker in (
            "rate limit",
            "too many requests",
            "429",
            "quota exceeded",
            "throttl",
        )
    )


def evaluate_source_health(
    *,
    connection_id: str,
    organization_id: str,
    connector_type: str,
    connection_status: str,
    sync_enabled: bool,
    sync_frequency_minutes: int,
    last_sync_at: datetime | None,
    last_sync_status: str | None,
    last_error: str | None,
    recent_failures: int,
    recovery_in_flight: bool,
    now: datetime | None = None,
    stale_multiplier: int = 3,
    stale_floor_minutes: int = 15,
    sync_slo_minutes: int = 60,
    failure_threshold: int = 2,
) -> SourceHealthSnapshot:
    """Evaluate source health using deterministic policy rules."""
    now_utc = _as_utc(now) or datetime.now(timezone.utc)
    last_sync_utc = _as_utc(last_sync_at)
    minutes_since_last_sync = _minutes_since(now_utc, last_sync_utc)

    stale_after_minutes = max(
        int(sync_frequency_minutes or 0) * max(stale_multiplier, 1),
        max(stale_floor_minutes, 1),
    )
    sync_slo_minutes_safe = max(sync_slo_minutes, stale_after_minutes)
    sync_slo_breached = (
        minutes_since_last_sync is not None and minutes_since_last_sync > sync_slo_minutes_safe
    )

    if not sync_enabled:
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.DEGRADED,
            reason_code=SourceHealthReason.SYNC_DISABLED,
            reason="Sync is disabled for this source.",
            last_sync_at=last_sync_utc,
            minutes_since_last_sync=minutes_since_last_sync,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=sync_slo_breached,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="enable_sync",
            last_error=last_error,
            checked_at=now_utc,
        )

    if connection_status == "pending_auth":
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.ERROR,
            reason_code=SourceHealthReason.AUTH_REQUIRED,
            reason="Source requires authentication refresh.",
            last_sync_at=last_sync_utc,
            minutes_since_last_sync=minutes_since_last_sync,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=True,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="reconnect",
            last_error=last_error,
            checked_at=now_utc,
        )

    if recovery_in_flight:
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.RECOVERING,
            reason_code=SourceHealthReason.RECOVERY_IN_FLIGHT,
            reason="Automated recovery is in progress.",
            last_sync_at=last_sync_utc,
            minutes_since_last_sync=minutes_since_last_sync,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=sync_slo_breached,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="wait",
            last_error=last_error,
            checked_at=now_utc,
        )

    if _contains_rate_limit_error(last_error):
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.DEGRADED,
            reason_code=SourceHealthReason.RATE_LIMITED,
            reason="Source is currently rate-limited by the provider.",
            last_sync_at=last_sync_utc,
            minutes_since_last_sync=minutes_since_last_sync,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=sync_slo_breached,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="wait",
            last_error=last_error,
            checked_at=now_utc,
        )

    if recent_failures >= max(failure_threshold, 1) and (last_sync_status or "").lower() == "failed":
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.ERROR,
            reason_code=SourceHealthReason.RECENT_FAILURES,
            reason=f"Source failed {recent_failures} recent sync attempts.",
            last_sync_at=last_sync_utc,
            minutes_since_last_sync=minutes_since_last_sync,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=sync_slo_breached,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="retry_sync",
            last_error=last_error,
            checked_at=now_utc,
        )

    if last_sync_utc is None:
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.STALE,
            reason_code=SourceHealthReason.NEVER_SYNCED,
            reason="Source has not completed its first successful sync yet.",
            last_sync_at=None,
            minutes_since_last_sync=None,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=True,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="retry_sync",
            last_error=last_error,
            checked_at=now_utc,
        )

    if minutes_since_last_sync is not None and minutes_since_last_sync > stale_after_minutes:
        return SourceHealthSnapshot(
            connection_id=connection_id,
            organization_id=organization_id,
            connector_type=connector_type,
            status=SourceHealthStatus.STALE,
            reason_code=SourceHealthReason.STALE_SYNC,
            reason=(
                f"Last sync was {minutes_since_last_sync:.1f} minutes ago "
                f"(threshold: {stale_after_minutes} minutes)."
            ),
            last_sync_at=last_sync_utc,
            minutes_since_last_sync=minutes_since_last_sync,
            stale_after_minutes=stale_after_minutes,
            sync_slo_breached=sync_slo_breached,
            sync_slo_minutes=sync_slo_minutes_safe,
            recent_failures=recent_failures,
            recovery_action="retry_sync",
            last_error=last_error,
            checked_at=now_utc,
        )

    return SourceHealthSnapshot(
        connection_id=connection_id,
        organization_id=organization_id,
        connector_type=connector_type,
        status=SourceHealthStatus.HEALTHY,
        reason_code=SourceHealthReason.HEALTHY,
        reason="Source is syncing within SLO.",
        last_sync_at=last_sync_utc,
        minutes_since_last_sync=minutes_since_last_sync,
        stale_after_minutes=stale_after_minutes,
        sync_slo_breached=sync_slo_breached,
        sync_slo_minutes=sync_slo_minutes_safe,
        recent_failures=recent_failures,
        recovery_action="none",
        last_error=last_error,
        checked_at=now_utc,
    )


def should_auto_recover(snapshot: SourceHealthSnapshot) -> bool:
    """Whether an automated recovery sync should be attempted."""
    return snapshot.recovery_action == "retry_sync" and snapshot.status in {
        SourceHealthStatus.STALE,
        SourceHealthStatus.ERROR,
    }
