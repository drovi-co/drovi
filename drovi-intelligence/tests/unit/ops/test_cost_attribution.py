from __future__ import annotations

import pytest

from src.ops.cost_attribution import summarize_cost_records

pytestmark = [pytest.mark.unit]


def _records() -> list[dict]:
    return [
        {
            "organization_id": "org_1",
            "source_key": "worldnewsapi",
            "table_name": "silver.observations",
            "records_written": 10,
            "bytes_written": 1000,
            "compute_millis": 100,
            "cost_units": 1.2,
            "metadata": {"worker_id": "w_a", "pack_id": "p_news"},
        },
        {
            "organization_id": "org_1",
            "source_key": "sec_edgar",
            "table_name": "silver.observations",
            "records_written": 8,
            "bytes_written": 800,
            "compute_millis": 80,
            "cost_units": 0.8,
            "metadata": {"worker_id": "w_b", "pack_id": "p_finance"},
        },
        {
            "organization_id": "org_1",
            "source_key": "worldnewsapi",
            "table_name": "silver.observations",
            "records_written": 7,
            "bytes_written": 700,
            "compute_millis": 70,
            "cost_units": 0.4,
            "metadata": {"worker_id": "w_a", "pack_id": "p_news"},
        },
    ]


def test_summarize_cost_records_group_by_worker() -> None:
    items = summarize_cost_records(records=_records(), group_by="worker")

    assert len(items) == 2
    assert items[0]["worker_id"] == "w_a"
    assert items[0]["cost_units"] == pytest.approx(1.6)
    assert items[1]["worker_id"] == "w_b"


def test_summarize_cost_records_group_by_pack() -> None:
    items = summarize_cost_records(records=_records(), group_by="pack")

    assert len(items) == 2
    assert items[0]["pack_id"] == "p_news"
    assert items[0]["records_written"] == 17
    assert items[0]["cost_units"] == pytest.approx(1.6)


def test_summarize_cost_records_group_by_tenant() -> None:
    items = summarize_cost_records(records=_records(), group_by="tenant")

    assert len(items) == 1
    assert items[0]["organization_id"] == "org_1"
    assert items[0]["cost_units"] == pytest.approx(2.4)
