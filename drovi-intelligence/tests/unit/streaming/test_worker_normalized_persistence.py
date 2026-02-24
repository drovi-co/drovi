from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.ingestion.observation_store import ObservationPersistenceResult
from src.streaming.ingestion_pipeline import PipelineInputEvent
from src.streaming.worker import KafkaWorker


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_handle_normalized_record_persists_and_enqueues_pipeline_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = KafkaWorker()
    worker._producer = AsyncMock()

    persist_mock = AsyncMock(
        return_value=ObservationPersistenceResult(
            observation_id="obs_1",
            persisted_db=True,
            persisted_lakehouse=True,
            evidence_linked=True,
        )
    )
    impact_mock = AsyncMock(return_value={"observation_id": "obs_1", "accepted": True})
    enrich_mock = AsyncMock(
        return_value=PipelineInputEvent(
            pipeline_id="pipe_1",
            organization_id="org_test",
            source_type="news_api",
            source_id="article_1",
            content="Headline: Markets",
            metadata={"source": "test"},
            conversation_id=None,
            message_ids=["article_1"],
            user_email=None,
            user_name=None,
            candidate_only=False,
            is_partial=False,
            ingest={"priority": 3},
            enrichment={},
        )
    )
    twin_service = AsyncMock()
    twin_service.apply_stream_event = AsyncMock(return_value={"snapshot_id": "snap_1"})
    twin_service_factory = AsyncMock(return_value=twin_service)

    monkeypatch.setattr("src.ingestion.observation_store.persist_normalized_observation", persist_mock)
    monkeypatch.setattr("src.ingestion.impact_precompute.precompute_impact_features", impact_mock)
    monkeypatch.setattr("src.streaming.worker.enrich_normalized_payload", enrich_mock)
    monkeypatch.setattr("src.world_model.twin_service.get_world_twin_service", twin_service_factory)

    await worker._handle_normalized_record(
        {
            "payload": {
                "normalized_id": "norm_1",
                "organization_id": "org_test",
                "source_type": "news_api",
                "source_id": "article_1",
                "event_type": "connector.record",
                "record": {"record_id": "article_1"},
                "normalized": {
                    "content": "Headline: Markets",
                    "metadata": {},
                    "conversation_id": None,
                    "user_email": None,
                    "user_name": None,
                    "subject": "Markets",
                },
                "ingest": {"priority": 3, "content_hash": "abc", "source_fingerprint": "fp"},
                "connector_type": "worldnewsapi",
                "connection_id": "conn_1",
            }
        }
    )

    assert persist_mock.await_count == 1
    assert impact_mock.await_count == 1
    assert enrich_mock.await_count == 1
    assert twin_service_factory.await_count == 1
    assert twin_service.apply_stream_event.await_count == 1
    assert worker._producer.produce_pipeline_input.await_count == 1
    kwargs = worker._producer.produce_pipeline_input.await_args.kwargs
    assert kwargs["organization_id"] == "org_test"
    assert kwargs["idempotency_key"] == "pipeline_input:org_test:obs_1"
