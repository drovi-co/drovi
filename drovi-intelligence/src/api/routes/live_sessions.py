"""
Live Session Ingestion API

Handles live meeting/call ingestion, transcript segments, and audio chunks.
"""

from __future__ import annotations

from typing import Any, Literal
from datetime import datetime
from uuid import uuid4

import structlog
import asyncio
import json
import time

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from prometheus_client import Counter, Histogram

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.api_key import validate_api_key
from src.db.rls import set_rls_context
from src.config import get_settings
from src.db.client import get_db_session
from sqlalchemy import text
from src.auth.scopes import Scope
from src.ingestion.live_sessions import (
    add_transcript_segment,
    build_transcript_text,
    create_live_session,
    finalize_live_session,
    get_artifact_presigned_url,
    get_transcript_segments_since,
    link_session_transcripts_to_uios,
    store_audio_chunk,
    transcribe_audio_to_segments,
)
from src.compliance.dlp import sanitize_text
from src.audit.log import record_audit_event
from src.orchestrator.graph import compile_intelligence_graph
from src.orchestrator.state import AnalysisInput, IntelligenceState

logger = structlog.get_logger()

STREAMING_BACKPRESSURE = Counter(
    "drovi_streaming_backpressure_total",
    "Total streaming backpressure events",
)
STREAMING_LATENCY = Histogram(
    "drovi_streaming_latency_seconds",
    "Live session streaming latency in seconds",
    ["org_id", "type"],
    buckets=[0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
)
STREAMING_DROPPED = Counter(
    "drovi_streaming_dropped_total",
    "Dropped streaming messages",
    ["org_id", "reason"],
)

router = APIRouter(prefix="/ingest/live-session", tags=["Live Sessions"])


class LiveSessionStartRequest(BaseModel):
    organization_id: str
    session_type: Literal["meeting", "call", "recording"] = Field(default="meeting")
    title: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    participants: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    consent_provided: bool = Field(default=False)
    region: str | None = None


class LiveSessionStartResponse(BaseModel):
    session_id: str
    status: str


class TranscriptSegmentRequest(BaseModel):
    organization_id: str
    speaker_label: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    text: str
    confidence: float | None = None
    speaker_contact_id: str | None = None
    run_intelligence: bool = Field(default=False)


class LiveSessionEndRequest(BaseModel):
    organization_id: str
    run_intelligence: bool = True
    source_type: Literal["meeting", "call", "recording"] = "meeting"
    source_id: str | None = None


class LiveSessionEndResponse(BaseModel):
    status: str
    transcript_length: int


class DecisionRadarItem(BaseModel):
    """Decision radar candidate detected during a live session."""

    id: str
    title: str | None = None
    content: str | None = None
    evidence_text: str | None = None
    confidence: float | None = None
    source_message_id: str | None = None
    created_at: datetime


class DecisionRadarConfirmResponse(BaseModel):
    status: str
    candidate_id: str
    uio_id: str | None = None


class DecisionRadarDismissResponse(BaseModel):
    status: str
    candidate_id: str


@router.post("/start", response_model=LiveSessionStartResponse)
async def start_live_session(
    request: LiveSessionStartRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    from src.config import get_settings

    settings = get_settings()
    region = (request.region or settings.compliance_default_region).upper()
    blocked_regions = {r.upper() for r in settings.compliance_blocked_regions}
    if region in blocked_regions:
        raise HTTPException(status_code=400, detail="Recording not allowed in this region")

    if settings.compliance_recording_consent_required and not request.consent_provided:
        raise HTTPException(status_code=400, detail="Recording consent required")

    session = await create_live_session(
        organization_id=request.organization_id,
        session_type=request.session_type,
        title=request.title,
        source_type=request.source_type,
        source_id=request.source_id,
        participants=request.participants,
        metadata={
            **request.metadata,
            "consent_provided": request.consent_provided,
            "region": region,
        },
    )

    await record_audit_event(
        organization_id=request.organization_id,
        action="live_session_started",
        actor_type="api_key" if ctx.key_id else "internal",
        actor_id=ctx.key_id,
        resource_type="live_session",
        resource_id=session.id,
    )

    return LiveSessionStartResponse(session_id=session.id, status=session.status)


@router.post("/{session_id}/transcript")
async def ingest_transcript_segment(
    session_id: str,
    request: TranscriptSegmentRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    speaker_contact_id = request.speaker_contact_id
    if speaker_contact_id is None and request.speaker_label:
        from src.identity.speaker_resolution import resolve_speaker_contact_id

        speaker_contact_id = await resolve_speaker_contact_id(
            request.organization_id,
            request.speaker_label,
        )

    sanitized_text, _redactions = sanitize_text(request.text)
    settings = get_settings()
    segment_id = await add_transcript_segment(
        session_id=session_id,
        speaker_label=request.speaker_label,
        start_ms=request.start_ms,
        end_ms=request.end_ms,
        text_value=sanitized_text,
        confidence=request.confidence,
        speaker_contact_id=speaker_contact_id,
        publish_pipeline=bool(request.run_intelligence and settings.kafka_enabled),
        candidate_only=True,
    )

    if request.run_intelligence and sanitized_text.strip() and not settings.kafka_enabled:
        graph = compile_intelligence_graph()
        initial_state = IntelligenceState(
            input=AnalysisInput(
                organization_id=request.organization_id,
                content=sanitized_text,
                source_type="meeting",
                source_id=session_id,
                conversation_id=session_id,
                candidate_only=True,
            )
        )
        try:
            await graph.ainvoke(initial_state)
        except Exception as exc:
            logger.error("Partial intelligence failed", error=str(exc))

    return {"segment_id": segment_id}


@router.post("/{session_id}/audio")
async def ingest_audio_chunk(
    session_id: str,
    organization_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    transcribe: bool = True,
    diarize: bool = False,
    language: str | None = None,
    chunk_index: int | None = None,
    run_intelligence: bool = False,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    data = await file.read()

    artifact_id = await store_audio_chunk(
        organization_id=organization_id,
        session_id=session_id,
        data=data,
        mime_type=file.content_type,
        chunk_index=chunk_index,
    )

    file_suffix = ".wav"
    if file.content_type == "audio/m4a":
        file_suffix = ".m4a"
    elif file.content_type == "audio/mpeg":
        file_suffix = ".mp3"

    if transcribe:
        background_tasks.add_task(
            transcribe_audio_to_segments,
            session_id,
            organization_id,
            data,
            language,
            diarize,
            file_suffix,
            run_intelligence,
        )

    return {"artifact_id": artifact_id}


@router.post("/{session_id}/end", response_model=LiveSessionEndResponse)
async def end_live_session(
    session_id: str,
    request: LiveSessionEndRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    await finalize_live_session(session_id=session_id, status="completed")

    transcript_text = await build_transcript_text(session_id)

    await record_audit_event(
        organization_id=request.organization_id,
        action="live_session_completed",
        actor_type="api_key" if ctx.key_id else "internal",
        actor_id=ctx.key_id,
        resource_type="live_session",
        resource_id=session_id,
    )

    settings = get_settings()
    if request.run_intelligence and transcript_text.strip() and settings.kafka_enabled:
        try:
            from src.streaming.kafka_producer import get_kafka_producer
            from src.ingestion.unified_event import build_content_hash, build_source_fingerprint
            from src.ingestion.priority import compute_ingest_priority
            from src.streaming.ingestion_pipeline import PipelineInputEvent

            producer = await get_kafka_producer()
            source_type = request.source_type
            source_id = request.source_id or session_id
            fingerprint = build_source_fingerprint(source_type, source_id, session_id, session_id)
            content_hash = build_content_hash(transcript_text, fingerprint)
            ingest = {
                "content_hash": content_hash,
                "source_fingerprint": fingerprint,
                "priority": compute_ingest_priority(
                    source_type=source_type,
                    job_type="on_demand",
                    explicit_priority="high",
                ),
                "job_type": "live_session",
            }
            pipeline_event = PipelineInputEvent(
                pipeline_id=str(uuid4()),
                organization_id=request.organization_id,
                source_type=source_type,
                source_id=source_id,
                content=transcript_text,
                metadata={"session_id": session_id, "final_transcript": True},
                conversation_id=session_id,
                message_ids=[session_id],
                user_email=None,
                user_name=None,
                candidate_only=False,
                is_partial=False,
                ingest=ingest,
                enrichment={},
            )
            await producer.produce_pipeline_input(
                organization_id=request.organization_id,
                pipeline_id=pipeline_event.pipeline_id,
                data=pipeline_event.to_payload(),
                priority=ingest.get("priority"),
            )
        except Exception as exc:
            logger.error("Failed to enqueue transcript pipeline input", error=str(exc))

    if request.run_intelligence and transcript_text.strip() and not settings.kafka_enabled:
        graph = compile_intelligence_graph()
        initial_state = IntelligenceState(
            input=AnalysisInput(
                organization_id=request.organization_id,
                content=transcript_text,
                source_type=request.source_type,
                source_id=request.source_id or session_id,
                conversation_id=session_id,
            )
        )
        try:
            await graph.ainvoke(initial_state)
        except Exception as exc:
            logger.error("Failed to run intelligence on transcript", error=str(exc))
        try:
            await link_session_transcripts_to_uios(session_id)
        except Exception as exc:
            logger.error("Failed to link transcript segments to UIOs", error=str(exc))

    return LiveSessionEndResponse(status="completed", transcript_length=len(transcript_text))


@router.get("/{session_id}/transcript")
async def get_transcript_text(
    session_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    transcript_text = await build_transcript_text(session_id)
    return {"session_id": session_id, "text": transcript_text}


@router.get("/{session_id}/decision-radar", response_model=list[DecisionRadarItem])
async def list_decision_radar(
    session_id: str,
    organization_id: str,
    limit: int = 50,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List pending decision radar candidates for a live session."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, title, content, evidence_text, confidence,
                       source_message_id, created_at
                FROM signal_candidate
                WHERE organization_id = :org_id
                  AND conversation_id = :session_id
                  AND candidate_type = 'decision'
                  AND status = 'pending_confirmation'
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"org_id": organization_id, "session_id": session_id, "limit": limit},
        )
        rows = result.fetchall()

    return [
        DecisionRadarItem(
            id=row.id,
            title=row.title,
            content=row.content,
            evidence_text=row.evidence_text,
            confidence=row.confidence,
            source_message_id=row.source_message_id,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/{session_id}/decision-radar/stream")
async def stream_decision_radar(
    session_id: str,
    organization_id: str,
    poll_interval: float = 1.0,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Stream decision radar candidates as they arrive."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    async def event_stream():
        cursor_time = None
        while True:
            try:
                async with get_db_session() as session:
                    result = await session.execute(
                        text(
                            """
                            SELECT id, title, content, evidence_text, confidence,
                                   source_message_id, created_at
                            FROM signal_candidate
                            WHERE organization_id = :org_id
                              AND conversation_id = :session_id
                              AND candidate_type = 'decision'
                              AND status = 'pending_confirmation'
                              AND (:cursor_time IS NULL OR created_at > :cursor_time)
                            ORDER BY created_at ASC
                            LIMIT 50
                            """
                        ),
                        {
                            "org_id": organization_id,
                            "session_id": session_id,
                            "cursor_time": cursor_time,
                        },
                    )
                    rows = result.fetchall()

                if rows:
                    cursor_time = rows[-1].created_at
                    payload = [
                        {
                            "id": row.id,
                            "title": row.title,
                            "content": row.content,
                            "evidence_text": row.evidence_text,
                            "confidence": row.confidence,
                            "source_message_id": row.source_message_id,
                            "created_at": row.created_at,
                        }
                        for row in rows
                    ]
                    yield {
                        "event": "decision_radar",
                        "data": json.dumps(payload, default=str),
                    }

                await asyncio.sleep(poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Decision radar stream error", error=str(exc))
                await asyncio.sleep(poll_interval)

    return EventSourceResponse(event_stream())


@router.post("/{session_id}/decision-radar/{candidate_id}/confirm", response_model=DecisionRadarConfirmResponse)
async def confirm_decision_radar(
    session_id: str,
    candidate_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Confirm a decision radar candidate and materialize the decision UIO."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, status
                FROM signal_candidate
                WHERE id = :id
                  AND organization_id = :org_id
                  AND conversation_id = :session_id
                  AND candidate_type = 'decision'
                """
            ),
            {"id": candidate_id, "org_id": organization_id, "session_id": session_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Decision candidate not found")

    from src.candidates.processor import process_signal_candidate_by_id

    result = await process_signal_candidate_by_id(
        candidate_id=candidate_id,
        organization_id=organization_id,
        confirmed_by=ctx.key_id,
    )

    return DecisionRadarConfirmResponse(
        status=result["status"] or "processed",
        candidate_id=candidate_id,
        uio_id=result.get("uio_id"),
    )


@router.post("/{session_id}/decision-radar/{candidate_id}/dismiss", response_model=DecisionRadarDismissResponse)
async def dismiss_decision_radar(
    session_id: str,
    candidate_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """Dismiss a decision radar candidate."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                UPDATE signal_candidate
                SET status = 'dismissed',
                    updated_at = NOW(),
                    processing_error = 'dismissed_by_user'
                WHERE id = :id
                  AND organization_id = :org_id
                  AND conversation_id = :session_id
                  AND candidate_type = 'decision'
                """
            ),
            {"id": candidate_id, "org_id": organization_id, "session_id": session_id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Decision candidate not found")
        await session.commit()

    return DecisionRadarDismissResponse(status="dismissed", candidate_id=candidate_id)


@router.get("/{session_id}/transcript/stream")
async def stream_transcript_segments(
    session_id: str,
    organization_id: str,
    poll_interval: float = 1.0,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    async def event_stream():
        cursor_time = None
        while True:
            try:
                segments = await get_transcript_segments_since(session_id, cursor_time)
                if segments:
                    cursor_time = segments[-1]["created_at"]
                    yield {
                        "event": "segment",
                        "data": json.dumps(segments, default=str),
                    }
                await asyncio.sleep(poll_interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Transcript stream error", error=str(exc))
                await asyncio.sleep(poll_interval)

    return EventSourceResponse(event_stream())


@router.websocket("/{session_id}/stream")
async def stream_live_session(ws: WebSocket, session_id: str):
    await ws.accept()
    settings = get_settings()

    api_key = ws.headers.get("x-api-key")
    key_info = await validate_api_key(api_key) if api_key else None
    if not key_info:
        await ws.close(code=4401)
        return

    set_rls_context(key_info.organization_id, is_internal=False)

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT organization_id
                FROM live_session
                WHERE id = :session_id
                """
            ),
            {"session_id": session_id},
        )
        row = result.fetchone()
        if not row or row.organization_id != key_info.organization_id:
            await ws.close(code=4403)
            return

    queue: asyncio.PriorityQueue = asyncio.PriorityQueue(
        maxsize=settings.streaming_queue_size
    )

    async def _worker() -> None:
        while True:
            priority, payload = await queue.get()
            try:
                msg_type = payload.get("type")
                if msg_type == "transcript":
                    text_value = payload.get("text", "")
                    text_value, _ = sanitize_text(text_value)
                    speaker_label = payload.get("speaker_label")
                    start_ms = payload.get("start_ms")
                    end_ms = payload.get("end_ms")
                    confidence = payload.get("confidence")
                    run_intelligence = bool(payload.get("run_intelligence"))
                    await add_transcript_segment(
                        session_id=session_id,
                        speaker_label=speaker_label,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        text_value=text_value,
                        confidence=confidence,
                        publish_pipeline=bool(run_intelligence and settings.kafka_enabled),
                        candidate_only=True,
                    )
                elif msg_type == "audio":
                    import base64
                    data_b64 = payload.get("data")
                    if data_b64:
                        audio_bytes = base64.b64decode(data_b64)
                        await store_audio_chunk(
                            organization_id=key_info.organization_id,
                            session_id=session_id,
                            data=audio_bytes,
                            mime_type=payload.get("mime_type"),
                            chunk_index=payload.get("chunk_index"),
                        )
                await ws.send_json({"status": "ok", "type": msg_type})
            except Exception as exc:
                await ws.send_json({"status": "error", "error": str(exc)})
            finally:
                queue.task_done()

    workers = [
        asyncio.create_task(_worker())
        for _ in range(max(1, settings.streaming_worker_concurrency))
    ]

    try:
        while True:
            data = await ws.receive_json()
            priority = int(data.get("priority", 5))
            msg_type = data.get("type", "unknown")

            sent_at_ms = data.get("sent_at_ms") or data.get("client_timestamp_ms")
            if sent_at_ms is not None:
                try:
                    latency_ms = max(0, int((time.time() * 1000) - int(sent_at_ms)))
                    if latency_ms > settings.streaming_max_latency_ms:
                        STREAMING_DROPPED.labels(org_id=key_info.organization_id, reason="latency").inc()
                        await ws.send_json({"status": "error", "error": "latency_exceeded", "latency_ms": latency_ms})
                        continue
                    STREAMING_LATENCY.labels(org_id=key_info.organization_id, type=msg_type).observe(latency_ms / 1000)
                except Exception:
                    pass

            if msg_type == "audio":
                data_b64 = data.get("data")
                if data_b64:
                    approx_bytes = int(len(data_b64) * 0.75)
                    if approx_bytes > settings.streaming_max_chunk_bytes:
                        STREAMING_DROPPED.labels(org_id=key_info.organization_id, reason="chunk_too_large").inc()
                        await ws.send_json({"status": "error", "error": "chunk_too_large"})
                        continue

            if queue.full():
                STREAMING_BACKPRESSURE.inc()
                await ws.send_json({"status": "backpressure", "error": "queue_full"})
                continue
            await queue.put((priority, data))
    except WebSocketDisconnect:
        pass
    finally:
        for task in workers:
            task.cancel()
        set_rls_context(None, is_internal=False)


@router.get("/{session_id}/artifact/{artifact_id}/download")
async def get_artifact_download_url(
    session_id: str,
    artifact_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch")

    url = await get_artifact_presigned_url(organization_id, artifact_id)
    if not url:
        raise HTTPException(status_code=404, detail="Artifact not found or not available")

    return {"artifact_id": artifact_id, "download_url": url}
