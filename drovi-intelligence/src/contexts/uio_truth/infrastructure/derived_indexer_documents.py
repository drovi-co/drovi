"""Derived index processing for Smart Drive documents.

Phase 6 goal:
- Document parsing/chunking writes only canonical truth to Postgres + object store.
- Graph projections (Document/DocumentChunk nodes + embeddings) are built async
  via the outbox drain.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

import structlog

from src.config import get_settings
from src.db.client import get_db_pool
from src.db.rls import rls_context
from src.kernel.time import utc_now
from src.search.embeddings import EmbeddingError, generate_embeddings_batch

logger = structlog.get_logger()


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return None


def _embedding_text_hash(text: str, *, model: str) -> str:
    material = f"{model}:{text}".encode("utf-8", errors="ignore")
    return hashlib.sha256(material).hexdigest()


async def process_indexes_documents_processed_event(
    *,
    graph: Any,
    payload: dict[str, Any],
) -> dict[str, Any]:
    organization_id = str(payload.get("organization_id") or payload.get("org_id") or payload.get("orgId") or "")
    document_id = str(payload.get("document_id") or payload.get("doc_id") or "")
    if not organization_id or not document_id:
        raise ValueError("indexes.documents.processed payload missing organization_id/document_id")

    settings = get_settings()

    with rls_context(organization_id, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            doc_row = await conn.fetchrow(
                """
                SELECT
                    id::text,
                    title,
                    file_name,
                    file_type,
                    sha256,
                    folder_path,
                    created_at,
                    updated_at
                FROM document
                WHERE organization_id = $1 AND id = $2
                """,
                organization_id,
                document_id,
            )

            if not doc_row:
                # If the document was deleted between enqueue and processing, treat
                # this as success so we don't retry forever.
                return {"organization_id": organization_id, "document_id": document_id, "deleted": True}

            chunk_rows = await conn.fetch(
                """
                SELECT
                    id::text,
                    chunk_index,
                    page_index,
                    text,
                    content_hash,
                    image_artifact_id,
                    created_at
                FROM document_chunk
                WHERE organization_id = $1 AND document_id = $2
                ORDER BY chunk_index ASC
                """,
                organization_id,
                document_id,
            )

    doc = dict(doc_row)
    chunk_dicts = [dict(r) for r in (chunk_rows or [])]

    now = utc_now()
    now_iso = now.isoformat()

    # 1) Upsert Document node.
    await graph.query(
        """
        MERGE (d:Document {id: $id, organizationId: $orgId})
        ON CREATE SET d.createdAt = $createdAt
        SET d.updatedAt = $updatedAt,
            d.title = $title,
            d.fileName = $fileName,
            d.fileType = $fileType,
            d.sha256 = $sha256,
            d.folderPath = $folderPath
        """,
        {
            "id": str(doc["id"]),
            "orgId": organization_id,
            "createdAt": _iso(doc.get("created_at")) or now_iso,
            "updatedAt": _iso(doc.get("updated_at")) or now_iso,
            "title": doc.get("title"),
            "fileName": doc.get("file_name"),
            "fileType": doc.get("file_type"),
            "sha256": doc.get("sha256"),
            "folderPath": doc.get("folder_path") or "/",
        },
    )

    # 2) Clear any previous chunk projection for this document to avoid stale vector hits.
    #
    # This is necessary because early versions used random chunk IDs; even after switching
    # to deterministic chunk IDs we still want a stable cleanup step for safety.
    try:
        await graph.query(
            """
            MATCH (c:DocumentChunk {organizationId: $orgId, documentId: $docId})
            DETACH DELETE c
            """,
            {"orgId": organization_id, "docId": document_id},
        )
    except Exception as exc:
        logger.warning("Failed to clear old DocumentChunk nodes", error=str(exc), document_id=document_id)

    # 3) Upsert chunk nodes in batch (without embeddings).
    folder_path = str(doc.get("folder_path") or "/")
    chunk_nodes: list[dict[str, Any]] = []
    for r in chunk_dicts:
        text_value = str(r.get("text") or "")
        chunk_nodes.append(
            {
                "id": str(r.get("id")),
                "pageIndex": int(r.get("page_index")) if r.get("page_index") is not None else None,
                "text": text_value[:20000],
                "contentHash": str(r.get("content_hash") or ""),
                "imageArtifactId": str(r.get("image_artifact_id") or "") or None,
                "createdAt": _iso(r.get("created_at")) or now_iso,
                "updatedAt": now_iso,
                "folderPath": folder_path,
            }
        )

    if chunk_nodes:
        await graph.query(
            """
            UNWIND $rows AS row
            MERGE (c:DocumentChunk {id: row.id, organizationId: $orgId})
            ON CREATE SET c.createdAt = row.createdAt
            SET c.updatedAt = row.updatedAt,
                c.documentId = $docId,
                c.folderPath = row.folderPath,
                c.pageIndex = row.pageIndex,
                c.text = row.text,
                c.contentHash = row.contentHash,
                c.imageArtifactId = row.imageArtifactId
            WITH c
            MATCH (d:Document {id: $docId, organizationId: $orgId})
            MERGE (c)-[:BELONGS_TO]->(d)
            """,
            {"rows": chunk_nodes, "orgId": organization_id, "docId": document_id},
        )

    # 4) Best-effort embeddings (batched + idempotent via embeddingTextHash).
    #
    # We embed only the first N chars to bound cost and keep embeddings stable.
    # If embeddings fail, keyword search continues to work.
    embed_model = str(settings.embedding_model or "unknown")
    embed_inputs: list[tuple[str, str, str]] = []  # (chunk_id, text_for_embedding, hash)
    for r in chunk_dicts:
        chunk_id = str(r.get("id") or "")
        text_value = str(r.get("text") or "")
        text_for_embedding = text_value[:8000].strip()
        if not chunk_id or not text_for_embedding:
            continue
        embed_inputs.append(
            (
                chunk_id,
                text_for_embedding,
                _embedding_text_hash(text_for_embedding, model=embed_model),
            )
        )

    if not embed_inputs:
        return {"organization_id": organization_id, "document_id": document_id, "chunks_indexed": len(chunk_nodes)}

    # Query existing hashes so we only embed when changed.
    try:
        existing = await graph.query(
            """
            UNWIND $ids AS id
            MATCH (c:DocumentChunk {id: id, organizationId: $orgId})
            RETURN c.id AS id, c.embeddingTextHash AS embeddingTextHash
            """,
            {"ids": [cid for cid, _t, _h in embed_inputs], "orgId": organization_id},
        )
        existing_by_id: dict[str, str] = {
            str(row.get("id")): str(row.get("embeddingTextHash") or "")
            for row in (existing or [])
            if row.get("id")
        }
    except Exception:
        existing_by_id = {}

    to_embed: list[tuple[str, str, str]] = []
    for cid, text_value, text_hash in embed_inputs:
        if existing_by_id.get(cid) == text_hash:
            continue
        to_embed.append((cid, text_value, text_hash))

    embedded = 0
    if to_embed:
        batch_size = 64
        for start in range(0, len(to_embed), batch_size):
            batch = to_embed[start : start + batch_size]
            texts = [t for _cid, t, _h in batch]
            try:
                embeddings = await generate_embeddings_batch(texts)
            except (EmbeddingError, Exception) as exc:
                logger.warning("Failed to generate document chunk embeddings (batch)", error=str(exc))
                break

            rows = []
            for (cid, _t, text_hash), emb in zip(batch, embeddings):
                rows.append({"id": cid, "embedding": emb, "embeddingTextHash": text_hash})

            try:
                await graph.query(
                    """
                    UNWIND $rows AS row
                    MATCH (c:DocumentChunk {id: row.id, organizationId: $orgId})
                    SET c.embedding = vecf32(row.embedding),
                        c.embeddingTextHash = row.embeddingTextHash
                    """,
                    {"rows": rows, "orgId": organization_id},
                )
                embedded += len(rows)
            except Exception as exc:
                logger.warning("Failed to set DocumentChunk embeddings", error=str(exc))
                break

    return {
        "organization_id": organization_id,
        "document_id": document_id,
        "chunks_indexed": len(chunk_nodes),
        "chunks_embedded": embedded,
    }
