from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.documents.storage import MultipartUploadSession


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class TestDocumentUploads:
    async def test_create_upload_returns_presigned_session(self, async_client):
        # First DB session: "existing doc" query returns none.
        session1 = AsyncMock()
        result1 = MagicMock()
        result1.fetchone.return_value = None
        session1.execute = AsyncMock(return_value=result1)

        # Second DB session: inserts + commit.
        session2 = AsyncMock()
        session2.execute = AsyncMock(return_value=MagicMock())
        session2.commit = AsyncMock()

        sessions = [session1, session2]

        @asynccontextmanager
        async def fake_session():
            yield sessions.pop(0)

        payload = {
            "organization_id": "org_test",
            "file_name": "contract.pdf",
            "mime_type": "application/pdf",
            "byte_size": 12345,
            "sha256": "a" * 64,
            "title": "Client Contract",
            "folder_path": "/clients/acme",
            "tags": ["legal", "acme"],
        }

        with patch("src.api.routes.documents.get_db_session", fake_session), patch(
            "src.api.routes.documents.initiate_multipart_upload",
            AsyncMock(return_value=MultipartUploadSession(bucket="b", key="k", upload_id="u1")),
        ):
            resp = await async_client.post("/api/v1/documents/uploads", json=payload)

        assert resp.status_code == 200
        data = resp.json()
        assert data["document_id"] == f"doc_org_test_{'a' * 64}"
        assert data["upload_session_id"].startswith("upl_")
        assert data["multipart_upload_id"] == "u1"
        assert data["s3_key"] == "k"
        assert data["part_size_bytes"] == 8 * 1024 * 1024
        assert data["already_exists"] is False

    async def test_presign_parts_returns_urls(self, async_client):
        session = AsyncMock()
        row = SimpleNamespace(organization_id="org_test", s3_key="k", s3_upload_id="u1", status="initiated")
        result = MagicMock()
        result.fetchone.return_value = row
        session.execute = AsyncMock(return_value=result)

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("src.api.routes.documents.get_db_session", fake_session), patch(
            "src.api.routes.documents.presign_upload_part",
            AsyncMock(side_effect=lambda **kwargs: f"https://s3/upload?part={kwargs['part_number']}"),
        ):
            resp = await async_client.post(
                "/api/v1/documents/uploads/upl_test/parts",
                json={"part_numbers": [1, 2, 3]},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["upload_session_id"] == "upl_test"
        assert set(data["urls"].keys()) == {"1", "2", "3"}

    async def test_complete_upload_enqueues_processing_job(self, async_client):
        # First DB session: fetch upload row.
        session1 = AsyncMock()
        row = SimpleNamespace(
            organization_id="org_test",
            document_id="doc_org_test_" + ("a" * 64),
            s3_key="k",
            s3_upload_id="u1",
            status="initiated",
            expected_sha256="a" * 64,
            expected_byte_size=12345,
        )
        result1 = MagicMock()
        result1.fetchone.return_value = row
        session1.execute = AsyncMock(return_value=result1)

        # Second DB session: update rows + commit.
        session2 = AsyncMock()
        session2.execute = AsyncMock(return_value=MagicMock())
        session2.commit = AsyncMock()

        sessions = [session1, session2]

        @asynccontextmanager
        async def fake_session():
            yield sessions.pop(0)

        with patch("src.api.routes.documents.get_db_session", fake_session), patch(
            "src.api.routes.documents.complete_multipart_upload",
            AsyncMock(return_value=None),
        ), patch(
            "src.api.routes.documents.register_evidence_artifact",
            AsyncMock(return_value=None),
        ), patch(
            "src.api.routes.documents.enqueue_job",
            AsyncMock(return_value="job_123"),
        ):
            resp = await async_client.post(
                "/api/v1/documents/uploads/upl_test/complete",
                json={"parts": [{"part_number": 1, "etag": "\"etag1\""}]},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["document_id"] == "doc_org_test_" + ("a" * 64)
        assert data["queued_job_id"] == "job_123"
        assert data["status"] == "uploaded"

    async def test_reprocess_document_enqueues_job(self, async_client):
        # First DB session: document exists.
        session1 = AsyncMock()
        result1 = MagicMock()
        result1.fetchone.return_value = SimpleNamespace(id="doc_org_test_" + ("a" * 64))
        session1.execute = AsyncMock(return_value=result1)

        # Second DB session: no active job exists.
        session2 = AsyncMock()
        result2 = MagicMock()
        result2.fetchone.return_value = None
        session2.execute = AsyncMock(return_value=result2)

        sessions = [session1, session2]

        @asynccontextmanager
        async def fake_session():
            yield sessions.pop(0)

        with patch("src.api.routes.documents.get_db_session", fake_session), patch(
            "src.api.routes.documents.enqueue_job",
            AsyncMock(return_value="job_456"),
        ):
            resp = await async_client.post(
                f"/api/v1/documents/doc_org_test_{'a' * 64}/reprocess?organization_id=org_test",
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["document_id"] == "doc_org_test_" + ("a" * 64)
        assert data["queued_job_id"] == "job_456"

    async def test_reprocess_document_returns_existing_active_job(self, async_client):
        # First DB session: document exists.
        session1 = AsyncMock()
        result1 = MagicMock()
        result1.fetchone.return_value = SimpleNamespace(id="doc_org_test_" + ("a" * 64))
        session1.execute = AsyncMock(return_value=result1)

        # Second DB session: active queued/running job exists.
        session2 = AsyncMock()
        result2 = MagicMock()
        result2.fetchone.return_value = SimpleNamespace(id="job_existing")
        session2.execute = AsyncMock(return_value=result2)

        sessions = [session1, session2]

        @asynccontextmanager
        async def fake_session():
            yield sessions.pop(0)

        with patch("src.api.routes.documents.get_db_session", fake_session), patch(
            "src.api.routes.documents.enqueue_job",
            AsyncMock(side_effect=AssertionError("enqueue_job should not be called when active job exists")),
        ):
            resp = await async_client.post(
                f"/api/v1/documents/doc_org_test_{'a' * 64}/reprocess?organization_id=org_test",
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["document_id"] == "doc_org_test_" + ("a" * 64)
        assert data["queued_job_id"] == "job_existing"
