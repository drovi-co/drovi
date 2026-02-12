from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.documents.jobs import process_document_job
from src.documents.processor import ParsedChunk, sha256_hex


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _Settings:
    # Minimal subset used by process_document_job
    environment = "test"
    kafka_enabled = True


async def test_process_document_job_publishes_pipeline_events_when_kafka_enabled() -> None:
    data = b"Hello from Smart Drive"
    expected_sha = sha256_hex(data)

    doc_row = SimpleNamespace(
        id="doc_org_test_" + expected_sha,
        organization_id="org_test",
        title="Test Doc",
        file_name="notes.txt",
        mime_type="text/plain",
        byte_size=len(data),
        sha256=expected_sha,
        storage_path="drovi-documents/org_test/tmp",
        folder_path="/clients/acme",
        status="uploaded",
    )

    # First DB session: read doc row + mark processing + delete chunks.
    session1 = AsyncMock()
    result1 = MagicMock()
    result1.fetchone.return_value = doc_row
    session1.execute = AsyncMock(return_value=result1)
    session1.commit = AsyncMock()

    # Second DB session: insert chunks + mark processed.
    session2 = AsyncMock()
    session2.execute = AsyncMock(return_value=MagicMock())
    session2.commit = AsyncMock()

    sessions = [session1, session2]

    @asynccontextmanager
    async def fake_session():
        yield sessions.pop(0)

    fake_chunk = ParsedChunk(
        page_index=0,
        text="Hello from Smart Drive",
        layout_blocks=[{"text": "Hello from Smart Drive", "left": 0, "top": 0, "width": 10, "height": 10}],
        page_png_bytes=None,
    )

    producer = AsyncMock()
    producer.produce_pipeline_input = AsyncMock(return_value=None)

    with patch("src.documents.jobs.get_settings", return_value=_Settings()), patch(
        "src.documents.jobs.get_db_session", fake_session
    ), patch(
        "src.documents.jobs.get_object_bytes", AsyncMock(return_value=data)
    ), patch(
        "src.documents.jobs.parse_document_bytes",
        AsyncMock(return_value=("txt", None, [fake_chunk], {"file_type": "txt"})),
    ), patch(
        "src.documents.jobs.get_kafka_producer", AsyncMock(return_value=producer)
    ), patch(
        "src.jobs.outbox.enqueue_outbox_event", AsyncMock(return_value="evt_1")
    ):
        result = await process_document_job(organization_id="org_test", document_id=doc_row.id)

    assert result["document_id"] == doc_row.id
    assert result["pipeline_events_published"] == 1
    assert producer.produce_pipeline_input.await_count == 1


async def test_process_document_job_marks_failed_when_object_store_unavailable() -> None:
    data = b"Hello from Smart Drive"
    expected_sha = sha256_hex(data)

    doc_row = SimpleNamespace(
        id="doc_org_test_" + expected_sha,
        organization_id="org_test",
        title="Test Doc",
        file_name="notes.txt",
        mime_type="text/plain",
        byte_size=len(data),
        sha256=expected_sha,
        storage_path="drovi-documents/org_test/tmp",
        folder_path="/clients/acme",
        status="uploaded",
    )

    # Session 1: fetch doc + set processing.
    session1 = AsyncMock()
    result1 = MagicMock()
    result1.fetchone.return_value = doc_row
    session1.execute = AsyncMock(return_value=result1)
    session1.commit = AsyncMock()

    # Session 2: mark failed in exception path.
    session2 = AsyncMock()
    session2.execute = AsyncMock(return_value=MagicMock())
    session2.commit = AsyncMock()

    sessions = [session1, session2]

    @asynccontextmanager
    async def fake_session():
        yield sessions.pop(0)

    with patch("src.documents.jobs.get_settings", return_value=_Settings()), patch(
        "src.documents.jobs.get_db_session", fake_session
    ), patch(
        "src.documents.jobs.get_object_bytes", AsyncMock(side_effect=RuntimeError("s3_unreachable"))
    ), patch(
        "src.documents.jobs.emit_document_failed", AsyncMock(return_value=None)
    ) as emit_failed:
        with pytest.raises(RuntimeError, match="s3_unreachable"):
            await process_document_job(organization_id="org_test", document_id=doc_row.id)

    assert session2.execute.await_count == 1
    assert session2.commit.await_count == 1
    emit_failed.assert_awaited_once()
