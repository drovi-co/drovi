from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.unit


class _FakeAcquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _FakeAcquire(self._conn)


class _FakeConn:
    def __init__(
        self,
        *,
        artifact_row,
        document_rows=None,
        chunk_rows=None,
        contradiction_rows=None,
        linked_event_count=0,
    ):
        self._artifact_row = artifact_row
        self._document_rows = document_rows or []
        self._chunk_rows = chunk_rows or []
        self._contradiction_rows = contradiction_rows or []
        self._linked_event_count = linked_event_count

    async def fetchrow(self, query, *args):
        return self._artifact_row

    async def fetch(self, query, *args):
        if "FROM document_chunk" in query:
            return self._chunk_rows
        if "FROM document" in query:
            return self._document_rows
        if "FROM uio_contradiction" in query:
            return self._contradiction_rows
        return []

    async def fetchval(self, query, *args):
        return self._linked_event_count


@pytest.mark.asyncio
async def test_evidence_indexer_projects_artifact_and_relationships():
    from src.contexts.uio_truth.infrastructure.derived_indexer_evidence import (
        process_indexes_evidence_artifact_registered_event,
    )

    conn = _FakeConn(
        artifact_row={
            "id": "artifact_1",
            "organization_id": "org_1",
            "session_id": "session_1",
            "source_type": "document",
            "source_id": "source_1",
            "artifact_type": "image",
            "mime_type": "image/png",
            "storage_backend": "s3",
            "storage_path": "s3://bucket/artifact_1",
            "byte_size": 1234,
            "sha256": "abc123",
            "metadata": {"page": 1},
            "created_at": datetime(2026, 2, 21, tzinfo=timezone.utc),
            "retention_until": None,
            "immutable": True,
            "legal_hold": False,
            "deleted_at": None,
        },
        document_rows=[{"id": "doc_1"}],
        chunk_rows=[{"id": "chunk_1", "document_id": "doc_1"}],
        contradiction_rows=[{"id": "ctr_1", "uio_a_id": "uio_1", "uio_b_id": "uio_2"}],
        linked_event_count=3,
    )
    graph = MagicMock()
    graph.query = AsyncMock(return_value=[])

    with patch("src.contexts.uio_truth.infrastructure.derived_indexer_evidence.get_db_pool", AsyncMock(return_value=_FakePool(conn))):
        result = await process_indexes_evidence_artifact_registered_event(
            graph=graph,
            payload={"organization_id": "org_1", "artifact_id": "artifact_1"},
        )

    assert result["ok"] is True
    assert result["linked_documents"] == 1
    assert result["linked_chunks"] == 1
    assert result["linked_contradictions"] == 1
    assert result["linked_uios"] == 2
    assert result["linked_events"] == 3

    assert graph.query.await_count >= 6
    first_query = graph.query.await_args_list[0].args[0]
    assert "MERGE (e:EvidenceArtifact" in first_query


@pytest.mark.asyncio
async def test_evidence_indexer_deletes_projection_for_missing_artifact():
    from src.contexts.uio_truth.infrastructure.derived_indexer_evidence import (
        process_indexes_evidence_artifact_registered_event,
    )

    conn = _FakeConn(artifact_row=None)
    graph = MagicMock()
    graph.query = AsyncMock(return_value=[])

    with patch("src.contexts.uio_truth.infrastructure.derived_indexer_evidence.get_db_pool", AsyncMock(return_value=_FakePool(conn))):
        result = await process_indexes_evidence_artifact_registered_event(
            graph=graph,
            payload={"organization_id": "org_1", "artifact_id": "artifact_missing"},
        )

    assert result["ok"] is True
    assert result["deleted"] is True
    assert graph.query.await_count == 1
    delete_query = graph.query.await_args_list[0].args[0]
    assert "DETACH DELETE e" in delete_query
