from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.connectors.source_health import (
    SourceHealthReason,
    SourceHealthStatus,
    evaluate_source_health,
    should_auto_recover,
)

pytestmark = [pytest.mark.unit]


def test_evaluate_source_health_auth_required() -> None:
    snapshot = evaluate_source_health(
        connection_id="conn_1",
        organization_id="org_1",
        connector_type="gmail",
        connection_status="pending_auth",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=None,
        last_sync_status=None,
        last_error=None,
        recent_failures=0,
        recovery_in_flight=False,
        now=datetime.now(timezone.utc),
    )

    assert snapshot.status == SourceHealthStatus.ERROR
    assert snapshot.reason_code == SourceHealthReason.AUTH_REQUIRED
    assert snapshot.recovery_action == "reconnect"
    assert snapshot.sync_slo_breached is True


def test_evaluate_source_health_stale_and_recoverable() -> None:
    snapshot = evaluate_source_health(
        connection_id="conn_1",
        organization_id="org_1",
        connector_type="gmail",
        connection_status="connected",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=datetime.now(timezone.utc) - timedelta(minutes=42),
        last_sync_status="success",
        last_error=None,
        recent_failures=0,
        recovery_in_flight=False,
        now=datetime.now(timezone.utc),
        stale_multiplier=3,
        stale_floor_minutes=10,
        sync_slo_minutes=30,
    )

    assert snapshot.status == SourceHealthStatus.STALE
    assert snapshot.reason_code == SourceHealthReason.STALE_SYNC
    assert snapshot.sync_slo_breached is True
    assert should_auto_recover(snapshot) is True


def test_evaluate_source_health_rate_limited_is_degraded() -> None:
    snapshot = evaluate_source_health(
        connection_id="conn_1",
        organization_id="org_1",
        connector_type="gmail",
        connection_status="error",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=datetime.now(timezone.utc),
        last_sync_status="failed",
        last_error="429 too many requests",
        recent_failures=1,
        recovery_in_flight=False,
        now=datetime.now(timezone.utc),
    )

    assert snapshot.status == SourceHealthStatus.DEGRADED
    assert snapshot.reason_code == SourceHealthReason.RATE_LIMITED
    assert snapshot.recovery_action == "wait"
    assert should_auto_recover(snapshot) is False


def test_evaluate_source_health_recent_failures_error() -> None:
    snapshot = evaluate_source_health(
        connection_id="conn_1",
        organization_id="org_1",
        connector_type="gmail",
        connection_status="error",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=datetime.now(timezone.utc) - timedelta(minutes=4),
        last_sync_status="failed",
        last_error="provider timeout",
        recent_failures=3,
        recovery_in_flight=False,
        now=datetime.now(timezone.utc),
        failure_threshold=2,
    )

    assert snapshot.status == SourceHealthStatus.ERROR
    assert snapshot.reason_code == SourceHealthReason.RECENT_FAILURES
    assert snapshot.recovery_action == "retry_sync"
    assert should_auto_recover(snapshot) is True
