from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone

import pytest

from src.db.client import get_db_pool, init_db
from src.db.rls import rls_context
from src.graph.client import get_graph_client
from src.jobs.outbox import EnqueueOutboxEventRequest, enqueue_outbox_event, mark_outbox_succeeded
from src.search.embeddings import get_embedding_dimension

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def _fake_embedding_for_text(text: str) -> list[float]:
    """
    Deterministic fake embedding for integration tests.

    This avoids real LLM calls while preserving:
    - stable dimensions
    - identical-text => identical vector (so vector search can work)
    """
    dim = int(get_embedding_dimension())
    digest = hashlib.sha256(text.encode("utf-8", errors="ignore")).digest()
    out: list[float] = []
    for i in range(dim):
        b = digest[i % len(digest)]
        out.append((float(b) - 128.0) / 128.0)
    return out


@pytest.mark.asyncio
async def test_outbox_documents_processed_builds_graph_projection(monkeypatch) -> None:
    """
    End-to-end (real services) test:
    - Write canonical document + chunks to Postgres
    - Enqueue outbox event
    - Run derived indexer
    - Verify graph nodes + embedding hashes exist

    This test is env-gated because it requires Postgres + FalkorDB running.
    Run with:
      DROVI_E2E_REAL_SERVICES=1 docker compose up -d postgres falkordb
      DROVI_E2E_REAL_SERVICES=1 docker compose run --rm drovi-intelligence pytest -q -m integration -k outbox_documents_processed
    """
    if os.environ.get("DROVI_E2E_REAL_SERVICES") != "1":
        pytest.skip("Requires real services. Set DROVI_E2E_REAL_SERVICES=1 to enable.")

    # Patch embeddings to avoid any external calls.
    async def _fake_generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
        return [_fake_embedding_for_text(t) for t in texts]

    monkeypatch.setattr(
        "src.contexts.uio_truth.infrastructure.derived_indexer_documents.generate_embeddings_batch",
        _fake_generate_embeddings_batch,
    )

    # Ensure DB is initialized (SQLAlchemy session factory) and asyncpg pool is available.
    await init_db()
    pool = await get_db_pool()

    org_id = "org_e2e_outbox_docs"
    sha = hashlib.sha256(b"e2e-doc").hexdigest()
    doc_id = f"doc_{org_id}_{sha}"

    now = datetime.now(timezone.utc)
    chunk_text_0 = "Drovi Smart Drive test chunk: payroll taxes and Q4 close."
    chunk_text_1 = "Drovi Smart Drive test chunk: legal advice timeline and contradictions."

    # Insert canonical truth rows (document + chunks).
    with rls_context(org_id, is_internal=True):
        async with pool.acquire() as conn:
            # Skip if migrations are not applied in this environment.
            has_document = await conn.fetchval("SELECT to_regclass('public.document') IS NOT NULL")
            has_chunk = await conn.fetchval("SELECT to_regclass('public.document_chunk') IS NOT NULL")
            has_outbox = await conn.fetchval("SELECT to_regclass('public.outbox_event') IS NOT NULL")
            if not (has_document and has_chunk and has_outbox):
                pytest.skip("DB schema not migrated (document/document_chunk/outbox_event missing).")

            await conn.execute("DELETE FROM document_chunk WHERE organization_id = $1 AND document_id = $2", org_id, doc_id)
            await conn.execute("DELETE FROM document WHERE organization_id = $1 AND id = $2", org_id, doc_id)
            await conn.execute("DELETE FROM outbox_event WHERE organization_id = $1", org_id)

            await conn.execute(
                """
                INSERT INTO document (
                    id, organization_id, title, file_name, file_type, mime_type,
                    byte_size, sha256, storage_backend, storage_path, status, folder_path,
                    created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11, $12,
                    $13, $14
                )
                """,
                doc_id,
                org_id,
                "E2E Smart Drive Doc",
                "e2e.pdf",
                "pdf",
                "application/pdf",
                1234,
                sha,
                "s3",
                f"drovi-documents/{org_id}/{sha}/e2e.pdf",
                "processed",
                "/",
                now,
                now,
            )

            await conn.execute(
                """
                INSERT INTO document_chunk (
                    id, document_id, organization_id,
                    chunk_index, page_index, text, content_hash, layout_blocks, created_at
                ) VALUES (
                    $1, $2, $3,
                    $4, $5, $6, $7, $8, $9
                )
                """,
                f"dch_{doc_id}_0",
                doc_id,
                org_id,
                0,
                0,
                chunk_text_0,
                hashlib.sha256(chunk_text_0.encode("utf-8")).hexdigest(),
                [],
                now,
            )
            await conn.execute(
                """
                INSERT INTO document_chunk (
                    id, document_id, organization_id,
                    chunk_index, page_index, text, content_hash, layout_blocks, created_at
                ) VALUES (
                    $1, $2, $3,
                    $4, $5, $6, $7, $8, $9
                )
                """,
                f"dch_{doc_id}_1",
                doc_id,
                org_id,
                1,
                1,
                chunk_text_1,
                hashlib.sha256(chunk_text_1.encode("utf-8")).hexdigest(),
                [],
                now,
            )

    # Prepare a clean graph scope for this org/doc.
    graph = await get_graph_client()
    await graph.initialize_indexes()
    # Clear any previous projections for this org/doc without relying on complex label predicates.
    await graph.query(
        "MATCH (n:Document {organizationId: $orgId}) DETACH DELETE n",
        {"orgId": org_id},
    )
    await graph.query(
        "MATCH (n:DocumentChunk {organizationId: $orgId}) DETACH DELETE n",
        {"orgId": org_id},
    )

    # Enqueue outbox event and process it.
    event_id = await enqueue_outbox_event(
        EnqueueOutboxEventRequest(
            organization_id=org_id,
            event_type="indexes.documents.processed",
            payload={"organization_id": org_id, "document_id": doc_id},
            idempotency_key=f"e2e:{org_id}:{doc_id}",
            payload_version=1,
            priority=9999,
            max_attempts=3,
        )
    )

    from src.contexts.uio_truth.infrastructure.derived_indexer import process_outbox_event

    await process_outbox_event(
        graph=graph,
        event_type="indexes.documents.processed",
        payload={"organization_id": org_id, "document_id": doc_id},
    )
    await mark_outbox_succeeded(event_id=event_id, worker_id="tests")

    # Verify graph projection exists.
    doc_rows = await graph.query(
        "MATCH (d:Document {id: $docId, organizationId: $orgId}) RETURN d",
        {"docId": doc_id, "orgId": org_id},
    )
    assert doc_rows, "Expected Document node to exist after derived indexing"

    chunk_rows = await graph.query(
        """
        MATCH (c:DocumentChunk {organizationId: $orgId, documentId: $docId})
        RETURN c.id AS id, c.embeddingTextHash AS embeddingTextHash
        ORDER BY c.id ASC
        """,
        {"orgId": org_id, "docId": doc_id},
    )
    assert len(chunk_rows) == 2
    assert all(str(r.get("embeddingTextHash") or "") for r in chunk_rows), "Expected embeddingTextHash to be set"

    # Best-effort: verify vector search can find the exact-text chunk.
    embedding = _fake_embedding_for_text(chunk_text_0[:8000].strip())
    hits = await graph.vector_search(label="DocumentChunk", embedding=embedding, organization_id=org_id, k=3)
    assert hits, "Expected vector_search hits for DocumentChunk (vector index missing or embeddings not set)"
    top = hits[0].get("node") or {}
    assert str(top.get("id")) == f"dch_{doc_id}_0"
