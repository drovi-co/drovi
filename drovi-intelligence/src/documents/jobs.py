"""Durable jobs for Smart Drive documents."""

from __future__ import annotations

import json
import hashlib
from datetime import datetime
from typing import Any

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
from src.documents.events import (
    emit_document_failed,
    emit_document_processing,
    emit_document_processed,
)
from src.evidence.register import register_evidence_artifact
from src.ingestion.unified_event import build_content_hash, build_source_fingerprint
from src.streaming.kafka_producer import get_kafka_producer

logger = structlog.get_logger()


def _now() -> datetime:
    return datetime.utcnow()


async def _mark_document_failed(
    *,
    organization_id: str,
    document_id: str,
    error: str,
) -> None:
    """Persist failed state for a document processing job."""
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE document
                    SET status = 'failed',
                        metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata_patch AS jsonb),
                        updated_at = NOW()
                    WHERE id = :doc_id AND organization_id = :org_id
                    """
                ),
                {
                    "doc_id": document_id,
                    "org_id": organization_id,
                    "metadata_patch": json.dumps(
                        {
                            "processing_error": str(error)[:2000],
                            "processing_failed_at": _now().isoformat(),
                        }
                    ),
                },
            )
            await session.commit()


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
    try:
        await emit_document_processing(
            organization_id=organization_id,
            document_id=document_id,
            file_name=file_name,
        )
    except Exception:
        pass

    try:
        # Download original bytes.
        data = await get_object_bytes(key=storage_path)
        actual_sha = sha256_hex(data)
        if actual_sha != expected_sha:
            raise ValueError("sha256_mismatch")

        # Parse + chunk
        file_type, page_count, chunks, meta = await parse_document_bytes(
            file_name=file_name,
            mime_type=mime_type,
            data=data,
        )

        produced = 0
        producer = await get_kafka_producer() if settings.kafka_enabled else None

        with rls_context(organization_id, is_internal=True):
            async with get_db_session() as session:
                for chunk_index, chunk in enumerate(chunks):
                    raw_text = (chunk.text or "").strip()
                    if not raw_text:
                        continue

                    # Use a deterministic chunk ID so re-processing does not leave stale
                    # graph/vector entries around. Chunk index is stable per parser output.
                    chunk_id = f"dch_{document_id}_{int(chunk_index)}"

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
                        # Evidence IDs must be unique across orgs (evidence_artifact.id is a PK).
                        image_artifact_id = f"evh_{organization_id}_{image_sha}"
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
                        organization_id,
                        document_id,
                        str(chunk.page_index) if chunk.page_index is not None else "",
                        str(chunk_index),
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

                    # Enqueue extraction via Kafka pipeline input.
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

        # Emit derived indexing outbox event (graph/vector). The processor will read
        # the canonical Postgres tables to build/refresh derived views.
        try:
            from src.jobs.outbox import EnqueueOutboxEventRequest, enqueue_outbox_event

            material = f"documents.processed:{organization_id}:{document_id}:{expected_sha}"
            idempotency_key = hashlib.sha256(material.encode("utf-8")).hexdigest()
            await enqueue_outbox_event(
                EnqueueOutboxEventRequest(
                    organization_id=organization_id,
                    event_type="indexes.documents.processed",
                    payload={"organization_id": organization_id, "document_id": document_id},
                    idempotency_key=idempotency_key,
                    payload_version=1,
                    priority=0,
                    max_attempts=10,
                )
            )
        except Exception as exc:
            logger.warning("Failed to enqueue document derived-index outbox event", error=str(exc))

        try:
            await emit_document_processed(
                organization_id=organization_id,
                document_id=document_id,
                file_name=file_name,
                page_count=int(page_count) if page_count is not None else None,
            )
        except Exception:
            pass

        return {
            "document_id": document_id,
            "file_type": file_type,
            "page_count": page_count,
            "chunks_created": len(chunks),
            "pipeline_events_published": produced,
            "duration_seconds": (_now() - started_at).total_seconds(),
        }
    except Exception as exc:
        await _mark_document_failed(
            organization_id=organization_id,
            document_id=document_id,
            error=str(exc),
        )
        try:
            await emit_document_failed(
                organization_id=organization_id,
                document_id=document_id,
                file_name=file_name,
                error=str(exc),
            )
        except Exception:
            pass
        raise
