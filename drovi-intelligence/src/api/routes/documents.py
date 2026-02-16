"""Smart Drive Documents API.

Implements:
- multipart/resumable uploads (S3/R2/MinIO presigned URLs)
- parsed chunks with layout blocks for evidence highlighting
- semantic/keyword search over document chunks
"""

from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings
from src.db.client import get_db_session
from src.documents.events import (
    emit_document_failed,
    emit_document_uploaded,
    get_document_broadcaster,
)
from src.evidence.register import register_evidence_artifact
from src.jobs.queue import EnqueueJobRequest, enqueue_job
from src.documents.storage import (
    abort_multipart_upload,
    build_document_object_key,
    complete_multipart_upload,
    initiate_multipart_upload,
    presign_upload_part,
)
from src.kernel.errors import DroviError

logger = structlog.get_logger()

router = APIRouter(prefix="/documents", tags=["Documents"])


def _validate_org(ctx: APIKeyContext, organization_id: str) -> None:
    if not organization_id or organization_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")


def _validate_sha256(value: str) -> str:
    raw = (value or "").strip().lower()
    if len(raw) != 64 or any(c not in "0123456789abcdef" for c in raw):
        raise HTTPException(status_code=400, detail="sha256 must be a 64-char hex string")
    return raw


# -----------------------------------------------------------------------------
# Uploads
# -----------------------------------------------------------------------------


class DocumentUploadCreateRequest(BaseModel):
    organization_id: str | None = None
    file_name: str = Field(..., min_length=1, max_length=512)
    mime_type: str | None = Field(default=None, max_length=255)
    byte_size: int = Field(..., ge=1, le=1024 * 1024 * 1024 * 5)  # 5GB
    sha256: str = Field(..., min_length=64, max_length=64)
    title: str | None = Field(default=None, max_length=512)
    folder_path: str | None = Field(default="/", max_length=1024)
    tags: list[str] | None = None


class DocumentUploadCreateResponse(BaseModel):
    document_id: str
    upload_session_id: str | None = None
    multipart_upload_id: str | None = None
    s3_key: str | None = None
    part_size_bytes: int | None = None
    presign_expires_in: int
    already_exists: bool = False


@router.post("/uploads", response_model=DocumentUploadCreateResponse)
async def create_document_upload(
    request: DocumentUploadCreateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> DocumentUploadCreateResponse:
    settings = get_settings()
    org_id = request.organization_id or ctx.organization_id
    _validate_org(ctx, org_id)
    sha256 = _validate_sha256(request.sha256)

    # Document IDs must be unique across orgs (document.id is a PK). Keep them
    # deterministic for content-addressed dedupe within an org.
    document_id = f"doc_{org_id}_{sha256}"
    file_name = request.file_name.strip()
    mime_type = request.mime_type.strip() if request.mime_type else None
    folder_path = (request.folder_path or "/").strip() or "/"

    s3_key = build_document_object_key(
        organization_id=org_id,
        sha256=sha256,
        file_name=file_name,
    )

    # Choose a conservative part size for browser uploads.
    # S3 requires min 5MB parts (except last). We use 8MB.
    part_size_bytes = 8 * 1024 * 1024
    presign_expires_in = int(settings.evidence_s3_presign_expiry_seconds or 3600)

    async with get_db_session() as session:
        existing = (
            await session.execute(
                text(
                    """
                    SELECT id, status, storage_path
                    FROM document
                    WHERE organization_id = :org_id AND sha256 = :sha256
                    """
                ),
                {"org_id": org_id, "sha256": sha256},
            )
        ).fetchone()

        if existing and getattr(existing, "status", None) in ("uploading", "uploaded", "processing", "processed"):
            # Content-addressed dedupe: same bytes -> same document.
            return DocumentUploadCreateResponse(
                document_id=str(getattr(existing, "id")),
                presign_expires_in=presign_expires_in,
                already_exists=True,
            )

    # Initiate multipart upload (S3/R2/MinIO)
    mpu = await initiate_multipart_upload(key=s3_key, content_type=mime_type)

    upload_session_id = f"upl_{uuid4().hex}"
    now = datetime.utcnow()

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO document (
                    id, organization_id, title, file_name, file_type, mime_type,
                    byte_size, sha256, storage_backend, storage_path,
                    status, folder_path, tags, created_by_user_id,
                    created_at, updated_at
                ) VALUES (
                    :id, :org_id, :title, :file_name, :file_type, :mime_type,
                    :byte_size, :sha256, 's3', :storage_path,
                    'uploading', :folder_path, CAST(:tags AS jsonb), :created_by_user_id,
                    :now, :now
                )
                ON CONFLICT (organization_id, sha256)
                DO UPDATE SET
                    title = COALESCE(EXCLUDED.title, document.title),
                    file_name = EXCLUDED.file_name,
                    mime_type = EXCLUDED.mime_type,
                    byte_size = EXCLUDED.byte_size,
                    storage_path = EXCLUDED.storage_path,
                    status = 'uploading',
                    folder_path = EXCLUDED.folder_path,
                    tags = EXCLUDED.tags,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "id": document_id,
                "org_id": org_id,
                "title": request.title,
                "file_name": file_name,
                "file_type": file_name.split(".")[-1].lower() if "." in file_name else "unknown",
                "mime_type": mime_type,
                "byte_size": int(request.byte_size),
                "sha256": sha256,
                "storage_path": s3_key,
                "folder_path": folder_path,
                # The document.tags column is JSONB. When using raw SQL, we need to serialize
                # explicitly so asyncpg doesn't treat the parameter as text and fail encoding.
                "tags": json.dumps(request.tags or []),
                "created_by_user_id": getattr(ctx, "user_id", None),
                "now": now,
            },
        )

        await session.execute(
            text(
                """
                INSERT INTO document_upload (
                    id, document_id, organization_id, status,
                    s3_upload_id, s3_key, part_size_bytes,
                    expected_sha256, expected_byte_size,
                    created_at, updated_at
                ) VALUES (
                    :id, :document_id, :org_id, 'initiated',
                    :s3_upload_id, :s3_key, :part_size_bytes,
                    :expected_sha256, :expected_byte_size,
                    :now, :now
                )
                """
            ),
            {
                "id": upload_session_id,
                "document_id": document_id,
                "org_id": org_id,
                "s3_upload_id": mpu.upload_id,
                "s3_key": mpu.key,
                "part_size_bytes": part_size_bytes,
                "expected_sha256": sha256,
                "expected_byte_size": int(request.byte_size),
                "now": now,
            },
        )

        await session.commit()

    return DocumentUploadCreateResponse(
        document_id=document_id,
        upload_session_id=upload_session_id,
        multipart_upload_id=mpu.upload_id,
        s3_key=mpu.key,
        part_size_bytes=part_size_bytes,
        presign_expires_in=presign_expires_in,
        already_exists=False,
    )


class DocumentUploadPartsRequest(BaseModel):
    part_numbers: list[int] = Field(..., min_length=1, max_length=10000)


class DocumentUploadPartsResponse(BaseModel):
    upload_session_id: str
    urls: dict[int, str]


@router.post("/uploads/{upload_session_id}/parts", response_model=DocumentUploadPartsResponse)
async def presign_document_upload_parts(
    upload_session_id: str,
    request: DocumentUploadPartsRequest = Body(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> DocumentUploadPartsResponse:
    settings = get_settings()
    presign_expires_in = int(settings.evidence_s3_presign_expiry_seconds or 3600)

    async with get_db_session() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT organization_id, s3_key, s3_upload_id, status
                    FROM document_upload
                    WHERE id = :id
                    """
                ),
                {"id": upload_session_id},
            )
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Upload session not found")

    org_id = str(getattr(row, "organization_id"))
    _validate_org(ctx, org_id)

    if getattr(row, "status", None) not in ("initiated", "uploading"):
        raise HTTPException(status_code=409, detail="Upload session is not active")

    key = str(getattr(row, "s3_key"))
    upload_id = str(getattr(row, "s3_upload_id"))

    urls: dict[int, str] = {}
    for part_number in request.part_numbers:
        if part_number < 1:
            continue
        urls[int(part_number)] = await presign_upload_part(
            key=key,
            upload_id=upload_id,
            part_number=int(part_number),
            expires_in=presign_expires_in,
        )

    return DocumentUploadPartsResponse(upload_session_id=upload_session_id, urls=urls)


class DocumentUploadCompletePart(BaseModel):
    part_number: int = Field(..., ge=1)
    etag: str = Field(..., min_length=1, max_length=200)


class DocumentUploadCompleteRequest(BaseModel):
    parts: list[DocumentUploadCompletePart] = Field(..., min_length=1)


class DocumentUploadCompleteResponse(BaseModel):
    document_id: str
    queued_job_id: str | None = None
    status: str


class DocumentReprocessResponse(BaseModel):
    success: bool = True
    document_id: str
    queued_job_id: str


@router.post("/{document_id}/reprocess", response_model=DocumentReprocessResponse)
async def reprocess_document(
    document_id: str,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> DocumentReprocessResponse:
    """
    Re-run parsing + extraction for a previously uploaded document.

    This is the operator-friendly escape hatch when:
    - pipeline code changes (you want to re-extract),
    - an upstream outage occurred (retry),
    - you want to force a full backfill for a single doc.
    """
    org_id = organization_id or ctx.organization_id
    _validate_org(ctx, org_id)

    async with get_db_session() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id
                    FROM document
                    WHERE organization_id = :org_id AND id = :doc_id
                    """
                ),
                {"org_id": org_id, "doc_id": document_id},
            )
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")

    resource_key = f"documents:{org_id}:{document_id}"

    # If there's already a runnable job for this document, return it.
    # This allows safe "spam clicking" without permanently blocking future reprocesses.
    async with get_db_session() as session:
        active = (
            await session.execute(
                text(
                    """
                    SELECT id::text as id
                    FROM background_job
                    WHERE organization_id = :org_id
                      AND job_type = 'documents.process'
                      AND resource_key = :resource_key
                      AND status IN ('queued', 'running')
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {"org_id": org_id, "resource_key": resource_key},
            )
        ).fetchone()
        if active and getattr(active, "id", None):
            return DocumentReprocessResponse(
                success=True,
                document_id=document_id,
                queued_job_id=str(getattr(active, "id")),
            )

    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=org_id,
            job_type="documents.process",
            payload={
                "organization_id": org_id,
                "document_id": document_id,
            },
            priority=5,
            resource_key=resource_key,
        )
    )

    return DocumentReprocessResponse(
        success=True,
        document_id=document_id,
        queued_job_id=job_id,
    )


@router.post("/uploads/{upload_session_id}/complete", response_model=DocumentUploadCompleteResponse)
async def complete_document_upload(
    upload_session_id: str,
    request: DocumentUploadCompleteRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> DocumentUploadCompleteResponse:
    settings = get_settings()
    async with get_db_session() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT
                        id,
                        organization_id,
                        document_id,
                        status,
                        s3_key,
                        s3_upload_id,
                        expected_sha256,
                        expected_byte_size
                    FROM document_upload
                    WHERE id = :id
                    """
                ),
                {"id": upload_session_id},
            )
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Upload session not found")

    org_id = str(getattr(row, "organization_id"))
    _validate_org(ctx, org_id)

    if getattr(row, "status", None) in ("completed", "failed"):
        return DocumentUploadCompleteResponse(
            document_id=str(getattr(row, "document_id")),
            queued_job_id=None,
            status=str(getattr(row, "status")),
        )

    key = str(getattr(row, "s3_key"))
    upload_id = str(getattr(row, "s3_upload_id"))
    expected_sha256 = str(getattr(row, "expected_sha256"))
    expected_byte_size = int(getattr(row, "expected_byte_size") or 0)

    try:
        await complete_multipart_upload(
            key=key,
            upload_id=upload_id,
            parts=[p.model_dump() for p in request.parts],
        )
    except Exception as exc:
        logger.warning("Failed to complete multipart upload", upload_session_id=upload_session_id, error=str(exc))
        abort_failed = False
        try:
            await abort_multipart_upload(key=key, upload_id=upload_id)
        except Exception as abort_exc:
            abort_failed = True
            logger.warning(
                "Failed to abort multipart upload after completion failure",
                upload_session_id=upload_session_id,
                error=str(abort_exc),
            )
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE document_upload
                    SET status = 'failed', updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": upload_session_id},
            )
            await session.execute(
                text(
                    """
                    UPDATE document
                    SET status = 'failed', updated_at = NOW()
                    WHERE id = :doc_id AND organization_id = :org_id
                    """
                ),
                {"doc_id": str(getattr(row, "document_id")), "org_id": org_id},
            )
            await session.commit()
        try:
            await emit_document_failed(
                organization_id=org_id,
                document_id=str(getattr(row, "document_id")),
                error="upload_complete_failed",
            )
        except Exception:
            pass
        raise DroviError(
            code="documents.upload.complete_failed",
            message="Failed to complete upload",
            status_code=500,
            meta={"upload_session_id": str(upload_session_id), "abort_failed": abort_failed},
        ) from exc

    # Register the original file as an evidence artifact (content-addressed by SHA-256).
    # Evidence IDs must be unique across orgs (evidence_artifact.id is a PK).
    evidence_id = f"evh_{org_id}_{expected_sha256}"
    try:
        await register_evidence_artifact(
            organization_id=org_id,
            artifact_id=evidence_id,
            artifact_type="document_original",
            mime_type=None,
            storage_backend="s3",
            storage_path=key,
            byte_size=expected_byte_size or None,
            sha256=expected_sha256,
            metadata={
                "kind": "smart_drive_document",
                "document_id": str(getattr(row, "document_id")),
            },
            actor_type="user",
            actor_id=getattr(ctx, "user_id", None),
        )
    except Exception as exc:
        logger.warning("Failed to register evidence artifact for document", error=str(exc))

    # Enqueue processing job
    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=org_id,
            job_type="documents.process",
            payload={
                "organization_id": org_id,
                "document_id": str(getattr(row, "document_id")),
            },
            priority=5,
            idempotency_key=f"documents.process:{org_id}:{str(getattr(row, 'document_id'))}",
            resource_key=f"documents:{org_id}:{str(getattr(row, 'document_id'))}",
        )
    )

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE document_upload
                SET status = 'completed',
                    completed_at = NOW(),
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            {"id": upload_session_id},
        )
        await session.execute(
            text(
                """
                UPDATE document
                SET status = 'uploaded',
                    evidence_artifact_id = :evidence_id,
                    updated_at = NOW()
                WHERE id = :doc_id AND organization_id = :org_id
                """
            ),
            {"doc_id": str(getattr(row, "document_id")), "org_id": org_id, "evidence_id": evidence_id},
        )
        await session.commit()
    try:
        await emit_document_uploaded(
            organization_id=org_id,
            document_id=str(getattr(row, "document_id")),
            file_name=None,
        )
    except Exception:
        pass

    return DocumentUploadCompleteResponse(
        document_id=str(getattr(row, "document_id")),
        queued_job_id=job_id,
        status="uploaded",
    )


# -----------------------------------------------------------------------------
# Listing / chunks
# -----------------------------------------------------------------------------


class DocumentListItem(BaseModel):
    id: str
    title: str | None = None
    file_name: str
    mime_type: str | None = None
    byte_size: int | None = None
    sha256: str
    status: str
    folder_path: str
    tags: list[str] = Field(default_factory=list)
    page_count: int | None = None
    evidence_artifact_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DocumentListResponse(BaseModel):
    success: bool = True
    items: list[DocumentListItem] = Field(default_factory=list)
    cursor: str | None = None
    has_more: bool = False
    total: int | None = None


@router.get("/events")
async def stream_document_events(
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    org_id = organization_id or ctx.organization_id
    _validate_org(ctx, org_id)

    async def event_generator():
        yield {
            "event": "connected",
            "data": json.dumps({"organization_id": org_id}),
        }
        broadcaster = get_document_broadcaster()
        async for event in broadcaster.subscribe(org_id):
            yield {
                "event": event.event_type,
                "data": event.model_dump_json(),
            }

    return EventSourceResponse(event_generator())


def _encode_documents_cursor(created_at: datetime, document_id: str) -> str:
    payload = {
        "v": 1,
        "kind": "keyset",
        "created_at": created_at.isoformat(),
        "id": document_id,
    }
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def _decode_documents_cursor(cursor: str | None) -> tuple[datetime, str] | tuple[None, None]:
    if not cursor:
        return None, None
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except Exception:
        return None, None

    created_at = payload.get("created_at")
    item_id = payload.get("id")
    if not isinstance(created_at, str) or not isinstance(item_id, str):
        return None, None

    try:
        return datetime.fromisoformat(created_at), item_id
    except ValueError:
        return None, None


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    organization_id: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
    include_total: bool = False,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DocumentListResponse:
    org_id = organization_id or ctx.organization_id
    _validate_org(ctx, org_id)
    limit = max(1, min(int(limit), 200))
    cursor_created_at, cursor_id = _decode_documents_cursor(cursor)

    async with get_db_session() as session:
        where_clauses = ["organization_id = :org_id"]
        params: dict[str, Any] = {"org_id": org_id, "limit": limit + 1}
        if cursor_created_at and cursor_id:
            where_clauses.append(
                "(created_at < :cursor_created_at OR (created_at = :cursor_created_at AND id::text < :cursor_id))"
            )
            params["cursor_created_at"] = cursor_created_at
            params["cursor_id"] = cursor_id
        where_sql = " AND ".join(where_clauses)

        rows = (
            await session.execute(
                text(
                    """
                    SELECT
                        id::text,
                        title,
                        file_name,
                        mime_type,
                        byte_size,
                        sha256,
                        status,
                        folder_path,
                        tags,
                        page_count,
                        evidence_artifact_id,
                        created_at,
                        updated_at
                    FROM document
                    WHERE {where_sql}
                    ORDER BY created_at DESC, id DESC
                    LIMIT :limit
                    """.format(where_sql=where_sql)
                ),
                params,
            )
        ).fetchall()

        total: int | None = None
        if include_total:
            total_row = (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*) AS count
                        FROM document
                        WHERE organization_id = :org_id
                        """
                    ),
                    {"org_id": org_id},
                )
            ).fetchone()
            total = int(getattr(total_row, "count", 0) or 0)

    items: list[DocumentListItem] = []
    for row in rows[:limit]:
        items.append(
            DocumentListItem(
                id=str(row.id),
                title=getattr(row, "title", None),
                file_name=str(getattr(row, "file_name")),
                mime_type=getattr(row, "mime_type", None),
                byte_size=int(getattr(row, "byte_size")) if getattr(row, "byte_size", None) is not None else None,
                sha256=str(getattr(row, "sha256")),
                status=str(getattr(row, "status")),
                folder_path=str(getattr(row, "folder_path") or "/"),
                tags=list(getattr(row, "tags") or []),
                page_count=int(getattr(row, "page_count")) if getattr(row, "page_count", None) is not None else None,
                evidence_artifact_id=getattr(row, "evidence_artifact_id", None),
                created_at=getattr(row, "created_at", None),
                updated_at=getattr(row, "updated_at", None),
            )
        )

    has_more = len(rows) > limit
    next_cursor: str | None = None
    if has_more and items and items[-1].created_at:
        next_cursor = _encode_documents_cursor(items[-1].created_at, items[-1].id)

    return DocumentListResponse(
        success=True,
        items=items,
        cursor=next_cursor,
        has_more=has_more,
        total=total,
    )


class DocumentChunkListItem(BaseModel):
    id: str
    document_id: str
    chunk_index: int
    page_index: int | None = None
    snippet: str
    image_artifact_id: str | None = None


class DocumentChunksResponse(BaseModel):
    success: bool = True
    items: list[DocumentChunkListItem] = Field(default_factory=list)


@router.get("/{document_id}/chunks", response_model=DocumentChunksResponse)
async def list_document_chunks(
    document_id: str,
    organization_id: str | None = None,
    limit: int = 5000,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DocumentChunksResponse:
    org_id = organization_id or ctx.organization_id
    _validate_org(ctx, org_id)
    limit = max(1, min(int(limit), 10000))

    async with get_db_session() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT
                        id::text,
                        document_id::text,
                        chunk_index,
                        page_index,
                        text,
                        image_artifact_id
                    FROM document_chunk
                    WHERE organization_id = :org_id AND document_id = :doc_id
                    ORDER BY chunk_index ASC
                    LIMIT :limit
                    """
                ),
                {"org_id": org_id, "doc_id": document_id, "limit": limit},
            )
        ).fetchall()

    items: list[DocumentChunkListItem] = []
    for row in rows:
        full_text = str(getattr(row, "text") or "")
        cleaned = " ".join(full_text.strip().split())
        snippet = cleaned[:240] + ("..." if len(cleaned) > 240 else "")
        items.append(
            DocumentChunkListItem(
                id=str(row.id),
                document_id=str(getattr(row, "document_id")),
                chunk_index=int(getattr(row, "chunk_index") or 0),
                page_index=int(getattr(row, "page_index")) if getattr(row, "page_index", None) is not None else None,
                snippet=snippet,
                image_artifact_id=getattr(row, "image_artifact_id", None),
            )
        )

    return DocumentChunksResponse(success=True, items=items)


class DocumentChunkDetail(BaseModel):
    id: str
    document_id: str
    chunk_index: int
    page_index: int | None = None
    text: str
    layout_blocks: list[dict[str, Any]] = Field(default_factory=list)
    image_artifact_id: str | None = None


@router.get("/chunks/{chunk_id}", response_model=DocumentChunkDetail)
async def get_document_chunk(
    chunk_id: str,
    organization_id: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DocumentChunkDetail:
    org_id = organization_id or ctx.organization_id
    _validate_org(ctx, org_id)

    async with get_db_session() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT
                        id::text,
                        document_id::text,
                        chunk_index,
                        page_index,
                        text,
                        layout_blocks,
                        image_artifact_id
                    FROM document_chunk
                    WHERE organization_id = :org_id AND id = :id
                    """
                ),
                {"org_id": org_id, "id": chunk_id},
            )
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Chunk not found")

    return DocumentChunkDetail(
        id=str(row.id),
        document_id=str(getattr(row, "document_id")),
        chunk_index=int(getattr(row, "chunk_index") or 0),
        page_index=int(getattr(row, "page_index")) if getattr(row, "page_index", None) is not None else None,
        text=str(getattr(row, "text") or ""),
        layout_blocks=list(getattr(row, "layout_blocks") or []),
        image_artifact_id=getattr(row, "image_artifact_id", None),
    )


# -----------------------------------------------------------------------------
# Search / Ask
# -----------------------------------------------------------------------------


class DocumentSearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)
    organization_id: str | None = None
    folder_prefix: str | None = Field(default=None, max_length=1024)
    limit: int = Field(default=20, ge=1, le=50)


class DocumentSearchHit(BaseModel):
    chunk_id: str
    document_id: str
    file_name: str
    title: str | None = None
    folder_path: str
    page_index: int | None = None
    snippet: str
    score: float | None = None


class DocumentSearchResponse(BaseModel):
    success: bool = True
    results: list[DocumentSearchHit] = Field(default_factory=list)


@router.post("/search", response_model=DocumentSearchResponse)
async def search_documents(
    request: DocumentSearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DocumentSearchResponse:
    org_id = request.organization_id or ctx.organization_id
    _validate_org(ctx, org_id)

    q = request.query.strip()
    folder_prefix = (request.folder_prefix or "").strip()

    results: list[DocumentSearchHit] = []
    seen: set[str] = set()

    # Semantic retrieval (best-effort): graph vector search over DocumentChunk nodes.
    try:
        from src.search.embeddings import generate_embedding, EmbeddingError
        from src.graph.client import get_graph_client

        embedding = await generate_embedding(q)
        graph = await get_graph_client()
        vector_rows = await graph.vector_search(
            label="DocumentChunk",
            embedding=embedding,
            organization_id=org_id,
            k=int(request.limit) * 2,
        )

        scored_ids: list[tuple[str, float]] = []
        for row in vector_rows or []:
            node = row.get("node") or {}
            chunk_id = node.get("id")
            if not chunk_id:
                continue
            try:
                score = float(row.get("score") or 0.0)
            except Exception:
                score = 0.0
            scored_ids.append((str(chunk_id), score))

        if scored_ids:
            # Hydrate from Postgres for file/title + stable snippets.
            chunk_ids = [cid for cid, _score in scored_ids[: int(request.limit) * 2]]
            placeholders = ", ".join([f":id_{i}" for i in range(len(chunk_ids))])
            params: dict[str, Any] = {"org_id": org_id, "folder_prefix": folder_prefix, "folder_like": f"{folder_prefix}%"}
            params.update({f"id_{i}": chunk_ids[i] for i in range(len(chunk_ids))})

            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        text(
                            f"""
                            SELECT
                                dc.id::text as chunk_id,
                                dc.document_id::text as document_id,
                                dc.page_index,
                                dc.text,
                                d.file_name,
                                d.title,
                                d.folder_path
                            FROM document_chunk dc
                            JOIN document d
                              ON d.id = dc.document_id AND d.organization_id = dc.organization_id
                            WHERE dc.organization_id = :org_id
                              AND dc.id IN ({placeholders})
                              AND (:folder_prefix = '' OR d.folder_path ILIKE :folder_like)
                            """
                        ),
                        params,
                    )
                ).fetchall()

            row_map: dict[str, Any] = {str(getattr(r, "chunk_id")): r for r in rows}
            score_map: dict[str, float] = {cid: score for cid, score in scored_ids}

            for chunk_id, score in sorted(scored_ids, key=lambda pair: pair[1], reverse=True):
                row = row_map.get(chunk_id)
                if not row or chunk_id in seen:
                    continue
                full_text = str(getattr(row, "text") or "")
                cleaned = " ".join(full_text.strip().split())
                snippet = cleaned[:320] + ("..." if len(cleaned) > 320 else "")
                results.append(
                    DocumentSearchHit(
                        chunk_id=str(getattr(row, "chunk_id")),
                        document_id=str(getattr(row, "document_id")),
                        file_name=str(getattr(row, "file_name")),
                        title=getattr(row, "title", None),
                        folder_path=str(getattr(row, "folder_path") or "/"),
                        page_index=int(getattr(row, "page_index")) if getattr(row, "page_index", None) is not None else None,
                        snippet=snippet,
                        score=float(score_map.get(chunk_id) or 0.0),
                    )
                )
                seen.add(chunk_id)
                if len(results) >= int(request.limit):
                    break
    except Exception:
        # Semantic search is optional; fall back to keyword search below.
        pass

    # Keyword fallback (always available).
    async with get_db_session() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT
                        dc.id::text as chunk_id,
                        dc.document_id::text as document_id,
                        dc.page_index,
                        dc.text,
                        d.file_name,
                        d.title,
                        d.folder_path
                    FROM document_chunk dc
                    JOIN document d
                      ON d.id = dc.document_id AND d.organization_id = dc.organization_id
                    WHERE dc.organization_id = :org_id
                      AND dc.text ILIKE :q
                      AND (:folder_prefix = '' OR d.folder_path ILIKE :folder_like)
                    ORDER BY dc.page_index ASC NULLS LAST, dc.chunk_index ASC
                    LIMIT :limit
                    """
                ),
                {
                    "org_id": org_id,
                    "q": f"%{q}%",
                    "folder_prefix": folder_prefix,
                    "folder_like": f"{folder_prefix}%",
                    "limit": int(request.limit),
                },
            )
        ).fetchall()

    for row in rows:
        if str(getattr(row, "chunk_id")) in seen:
            continue
        full_text = str(getattr(row, "text") or "")
        cleaned = " ".join(full_text.strip().split())
        snippet = cleaned[:320] + ("..." if len(cleaned) > 320 else "")
        results.append(
            DocumentSearchHit(
                chunk_id=str(getattr(row, "chunk_id")),
                document_id=str(getattr(row, "document_id")),
                file_name=str(getattr(row, "file_name")),
                title=getattr(row, "title", None),
                folder_path=str(getattr(row, "folder_path") or "/"),
                page_index=int(getattr(row, "page_index")) if getattr(row, "page_index", None) is not None else None,
                snippet=snippet,
                score=None,
            )
        )
        seen.add(str(getattr(row, "chunk_id")))

    return DocumentSearchResponse(success=True, results=results)


class DriveAskRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=1000)
    organization_id: str | None = None
    folder_prefix: str | None = None
    limit: int = Field(default=8, ge=1, le=12)


class DriveAskResponse(BaseModel):
    success: bool = True
    answer: str
    sources: list[DocumentSearchHit] = Field(default_factory=list)


@router.post("/ask", response_model=DriveAskResponse)
async def ask_drive_folder(
    request: DriveAskRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DriveAskResponse:
    org_id = request.organization_id or ctx.organization_id
    _validate_org(ctx, org_id)

    # Retrieve evidence-first chunks.
    hits = (
        await search_documents(
            DocumentSearchRequest(
                query=request.question,
                organization_id=org_id,
                folder_prefix=request.folder_prefix,
                limit=int(request.limit),
            ),
            ctx,
        )
    ).results

    if not hits:
        return DriveAskResponse(
            success=True,
            answer="I don't have evidence in this folder to answer that yet.",
            sources=[],
        )

    # Best-effort synthesis: if no LLM keys are configured, return a proof-first summary.
    try:
        from src.llm.service import get_llm_service

        service = get_llm_service()
        evidence = "\n\n".join(
            [
                f"[{i+1}] {h.file_name} (page {h.page_index if h.page_index is not None else 'n/a'}):\n{h.snippet}"
                for i, h in enumerate(hits)
            ]
        )
        system = (
            "You are Drovi. Answer using only the provided evidence. "
            "If evidence does not support an answer, say you don't know. "
            "Cite sources as [1], [2], ... inline."
        )
        user = f"Question: {request.question}\n\nEvidence:\n{evidence}"
        answer, _call = await service.complete(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            model_tier="balanced",
            temperature=0.0,
            max_tokens=800,
            node_name="drive.ask",
        )
        final_answer = answer.strip() or "No answer."
    except Exception:
        final_answer = "Evidence found:\n" + "\n".join([f"- [{i+1}] {h.file_name} (chunk {h.chunk_id})" for i, h in enumerate(hits)])

    return DriveAskResponse(success=True, answer=final_answer, sources=hits)
