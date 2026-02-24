from __future__ import annotations

import pytest

from src.jobs.worker import JobsWorker

pytestmark = [pytest.mark.unit]


def test_worker_resolves_queue_depth_ratio_from_sync_params() -> None:
    worker = JobsWorker()
    value = worker._resolve_queue_depth_ratio({"queue_depth_ratio": "0.82"}, None)
    assert value == pytest.approx(0.82)


def test_worker_resolves_queue_depth_ratio_from_provider_settings() -> None:
    worker = JobsWorker()
    value = worker._resolve_queue_depth_ratio(
        {},
        {"settings": {"queue_depth_ratio": 0.41}},
    )
    assert value == pytest.approx(0.41)


def test_worker_resolves_queue_depth_ratio_clamps_out_of_bounds() -> None:
    worker = JobsWorker()
    value = worker._resolve_queue_depth_ratio({"queue_depth_ratio": 3}, None)
    assert value == 1.0
