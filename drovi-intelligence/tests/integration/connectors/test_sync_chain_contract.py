from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, ConnectorCapabilities
from src.connectors.base.records import Record, RecordBatch, RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.scheduling.scheduler import ConnectorScheduler, SyncJob, SyncJobType, SyncJobStatus

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


class _FakeConnector(BaseConnector):
    def __init__(self, connector_type: str) -> None:
        self._connector_type = connector_type

    @property
    def connector_type(self) -> str:
        return self._connector_type

    @property
    def capabilities(self) -> ConnectorCapabilities:
        return ConnectorCapabilities()

    async def check_connection(self, config: ConnectorConfig) -> tuple[bool, str | None]:
        return True, None

    async def discover_streams(self, config: ConnectorConfig) -> list[StreamConfig]:
        return config.streams

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        batch = RecordBatch(
            stream_name=stream.stream_name,
            connection_id=config.connection_id,
            next_cursor={"cursor": "next"},
            record_count=1,
            byte_count=512,
        )
        batch.records = [
            Record(
                record_id="rec_1",
                source_type=self.connector_type,
                stream_name=stream.stream_name,
                record_type=RecordType.MESSAGE,
                data={
                    "subject": "Pilot launch update",
                    "body_text": "We commit to ship by Friday and review risks.",
                    "sender_email": "ceo@drovi.co",
                },
            )
        ]
        yield batch


class _FakeStateRepo:
    def __init__(self) -> None:
        self.upserts: list[dict] = []

    async def get_state(self, connection_id: str, connector_type: str) -> ConnectorState:
        return ConnectorState(connection_id=connection_id, connector_type=connector_type)

    async def upsert_stream_state(self, **kwargs) -> None:
        self.upserts.append(kwargs)


@pytest.mark.parametrize(
    ("connector_type", "expected_source_type"),
    [
        ("gmail", "email"),
        ("slack", "slack"),
        ("notion", "notion"),
        ("google_calendar", "calendar"),
    ],
)
async def test_sync_pipeline_contract_invokes_intelligence_chain(
    monkeypatch: pytest.MonkeyPatch,
    connector_type: str,
    expected_source_type: str,
) -> None:
    scheduler = ConnectorScheduler()
    fake_connector = _FakeConnector(connector_type=connector_type)
    fake_state_repo = _FakeStateRepo()

    config = ConnectorConfig(
        connection_id="3bb0a0de-45f6-4f9b-9f6c-c8f2db31f8c0",
        organization_id="org_test",
        connector_type=connector_type,
        name=f"{connector_type} source",
        auth=AuthConfig(auth_type=AuthType.NONE),
        streams=[StreamConfig(stream_name="messages", enabled=True)],
        status="connected",
    )
    sync_job = SyncJob(
        job_id="job_sync_contract",
        connection_id=config.connection_id,
        organization_id=config.organization_id,
        connector_type=connector_type,
        job_type=SyncJobType.SCHEDULED,
    )

    run_extraction = AsyncMock(return_value={"analysis_id": "analysis_1"})

    monkeypatch.setattr("src.connectors.bootstrap.ensure_connectors_registered", lambda: None)
    monkeypatch.setattr("src.connectors.scheduling.scheduler.ConnectorRegistry.create", lambda _t: fake_connector)
    monkeypatch.setattr("src.connectors.state_repo.get_state_repo", lambda: fake_state_repo)
    monkeypatch.setattr("src.orchestrator.graph.run_intelligence_extraction", run_extraction)
    monkeypatch.setattr("src.connectors.sync_events.emit_sync_progress", AsyncMock())
    monkeypatch.setattr(
        "src.config.get_settings",
        lambda: type("Settings", (), {"kafka_enabled": False})(),
    )

    result = await scheduler._default_sync_execution(sync_job, config)

    assert result.status == SyncJobStatus.COMPLETED
    assert result.records_synced == 1
    assert "messages" in result.streams_completed
    assert run_extraction.await_count == 1

    call_kwargs = run_extraction.await_args.kwargs
    assert call_kwargs["organization_id"] == "org_test"
    assert call_kwargs["source_type"] == expected_source_type
    assert call_kwargs["source_account_id"] == config.connection_id
    assert call_kwargs["conversation_id"] is None
    assert call_kwargs["message_ids"] == ["rec_1"]
    assert "ship by Friday" in call_kwargs["content"]

    assert any(upsert.get("status") == "syncing" for upsert in fake_state_repo.upserts)
    assert any(upsert.get("status") == "completed" for upsert in fake_state_repo.upserts)
