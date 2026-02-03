"""
Live session ingestion utilities (meetings/calls).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any
from uuid import uuid4
import json
import time

import structlog
from sqlalchemy import text

from src.db.client import get_db_session
from src.evidence.storage import get_evidence_storage
from src.evidence.audit import record_evidence_audit
from src.config import get_settings
from src.ingestion.unified_event import (
    build_content_hash,
    build_source_fingerprint,
    build_uem_metadata,
)
from src.ingestion.priority import compute_ingest_priority
from src.streaming.ingestion_pipeline import PipelineInputEvent
from src.monitoring import get_metrics
from src.transcription.whisper import transcribe_audio_bytes, TranscriptSegment
from src.transcription.diarization import diarize_audio_bytes, DiarizationSegment
from src.graph.client import get_graph_client
from src.graph.types import GraphNodeType, GraphRelationshipType

logger = structlog.get_logger()


@dataclass
class LiveSession:
    id: str
    organization_id: str
    session_type: str
    status: str
    started_at: datetime | None
    ended_at: datetime | None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def create_live_session(
    organization_id: str,
    session_type: str,
    title: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    participants: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> LiveSession:
    session_id = str(uuid4())
    now = utc_now()

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO live_session (
                    id, organization_id, session_type, status,
                    title, source_type, source_id,
                    started_at, participants, metadata,
                    created_at, updated_at
                ) VALUES (
                    :id, :org_id, :session_type, 'recording',
                    :title, :source_type, :source_id,
                    :started_at, :participants, CAST(:metadata AS JSONB),
                    :created_at, :updated_at
                )
                """
            ),
            {
                "id": session_id,
                "org_id": organization_id,
                "session_type": session_type,
                "title": title,
                "source_type": source_type,
                "source_id": source_id,
                "started_at": now,
                "participants": participants or [],
                "metadata": json.dumps(metadata or {}),
                "created_at": now,
                "updated_at": now,
            },
        )

    try:
        graph = await get_graph_client()
        node_type = GraphNodeType.MEETING_SESSION
        if session_type == "call":
            node_type = GraphNodeType.CALL_SESSION
        elif session_type == "recording":
            node_type = GraphNodeType.RECORDING

        await graph.create_node(
            node_type=node_type,
            node_id=session_id,
            organization_id=organization_id,
            properties={
                "title": title or "",
                "sessionType": session_type,
                "status": "recording",
                "sourceType": source_type or "",
                "sourceId": source_id or "",
                "startedAt": now.isoformat(),
            },
        )

        for contact_id in participants or []:
            await graph.create_relationship(
                from_type=GraphNodeType.CONTACT,
                from_id=contact_id,
                to_type=node_type,
                to_id=session_id,
                rel_type=GraphRelationshipType.PARTICIPATED_IN_SESSION.value,
                properties={"role": "participant"},
            )
    except Exception as exc:
        logger.warning("Failed to create graph session node", error=str(exc))

    return LiveSession(
        id=session_id,
        organization_id=organization_id,
        session_type=session_type,
        status="recording",
        started_at=now,
        ended_at=None,
    )


async def add_transcript_segment(
    session_id: str,
    speaker_label: str | None,
    start_ms: int | None,
    end_ms: int | None,
    text_value: str,
    confidence: float | None = None,
    speaker_contact_id: str | None = None,
    publish_pipeline: bool = False,
    candidate_only: bool = True,
) -> str:
    segment_id = str(uuid4())
    now = utc_now()
    start_time = time.time()

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO transcript_segment (
                    id, session_id, speaker_label, speaker_contact_id,
                    start_ms, end_ms, text, confidence, created_at
                ) VALUES (
                    :id, :session_id, :speaker_label, :speaker_contact_id,
                    :start_ms, :end_ms, :text, :confidence, :created_at
                )
                """
            ),
            {
                "id": segment_id,
                "session_id": session_id,
                "speaker_label": speaker_label,
                "speaker_contact_id": speaker_contact_id,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": text_value,
                "confidence": confidence,
                "created_at": now,
            },
        )

        try:
            org_id = await organization_id_from_session(session_id)
            source_fingerprint = build_source_fingerprint("transcript", session_id, segment_id)
            content_hash = build_content_hash(text_value, source_fingerprint)
            uem_metadata = build_uem_metadata({}, source_fingerprint, content_hash, now, now)
            await session.execute(
                text(
                    """
                    INSERT INTO unified_event (
                        id, organization_id, source_type, source_id,
                        source_account_id, conversation_id, message_id,
                        event_type, content_text, content_json,
                        participants, metadata, content_hash,
                        captured_at, received_at, evidence_artifact_id
                    ) VALUES (
                        :id, :organization_id, :source_type, :source_id,
                        :source_account_id, :conversation_id, :message_id,
                        :event_type, :content_text, :content_json,
                        :participants, :metadata, :content_hash,
                        :captured_at, :received_at, :evidence_artifact_id
                    )
                    ON CONFLICT (organization_id, content_hash) DO NOTHING
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": org_id,
                    "source_type": "transcript",
                    "source_id": session_id,
                    "source_account_id": None,
                    "conversation_id": session_id,
                    "message_id": segment_id,
                    "event_type": "transcript",
                    "content_text": text_value,
                    "content_json": json.dumps(
                        {
                            "session_id": session_id,
                            "speaker_label": speaker_label,
                            "start_ms": start_ms,
                            "end_ms": end_ms,
                            "confidence": confidence,
                        }
                    ),
                    "participants": json.dumps([]),
                    "metadata": json.dumps(uem_metadata),
                    "content_hash": content_hash,
                    "captured_at": now,
                    "received_at": now,
                    "evidence_artifact_id": None,
                },
            )
        except Exception as exc:
            logger.warning("Failed to persist transcript UEM event", error=str(exc))

    try:
        metrics = get_metrics()
        duration = time.time() - start_time
        metrics.transcript_ingest_duration_seconds.observe(duration)
    except Exception:
        pass

    try:
        from src.config import get_settings
        from src.streaming.kafka_producer import get_kafka_producer

        settings = get_settings()
        if settings.kafka_enabled:
            producer = await get_kafka_producer()
            org_id = await organization_id_from_session(session_id)
            await producer.produce_graph_change(
                organization_id=org_id,
                change_type="created",
                node_type="TranscriptSegment",
                node_id=segment_id,
                properties={
                    "session_id": session_id,
                    "speaker_label": speaker_label,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": text_value,
                    "confidence": confidence,
                },
            )
    except Exception as exc:
        logger.warning("Failed to publish transcript change event", error=str(exc))

    if publish_pipeline:
        try:
            from src.config import get_settings
            from src.streaming.kafka_producer import get_kafka_producer

            settings = get_settings()
            if settings.kafka_enabled:
                producer = await get_kafka_producer()
                org_id = await organization_id_from_session(session_id)
                source_type = "transcript"
                source_fingerprint = build_source_fingerprint(
                    source_type,
                    session_id,
                    session_id,
                    segment_id,
                )
                content_hash = build_content_hash(text_value, source_fingerprint)
                ingest = {
                    "content_hash": content_hash,
                    "source_fingerprint": source_fingerprint,
                    "priority": compute_ingest_priority(
                        source_type=source_type,
                        job_type="webhook",
                        explicit_priority="high",
                    ),
                    "job_type": "live_session",
                }
                pipeline_event = PipelineInputEvent(
                    pipeline_id=str(uuid4()),
                    organization_id=org_id,
                    source_type=source_type,
                    source_id=session_id,
                    content=text_value,
                    metadata={
                        "session_id": session_id,
                        "speaker_label": speaker_label,
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                        "confidence": confidence,
                        "transcript_segment_id": segment_id,
                    },
                    conversation_id=session_id,
                    message_ids=[segment_id],
                    user_email=None,
                    user_name=speaker_label,
                    candidate_only=candidate_only,
                    is_partial=candidate_only,
                    ingest=ingest,
                    enrichment={},
                )
                await producer.produce_pipeline_input(
                    organization_id=org_id,
                    pipeline_id=pipeline_event.pipeline_id,
                    data=pipeline_event.to_payload(),
                    priority=ingest.get("priority"),
                )
        except Exception as exc:
            logger.warning("Failed to publish transcript pipeline input", error=str(exc))

    try:
        graph = await get_graph_client()
        session_node_type = GraphNodeType.MEETING_SESSION
        # Resolve node type from live_session row if needed; default meeting
        if session_id:
            # best-effort: try call session node existence
            existing = await graph.get_node(GraphNodeType.CALL_SESSION, session_id)
            if existing:
                session_node_type = GraphNodeType.CALL_SESSION
            else:
                existing = await graph.get_node(GraphNodeType.RECORDING, session_id)
                if existing:
                    session_node_type = GraphNodeType.RECORDING

        org_id = await organization_id_from_session(session_id)

        await graph.create_node(
            node_type=GraphNodeType.TRANSCRIPT_SEGMENT,
            node_id=segment_id,
            organization_id=org_id,
            properties={
                "sessionId": session_id,
                "speakerLabel": speaker_label or "",
                "startMs": start_ms or 0,
                "endMs": end_ms or 0,
                "text": text_value,
                "confidence": confidence or 0.0,
            },
        )

        await graph.create_relationship(
            from_type=GraphNodeType.TRANSCRIPT_SEGMENT,
            from_id=segment_id,
            to_type=session_node_type,
            to_id=session_id,
            rel_type=GraphRelationshipType.IN_SESSION.value,
            properties={},
        )

        if speaker_contact_id:
            await graph.create_relationship(
                from_type=GraphNodeType.TRANSCRIPT_SEGMENT,
                from_id=segment_id,
                to_type=GraphNodeType.CONTACT,
                to_id=speaker_contact_id,
                rel_type=GraphRelationshipType.SPOKEN_BY.value,
                properties={},
            )
    except Exception as exc:
        logger.warning("Failed to create transcript graph node", error=str(exc))

    return segment_id


async def store_audio_chunk(
    organization_id: str,
    session_id: str,
    data: bytes,
    mime_type: str | None,
    chunk_index: int | None = None,
) -> str:
    artifact_id = str(uuid4())
    storage = get_evidence_storage()
    settings = get_settings()
    retention_days = settings.evidence_default_retention_days
    retention_until = utc_now() + timedelta(days=retention_days) if retention_days else None
    immutable = settings.evidence_immutable_by_default

    extension = ".wav"
    if mime_type == "audio/mpeg":
        extension = ".mp3"

    stored = await storage.write_bytes(
        artifact_id,
        data,
        extension=extension,
        organization_id=organization_id,
        retention_until=retention_until,
        immutable=immutable,
    )

    created_at = utc_now()
    storage_uri = None
    if stored.storage_backend == "s3":
        bucket = settings.evidence_s3_bucket or ""
        storage_uri = f"s3://{bucket}/{stored.storage_path}" if bucket else f"s3://{stored.storage_path}"
    else:
        storage_uri = f"file://{stored.storage_path}"

    metadata = {
        "source_type": "live_session",
        "source_id": session_id,
        "storage_backend": stored.storage_backend,
        "storage_path": stored.storage_path,
        "storage_uri": storage_uri,
        "sha256": stored.sha256,
        "created_at": created_at.isoformat(),
    }
    if retention_until:
        metadata["retention_until"] = retention_until.isoformat()

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO evidence_artifact (
                    id, organization_id, session_id, source_type, source_id, artifact_type,
                    mime_type, storage_backend, storage_path,
                    byte_size, sha256, metadata, created_at,
                    immutable, legal_hold, retention_until
                ) VALUES (
                    :id, :org_id, :session_id, :source_type, :source_id, :artifact_type,
                    :mime_type, :storage_backend, :storage_path,
                    :byte_size, :sha256, :metadata, :created_at,
                    :immutable, :legal_hold, :retention_until
                )
                """
            ),
            {
                "id": artifact_id,
                "org_id": organization_id,
                "session_id": session_id,
                "source_type": "live_session",
                "source_id": session_id,
                "artifact_type": "audio_chunk",
                "mime_type": mime_type,
                "storage_backend": stored.storage_backend,
                "storage_path": stored.storage_path,
                "byte_size": stored.byte_size,
                "sha256": stored.sha256,
                "metadata": json.dumps(metadata),
                "created_at": created_at,
                "immutable": immutable,
                "legal_hold": settings.evidence_legal_hold_by_default,
                "retention_until": retention_until,
            },
        )

        if chunk_index is not None:
            await session.execute(
                text(
                    """
                    UPDATE evidence_artifact
                    SET metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:meta AS JSONB)
                    WHERE id = :id
                    """
                ),
                {
                    "id": artifact_id,
                    "meta": json.dumps({"chunk_index": chunk_index}),
                },
            )

    await record_evidence_audit(
        artifact_id=artifact_id,
        organization_id=organization_id,
        action="created",
        actor_type="system",
        metadata={"session_id": session_id, "chunk_index": chunk_index},
    )

    return artifact_id


async def transcribe_audio_to_segments(
    session_id: str,
    organization_id: str,
    audio_bytes: bytes,
    language: str | None = None,
    diarize: bool = False,
    file_suffix: str = ".wav",
    run_intelligence: bool = False,
) -> list[str]:
    segment_ids: list[str] = []

    try:
        diarization_segments: list[DiarizationSegment] = []
        if diarize:
            diarization_segments = diarize_audio_bytes(audio_bytes)

        from src.identity.speaker_resolution import resolve_speaker_contact_id
        from src.compliance.dlp import sanitize_text

        settings = get_settings()
        for segment in transcribe_audio_bytes(audio_bytes, language=language, suffix=file_suffix):
            speaker_label = None
            if diarization_segments:
                speaker_label = _match_speaker(segment, diarization_segments)
            speaker_contact_id = None
            if speaker_label:
                speaker_contact_id = await resolve_speaker_contact_id(organization_id, speaker_label)
            sanitized_text, _ = sanitize_text(segment.text)
            segment_id = await add_transcript_segment(
                session_id=session_id,
                speaker_label=speaker_label,
                speaker_contact_id=speaker_contact_id,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                text_value=sanitized_text,
                confidence=segment.confidence,
                publish_pipeline=bool(run_intelligence and settings.kafka_enabled),
                candidate_only=True,
            )
            segment_ids.append(segment_id)
            if run_intelligence and sanitized_text.strip() and not settings.kafka_enabled:
                from src.orchestrator.graph import compile_intelligence_graph
                from src.orchestrator.state import AnalysisInput, IntelligenceState

                graph = compile_intelligence_graph()
                initial_state = IntelligenceState(
                    input=AnalysisInput(
                        organization_id=organization_id,
                        content=sanitized_text,
                        source_type="transcript",
                        source_id=session_id,
                        conversation_id=session_id,
                        candidate_only=True,
                    )
                )
                try:
                    await graph.ainvoke(initial_state)
                except Exception as exc:
                    logger.error("Partial intelligence failed", error=str(exc))
    except Exception as exc:
        logger.error("Audio transcription failed", session_id=session_id, error=str(exc))

    return segment_ids


def _match_speaker(segment: TranscriptSegment, diarization_segments: list[DiarizationSegment]) -> str | None:
    best_label = None
    best_overlap = 0
    for diar in diarization_segments:
        overlap = min(segment.end_ms, diar.end_ms) - max(segment.start_ms, diar.start_ms)
        if overlap > best_overlap:
            best_overlap = overlap
            best_label = diar.speaker_label
    if best_label is None and diarization_segments:
        return diarization_segments[0].speaker_label
    return best_label


async def finalize_live_session(session_id: str, status: str = "completed") -> None:
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE live_session
                SET status = :status,
                    ended_at = :ended_at,
                    updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {
                "id": session_id,
                "status": status,
                "ended_at": utc_now(),
                "updated_at": utc_now(),
            },
        )

    try:
        graph = await get_graph_client()
        for node_type in (GraphNodeType.MEETING_SESSION, GraphNodeType.CALL_SESSION, GraphNodeType.RECORDING):
            node = await graph.get_node(node_type, session_id)
            if node:
                await graph.update_node(
                    node_type=node_type,
                    node_id=session_id,
                    updates={
                        "status": status,
                        "endedAt": utc_now().isoformat(),
                    },
                )
                break
    except Exception as exc:
        logger.warning("Failed to update session node", error=str(exc))


async def get_full_transcript(session_id: str) -> list[TranscriptSegment]:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT speaker_label, start_ms, end_ms, text, confidence
                FROM transcript_segment
                WHERE session_id = :session_id
                ORDER BY start_ms NULLS LAST, created_at ASC
                """
            ),
            {"session_id": session_id},
        )

        segments = []
        for row in result.fetchall():
            segments.append(
                TranscriptSegment(
                    start_ms=row.start_ms or 0,
                    end_ms=row.end_ms or 0,
                    text=row.text or "",
                    confidence=row.confidence,
                )
            )

    return segments


async def build_transcript_text(session_id: str) -> str:
    segments = await get_full_transcript(session_id)
    lines = []
    for seg in segments:
        lines.append(seg.text)
    return "\n".join(lines)


async def get_transcript_segments_since(
    session_id: str,
    since_time: datetime | None = None,
    limit: int = 200,
) -> list[dict]:
    async with get_db_session() as session:
        if since_time:
            result = await session.execute(
                text(
                    """
                    SELECT id, speaker_label, start_ms, end_ms, text, confidence, created_at
                    FROM transcript_segment
                    WHERE session_id = :session_id
                      AND created_at > :since_time
                    ORDER BY created_at ASC
                    LIMIT :limit
                    """
                ),
                {"session_id": session_id, "since_time": since_time, "limit": limit},
            )
        else:
            result = await session.execute(
                text(
                    """
                    SELECT id, speaker_label, start_ms, end_ms, text, confidence, created_at
                    FROM transcript_segment
                    WHERE session_id = :session_id
                    ORDER BY created_at ASC
                    LIMIT :limit
                    """
                ),
                {"session_id": session_id, "limit": limit},
            )

        segments: list[dict] = []
        for row in result.fetchall():
            segments.append(
                {
                    "id": row.id,
                    "speaker_label": row.speaker_label,
                    "start_ms": row.start_ms or 0,
                    "end_ms": row.end_ms or 0,
                    "text": row.text or "",
                    "confidence": row.confidence,
                    "created_at": row.created_at,
                }
            )

    return segments


async def get_artifact_presigned_url(
    organization_id: str,
    artifact_id: str,
) -> str | None:
    storage = get_evidence_storage()
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT storage_backend, storage_path
                FROM evidence_artifact
                WHERE id = :id AND organization_id = :org_id
                """
            ),
            {"id": artifact_id, "org_id": organization_id},
        )
        row = result.fetchone()
        if not row:
            return None

        storage_path = row.storage_path

    url = await storage.create_presigned_url(storage_path)
    if url:
        await record_evidence_audit(
            artifact_id=artifact_id,
            organization_id=organization_id,
            action="presigned_url",
            actor_type="system",
        )
    return url


async def link_session_transcripts_to_uios(session_id: str, limit: int = 200) -> None:
    """
    Link transcript segments to UIOs extracted from this session.
    """
    async with get_db_session() as session:
        uio_rows = await session.execute(
            text(
                """
                SELECT DISTINCT u.id, u.type
                FROM unified_intelligence_object u
                JOIN unified_object_source s ON s.unified_object_id = u.id
                WHERE s.conversation_id = :session_id
                """
            ),
            {"session_id": session_id},
        )
        uio_records = [(row.id, row.type) for row in uio_rows.fetchall()]

        segment_rows = await session.execute(
            text(
                """
                SELECT id
                FROM transcript_segment
                WHERE session_id = :session_id
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"session_id": session_id, "limit": limit},
        )
        segment_ids = [row.id for row in segment_rows.fetchall()]

    if not uio_records or not segment_ids:
        return

    try:
        graph = await get_graph_client()
        type_map = {
            "commitment": GraphNodeType.COMMITMENT,
            "decision": GraphNodeType.DECISION,
            "risk": GraphNodeType.RISK,
            "task": GraphNodeType.TASK,
            "claim": GraphNodeType.CLAIM,
        }

        for uio_id, uio_type in uio_records:
            node_type = type_map.get(uio_type)
            if not node_type:
                continue
            for segment_id in segment_ids:
                await graph.create_relationship(
                    from_type=node_type,
                    from_id=uio_id,
                    to_type=GraphNodeType.TRANSCRIPT_SEGMENT,
                    to_id=segment_id,
                    rel_type=GraphRelationshipType.EXTRACTED_FROM.value,
                    properties={},
                )
    except Exception as exc:
        logger.warning("Failed to link transcript segments to UIOs", error=str(exc))


async def organization_id_from_session(session_id: str) -> str:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT organization_id FROM live_session
                WHERE id = :id
                """
            ),
            {"id": session_id},
        )
        row = result.fetchone()
        return row.organization_id if row else ""
