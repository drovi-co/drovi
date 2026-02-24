from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.lakehouse.lifecycle import LakehouseLifecycleManager

pytestmark = [pytest.mark.unit]


def test_lifecycle_manager_plans_hot_warm_cold_transitions() -> None:
    now = datetime(2026, 2, 23, tzinfo=UTC)
    manager = LakehouseLifecycleManager(warm_after_days=7, cold_after_days=30)
    transitions = manager.plan_transitions(
        now=now,
        partitions=[
            {
                "partition_key": "date=2026-02-22",
                "table_name": "silver.observations",
                "last_event_at": (now - timedelta(days=1)).isoformat(),
                "metadata": {"storage_class": "hot"},
            },
            {
                "partition_key": "date=2026-02-10",
                "table_name": "silver.observations",
                "last_event_at": (now - timedelta(days=13)).isoformat(),
                "metadata": {"storage_class": "hot"},
            },
            {
                "partition_key": "date=2025-12-01",
                "table_name": "silver.observations",
                "last_event_at": (now - timedelta(days=84)).isoformat(),
                "metadata": {"storage_class": "warm"},
            },
        ],
    )

    assert len(transitions) == 2
    by_partition = {item.partition_key: item.to_class for item in transitions}
    assert by_partition["date=2026-02-10"] == "warm"
    assert by_partition["date=2025-12-01"] == "cold"
