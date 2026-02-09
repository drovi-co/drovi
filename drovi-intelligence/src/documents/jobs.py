"""Durable jobs for Smart Drive documents."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session
from src.db.rls import rls_context
from src.documents.processor import parse_document_bytes, sha256_hex
from src.documents.storage import (
    build_document_page_object_key,
    get_object_bytes,
    put_object_bytes,
)
from src.evidence.register import register_evidence_artifact
from src.ingestion.unified_event import build_content_hash, build_source_fingerprint
from src.search.embeddings import EmbeddingError, generate_embedding
from src.streaming.kafka_producer import get_kafka_producer

logger = structlog.get_logger()


def _now() -> datetime:
    return datetime.utcnow()


async def process_document_job(*, organization_id: str, document_id: str) -> dict[str, Any]:
    """
    Parse a document, store per-page chunks + page images, and enqueue extraction.

    This job is idempotent: it clears existing chunks and re-generates them.
    """
    settings = get_settings()
    started_at = _now()

    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            doc_row = (
                await session.execute(
                    text(
                        """
                        SELECT
                            id::text,
                            organization_id,
                            title,
                            file_name,
                            mime_type,
                            byte_size,
                            sha256,
                            storage_path,
                            folder_path,
                            status
                        FROM document
                        WHERE organization_id = :org_id AND id = :doc_id
                        """
                    ),
                    {"org_id": organization_id, "doc_id": document_id},
                )
            ).fetchone()

            if not doc_row:
                raise ValueError("Document not found")

            storage_path = str(getattr(doc_row, "storage_path"))
            file_name = str(getattr(doc_row, "file_name"))
            mime_type = getattr(doc_row, "mime_type", None)
            expected_sha = str(getattr(doc_row, "sha256"))
            folder_path = str(getattr(doc_row, "folder_path") or "/")

            # Mark processing and clear previous chunks for idempotency.
            await session.execute(
                text("UPDATE document SET status = 'processing', updated_at = NOW() WHERE id = :doc_id AND organization_id = :org_id"),
                {"doc_id": document_id, "org_id": organization_id},
            )
            await session.execute(
                text("DELETE FROM document_chunk WHERE document_id = :doc_id AND organization_id = :org_id"),
                {"doc_id": document_id, "org_id": organization_id},
            )
            await session.commit()

    # Download original bytes
    data = await get_object_bytes(key=storage_path)
    actual_sha = sha256_hex(data)
    if actual_sha != expected_sha:
        with rls_context(organization_id, is_internal=True):
            async with get_db_session() as session:
                await session.execute(
                    text("UPDATE document SET status = 'failed', updated_at = NOW() WHERE id = :doc_id AND organization_id = :org_id"),
                    {"doc_id": document_id, "org_id": organization_id},
                )
                await session.commit()
        raise ValueError("Document SHA256 mismatch after upload")

    # Parse + chunk
    file_type, page_count, chunks, meta = await parse_document_bytes(
        file_name=file_name,
        mime_type=mime_type,
        data=data,
    )

    # Graph: create/update document node (best-effort).
    try:
        if settings.environment != "test":
            from src.graph.client import get_graph_client

            graph = await get_graph_client()
            await graph.query(
                """
                MERGE (d:Document {id: $id, organizationId: $org})
                ON CREATE SET d.createdAt = $now
                SET d.updatedAt = $now,
                    d.title = $title,
                    d.fileName = $file_name,
                    d.fileType = $file_type,
                    d.sha256 = $sha256,
                    d.folderPath = $folder_path
                """,
                {
                    "id": document_id,
                    "org": organization_id,
                    "now": started_at.isoformat(),
                    "title": getattr(doc_row, "title", None),
                    "file_name": file_name,
                    "file_type": file_type,
                    "sha256": expected_sha,
                    "folder_path": folder_path,
                },
            )
    except Exception as exc:
        logger.warning("Failed to upsert Document node", error=str(exc))

    produced = 0
    embedded = 0

    producer = await get_kafka_producer() if settings.kafka_enabled else None

    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            for chunk_index, chunk in enumerate(chunks):
                raw_text = (chunk.text or "").strip()
                if not raw_text:
                    continue

                chunk_id = f"dch_{uuid4().hex}"

                # Upload page image (if present) and register as evidence.
                image_artifact_id = None
                if chunk.page_png_bytes:
                    image_sha = sha256_hex(chunk.page_png_bytes)
                    image_key = build_document_page_object_key(
                        organization_id=organization_id,
                        document_sha256=expected_sha,
                        page_index=int(chunk.page_index or 0),
                        image_sha256=image_sha,
                    )
                    await put_object_bytes(
                        key=image_key,
                        data=chunk.page_png_bytes,
                        content_type="image/png",
                    )
                    image_artifact_id = f"evh_{image_sha}"
                    try:
                        await register_evidence_artifact(
                            organization_id=organization_id,
                            artifact_id=image_artifact_id,
                            artifact_type="document_page",
                            mime_type="image/png",
                            storage_backend="s3",
                            storage_path=image_key,
                            byte_size=len(chunk.page_png_bytes),
                            sha256=image_sha,
                            metadata={
                                "kind": "smart_drive_document_page",
                                "document_id": document_id,
                                "page_index": int(chunk.page_index or 0),
                            },
                        )
                    except Exception as exc:
                        logger.warning("Failed to register page image evidence", error=str(exc))

                # Stable ingest hash for dedupe and traceability.
                fingerprint = build_source_fingerprint(
                    "document",
                    document_id,
                    document_id,
                    chunk_id,
                )
                content_hash = build_content_hash(raw_text, fingerprint)

                await session.execute(
                    text(
                        """
                        INSERT INTO document_chunk (
                            id, document_id, organization_id,
                            chunk_index, page_index,
                            text, content_hash,
                            layout_blocks, image_artifact_id,
                            created_at
                        ) VALUES (
                            :id, :document_id, :org_id,
                            :chunk_index, :page_index,
                            :text, :content_hash,
                            CAST(:layout_blocks AS jsonb), :image_artifact_id,
                            :now
                        )
                        """
                    ),
                    {
                        "id": chunk_id,
                        "document_id": document_id,
                        "org_id": organization_id,
                        "chunk_index": int(chunk_index),
                        "page_index": int(chunk.page_index) if chunk.page_index is not None else None,
                        "text": raw_text,
                        "content_hash": content_hash,
                        # document_chunk.layout_blocks is JSONB. Serialize explicitly for raw SQL.
                        "layout_blocks": json.dumps(chunk.layout_blocks or []),
                        "image_artifact_id": image_artifact_id,
                        "now": started_at,
                    },
                )

                # Graph chunk node + embedding (best-effort).
                try:
                    if settings.environment != "test":
                        from src.graph.client import get_graph_client

                        graph = await get_graph_client()
                        await graph.query(
                            """
                            MERGE (c:DocumentChunk {id: $id, organizationId: $org})
                            ON CREATE SET c.createdAt = $now
                            SET c.updatedAt = $now,
                                c.documentId = $document_id,
                                c.folderPath = $folder_path,
                                c.pageIndex = $page_index,
                                c.text = $text,
                                c.contentHash = $content_hash
                            """,
                            {
                                "id": chunk_id,
                                "org": organization_id,
                                "now": started_at.isoformat(),
                                "document_id": document_id,
                                "folder_path": folder_path,
                                "page_index": int(chunk.page_index) if chunk.page_index is not None else None,
                                "text": raw_text[:20000],  # prevent huge properties
                                "content_hash": content_hash,
                            },
                        )
                        await graph.query(
                            """
                            MATCH (c:DocumentChunk {id: $cid, organizationId: $org})
                            MATCH (d:Document {id: $did, organizationId: $org})
                            MERGE (c)-[:BELONGS_TO]->(d)
                            """,
                            {"cid": chunk_id, "did": document_id, "org": organization_id},
                        )

                        try:
                            embedding = await generate_embedding(raw_text[:8000])
                            await graph.query(
                                """
                                MATCH (c:DocumentChunk {id: $id, organizationId: $org})
                                SET c.embedding = vecf32($embedding)
                                """,
                                {"id": chunk_id, "org": organization_id, "embedding": embedding},
                            )
                            embedded += 1
                        except EmbeddingError:
                            pass
                except Exception as exc:
                    logger.debug("Failed to upsert DocumentChunk node", error=str(exc))

                # Enqueue extraction via Kafka pipeline input
                if producer:
                    try:
                        await producer.produce_pipeline_input(
                            organization_id=organization_id,
                            pipeline_id=chunk_id,
                            data={
                                "organization_id": organization_id,
                                "source_type": "document",
                                "content": raw_text,
                                "source_id": document_id,
                                "conversation_id": document_id,
                                "message_ids": [chunk_id],
                                "metadata": {
                                    "document_id": document_id,
                                    "file_name": file_name,
                                    "file_type": file_type,
                                    "page_index": int(chunk.page_index) if chunk.page_index is not None else None,
                                    "image_artifact_id": image_artifact_id,
                                },
                                "ingest": {
                                    "priority": "high",
                                    "content_hash": content_hash,
                                    "source_fingerprint": fingerprint,
                                    "job_type": "documents.process",
                                    "origin_ts": started_at.isoformat(),
                                },
                            },
                            priority="high",
                        )
                        produced += 1
                    except Exception as exc:
                        logger.warning("Failed to publish pipeline input for chunk", error=str(exc))

            await session.execute(
                text(
                    """
                    UPDATE document
                    SET status = 'processed',
                        page_count = :page_count,
                        metadata = CAST(:metadata AS jsonb),
                        processed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = :doc_id AND organization_id = :org_id
                    """
                ),
                {
                    "page_count": int(page_count) if page_count is not None else None,
                    # document.metadata is JSONB. Serialize explicitly for raw SQL.
                    "metadata": json.dumps({"parser": meta or {}, "file_type": file_type}),
                    "doc_id": document_id,
                    "org_id": organization_id,
                },
            )
            await session.commit()

    return {
        "document_id": document_id,
        "file_type": file_type,
        "page_count": page_count,
        "chunks_created": len(chunks),
        "pipeline_events_published": produced,
        "chunks_embedded": embedded,
        "duration_seconds": (_now() - started_at).total_seconds(),
    }
