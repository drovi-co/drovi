from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.connectors.scheduling.cadence_registry import (
    build_continuous_ingest_idempotency_key,
    compute_cadence_decision,
    is_world_source_connector,
    resolve_owner_team,
)


def test_world_source_registry_resolves_catalog_metadata() -> None:
    assert is_world_source_connector("worldnewsapi") is True
    assert is_world_source_connector("gmail") is False
    assert resolve_owner_team("worldnewsapi") == "world-intel-platform"


def test_compute_cadence_decision_enters_catchup_for_stale_source() -> None:
    now = datetime(2026, 2, 22, 12, 0, tzinfo=timezone.utc)
    decision = compute_cadence_decision(
        connector_type="worldnewsapi",
        last_sync_at=now - timedelta(minutes=80),
        default_interval_minutes=5,
        freshness_slo_minutes=15,
        quota_headroom_ratio=0.9,
        voi_priority=0.9,
        now=now,
    )

    assert decision.catchup_mode is True
    assert decision.interval_minutes <= 2
    assert "backlog_catchup" in decision.reason_codes


def test_compute_cadence_decision_slows_on_quota_pressure() -> None:
    now = datetime(2026, 2, 22, 12, 0, tzinfo=timezone.utc)
    decision = compute_cadence_decision(
        connector_type="worldnewsapi",
        last_sync_at=now - timedelta(minutes=3),
        default_interval_minutes=5,
        freshness_slo_minutes=15,
        quota_headroom_ratio=0.05,
        voi_priority=0.5,
        now=now,
    )

    assert decision.catchup_mode is False
    assert decision.interval_minutes >= 10
    assert "quota_critical" in decision.reason_codes


def test_continuous_ingest_idempotency_key_is_deterministic_by_bucket() -> None:
    now = datetime(2026, 2, 22, 12, 0, 20, tzinfo=timezone.utc)
    key_a = build_continuous_ingest_idempotency_key(
        connection_id="conn_1",
        interval_minutes=5,
        now=now,
    )
    key_b = build_continuous_ingest_idempotency_key(
        connection_id="conn_1",
        interval_minutes=5,
        now=now + timedelta(seconds=10),
    )
    key_c = build_continuous_ingest_idempotency_key(
        connection_id="conn_1",
        interval_minutes=5,
        now=now + timedelta(minutes=6),
    )

    assert key_a == key_b
    assert key_a != key_c
