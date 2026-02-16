from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.streaming.worker import KafkaWorker


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _MetricsRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def observe_pipeline_end_to_end_lag(self, **_kwargs):  # noqa: ANN003
        return None

    def track_extraction(self, **kwargs):  # noqa: ANN003
        self.calls.append(kwargs)


async def test_pipeline_input_duplicate_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = KafkaWorker()
    worker._producer = AsyncMock()
    worker._is_duplicate_event = AsyncMock(return_value=True)  # type: ignore[method-assign]

    metrics = _MetricsRecorder()
    monkeypatch.setattr("src.streaming.worker.get_metrics", lambda: metrics)

    # If duplicate detection fails, this import path should never be used.
    monkeypatch.setattr(
        "src.orchestrator.graph.run_intelligence_extraction",
        AsyncMock(side_effect=AssertionError("should not run extraction")),
    )

    await worker._handle_pipeline_input(
        {
            "payload": {
                "organization_id": "org_test",
                "source_type": "document",
                "content": "content",
                "ingest": {"content_hash": "abc123"},
            }
        }
    )

    assert metrics.calls == []
    worker._producer.produce_intelligence.assert_not_called()
    worker._producer.produce_graph_change.assert_not_called()


async def test_pipeline_input_failure_tracks_error_metric(monkeypatch: pytest.MonkeyPatch) -> None:
    worker = KafkaWorker()
    worker._producer = AsyncMock()
    worker._is_duplicate_event = AsyncMock(return_value=False)  # type: ignore[method-assign]

    metrics = _MetricsRecorder()
    monkeypatch.setattr("src.streaming.worker.get_metrics", lambda: metrics)
    monkeypatch.setattr(
        "src.orchestrator.graph.run_intelligence_extraction",
        AsyncMock(side_effect=RuntimeError("falkor_unavailable")),
    )

    await worker._handle_pipeline_input(
        {
            "payload": {
                "organization_id": "org_test",
                "source_type": "email",
                "content": "hello world",
                "source_id": "msg_1",
                "ingest": {"content_hash": "hash_1"},
            }
        }
    )

    assert metrics.calls
    assert metrics.calls[-1]["status"] == "error"
    worker._producer.produce_intelligence.assert_not_called()
    worker._producer.produce_graph_change.assert_not_called()


async def test_pipeline_input_success_publishes_graph_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = KafkaWorker()
    worker._producer = AsyncMock()
    worker._is_duplicate_event = AsyncMock(return_value=False)  # type: ignore[method-assign]

    metrics = _MetricsRecorder()
    monkeypatch.setattr("src.streaming.worker.get_metrics", lambda: metrics)
    monkeypatch.setattr(
        "src.orchestrator.graph.run_intelligence_extraction",
        AsyncMock(
            return_value=SimpleNamespace(
                output=SimpleNamespace(
                    model_dump=lambda mode="json": {
                        "uios": [
                            {"id": "uio_1", "type": "commitment", "title": "Send report"},
                            {"id": "uio_2", "type": "risk", "title": "Deadline risk"},
                        ]
                    }
                )
            )
        ),
    )

    await worker._handle_pipeline_input(
        {
            "payload": {
                "organization_id": "org_test",
                "source_type": "meeting",
                "content": "We will send the report by Friday.",
                "source_id": "meeting_1",
                "ingest": {"content_hash": "hash_2"},
            }
        }
    )

    assert metrics.calls
    assert metrics.calls[-1]["status"] == "ok"
    assert worker._producer.produce_intelligence.await_count == 2
    assert worker._producer.produce_graph_change.await_count == 2
