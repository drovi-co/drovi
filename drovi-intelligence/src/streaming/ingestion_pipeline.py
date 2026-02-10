"""
Kafka ingestion pipeline helpers.

Stages:
1. Raw connector events -> normalized records
2. Normalized records -> enriched pipeline input
3. Pipeline input -> intelligence extraction + graph changes
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Iterable
from uuid import uuid4

import structlog

from src.config import get_settings
from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import ConnectorRegistry
from src.connectors.base.records import Record, RecordType
from src.connectors.normalization import normalize_record_for_pipeline
from src.ingestion.priority import compute_ingest_priority
from src.ingestion.unified_event import build_content_hash, build_source_fingerprint
from src.identity import IdentitySource, IdentityType, get_identity_graph
from src.monitoring import get_metrics

logger = structlog.get_logger()


SOURCE_TYPE_MAP: dict[str, str] = {
    "gmail": "email",
    "outlook": "email",
    "slack": "slack",
    "notion": "notion",
    "google_docs": "google_docs",
    "google_calendar": "calendar",
    "hubspot": "crm",
    "teams": "teams",
    "whatsapp": "whatsapp",
    "s3": "s3",
    "bigquery": "bigquery",
    "postgres": "postgresql",
    "mysql": "mysql",
    "mongodb": "mongodb",
}


@dataclass
class NormalizedRecordEvent:
    """Normalized record event payload."""

    normalized_id: str
    organization_id: str
    source_type: str
    source_id: str | None
    event_type: str
    record: dict[str, Any]
    normalized: dict[str, Any]
    ingest: dict[str, Any]
    connector_type: str | None = None
    connection_id: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PipelineInputEvent:
    """Pipeline input payload."""

    pipeline_id: str
    organization_id: str
    source_type: str
    source_id: str | None
    content: str
    metadata: dict[str, Any]
    conversation_id: str | None
    message_ids: list[str]
    user_email: str | None
    user_name: str | None
    candidate_only: bool
    is_partial: bool
    ingest: dict[str, Any]
    enrichment: dict[str, Any]
    connection_id: str | None = None
    connector_type: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


def _minimal_connector_config(
    connector_type: str,
    connection_id: str,
    organization_id: str,
    provider_config: dict[str, Any] | None = None,
) -> ConnectorConfig:
    return ConnectorConfig(
        connection_id=connection_id,
        organization_id=organization_id,
        connector_type=connector_type,
        name=connector_type,
        description=None,
        auth=AuthConfig(auth_type=AuthType.NONE),
        streams=[],
        default_sync_mode=SyncMode.INCREMENTAL,
        sync_frequency_minutes=5,
        provider_config=provider_config or {},
    )


def _extract_content_from_payload(payload: dict[str, Any]) -> tuple[str, str | None]:
    subject = (
        payload.get("subject")
        or payload.get("summary")
        or payload.get("title")
        or payload.get("name")
        or ""
    )
    body_text = (
        payload.get("body")
        or payload.get("body_text")
        or payload.get("text")
        or payload.get("content")
        or payload.get("content_text")
        or payload.get("description")
        or ""
    )
    parts: list[str] = []
    if subject:
        parts.append(f"Subject: {subject}")
    if body_text:
        parts.append(body_text)
    return "\n\n".join(parts).strip(), subject or None


def _build_ingest_metadata(
    normalized_content: str,
    source_type: str,
    source_id: str | None,
    conversation_id: str | None,
    message_id: str | None,
    job_type: str | None,
    is_vip: bool = False,
    explicit_priority: str | int | None = None,
    origin_timestamp: str | None = None,
) -> dict[str, Any]:
    fingerprint = build_source_fingerprint(
        source_type,
        source_id,
        conversation_id,
        message_id,
    )
    content_hash = build_content_hash(normalized_content, fingerprint)
    priority = compute_ingest_priority(
        source_type=source_type,
        job_type=job_type,
        is_vip=is_vip,
        explicit_priority=explicit_priority,
    )
    ingest = {
        "priority": priority,
        "content_hash": content_hash,
        "source_fingerprint": fingerprint,
        "job_type": job_type,
    }
    if origin_timestamp:
        ingest["origin_ts"] = origin_timestamp
    return ingest


def normalize_raw_event_payload(
    event_payload: dict[str, Any],
    kafka_timestamp: str | None = None,
) -> NormalizedRecordEvent | None:
    event_type = event_payload.get("event_type") or "unknown"
    organization_id = event_payload.get("organization_id")
    source_type = event_payload.get("source_type") or "api"
    source_id = event_payload.get("source_id")
    payload = event_payload.get("payload") or {}

    if not organization_id:
        logger.warning("Normalization skipped: missing organization_id", event_type=event_type)
        return None

    connector_type = payload.get("connector_type")
    connection_id = payload.get("connection_id")
    job_type = payload.get("job_type")
    provider_config = payload.get("provider_config") or {}

    record_payload = payload.get("record")
    record_obj: Record | None = None
    normalized = None

    default_source_type = SOURCE_TYPE_MAP.get(connector_type or "", source_type)

    if record_payload:
        try:
            record_obj = Record(**record_payload)
        except Exception as exc:
            logger.warning("Failed to parse record payload", error=str(exc))
            record_obj = None

    if record_obj:
        connector = None
        if connector_type:
            connector = ConnectorRegistry.create(connector_type)

        config = None
        if connector_type and connection_id:
            config = _minimal_connector_config(
                connector_type=connector_type,
                connection_id=connection_id,
                organization_id=organization_id,
                provider_config=provider_config,
            )

        if config:
            normalized = normalize_record_for_pipeline(
                record=record_obj,
                connector=connector,
                config=config,
                default_source_type=default_source_type,
            )

    if normalized is None:
        content, subject = _extract_content_from_payload(payload if isinstance(payload, dict) else {})
        normalized = normalize_record_for_pipeline(
            record=Record(
                record_id=source_id or str(uuid4()),
                source_type=default_source_type,
                stream_name=event_type,
                record_type=RecordType.MESSAGE,
                data=payload if isinstance(payload, dict) else {"payload": payload},
            ),
            connector=None,
            config=_minimal_connector_config(
                connector_type=connector_type or "api",
                connection_id=connection_id or "unknown",
                organization_id=organization_id,
                provider_config=provider_config,
            ),
            default_source_type=default_source_type,
        )
        normalized.metadata = {
            **normalized.metadata,
            "raw_event_type": event_type,
            "raw_payload": payload,
        }
        if subject:
            normalized.subject = subject
        if content:
            normalized.content = content

    message_id = record_obj.record_id if record_obj else source_id
    ingest = _build_ingest_metadata(
        normalized_content=normalized.content,
        source_type=normalized.source_type,
        source_id=source_id or message_id,
        conversation_id=normalized.conversation_id,
        message_id=message_id,
        job_type=job_type,
        origin_timestamp=kafka_timestamp,
    )

    return NormalizedRecordEvent(
        normalized_id=str(uuid4()),
        organization_id=organization_id,
        source_type=normalized.source_type,
        source_id=source_id or message_id,
        event_type=event_type,
        record=record_obj.model_dump() if record_obj else {},
        normalized={
            "content": normalized.content,
            "metadata": normalized.metadata,
            "conversation_id": normalized.conversation_id,
            "user_email": normalized.user_email,
            "user_name": normalized.user_name,
            "subject": normalized.subject,
        },
        ingest=ingest,
        connector_type=connector_type,
        connection_id=connection_id,
    )


def _collect_emails(values: Iterable[str | None]) -> list[str]:
    seen: set[str] = set()
    emails: list[str] = []
    for value in values:
        if not value:
            continue
        cleaned = value.strip().lower()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            emails.append(cleaned)
    return emails


def _identity_source_for_type(identity_type: IdentityType) -> IdentitySource:
    if identity_type == IdentityType.EMAIL:
        return IdentitySource.EMAIL_HEADER
    if identity_type == IdentityType.SLACK_ID:
        return IdentitySource.SLACK_PROFILE
    if identity_type == IdentityType.CALENDAR_ATTENDEE_ID:
        return IdentitySource.CALENDAR_INVITE
    return IdentitySource.API_ENRICHMENT


def _extract_identifiers(normalized_payload: dict[str, Any]) -> list[tuple[IdentityType, str]]:
    identifiers: list[tuple[IdentityType, str]] = []
    seen: set[str] = set()

    metadata = normalized_payload.get("metadata") or {}
    unified = metadata.get("unified") or {}
    raw = metadata.get("raw") or {}

    emails = []
    emails.append(normalized_payload.get("user_email"))
    emails.append(unified.get("sender_email"))
    emails.extend(unified.get("recipient_emails") or [])
    emails.extend(unified.get("cc_emails") or [])
    emails.append(raw.get("sender_email"))
    emails.append(raw.get("owner_email"))
    emails.append(raw.get("author_email"))
    emails.append(raw.get("organizer_email"))

    attendees = raw.get("attendees") or metadata.get("attendees") or []
    if isinstance(attendees, list):
        for attendee in attendees:
            if isinstance(attendee, dict):
                emails.append(attendee.get("email"))
            else:
                emails.append(str(attendee))

    for email in _collect_emails(emails):
        if email not in seen:
            seen.add(email)
            identifiers.append((IdentityType.EMAIL, email))

    slack_users = metadata.get("slack_users") or []
    for slack_user in slack_users:
        if isinstance(slack_user, dict) and slack_user.get("id"):
            slack_id = slack_user["id"]
            key = f"slack:{slack_id}"
            if key not in seen:
                seen.add(key)
                identifiers.append((IdentityType.SLACK_ID, slack_id))

    return identifiers


async def enrich_normalized_payload(
    normalized_event: NormalizedRecordEvent,
) -> PipelineInputEvent:
    normalized_payload = normalized_event.normalized
    organization_id = normalized_event.organization_id
    identifiers = _extract_identifiers(normalized_payload)

    resolved_contacts: list[dict[str, Any]] = []
    vip_contacts: list[str] = []
    attempts = len(identifiers)
    successes = 0

    if identifiers:
        try:
            identity_graph = await get_identity_graph()
            for id_type, id_value in identifiers:
                resolution = await identity_graph.resolve_identifier(
                    identifier_type=id_type,
                    identifier_value=id_value,
                    organization_id=organization_id,
                    create_if_missing=True,
                    source=_identity_source_for_type(id_type),
                )
                if resolution and resolution.contact:
                    contact = resolution.contact
                    resolved_contacts.append({
                        "id": contact.id,
                        "display_name": contact.display_name,
                        "primary_email": contact.primary_email,
                        "is_vip": contact.is_vip,
                    })
                    successes += 1
                    if contact.is_vip:
                        vip_contacts.append(contact.id)
        except Exception as exc:
            logger.warning("Identity enrichment failed", error=str(exc))

    success_rate = (successes / attempts) if attempts else 0.0
    logger.info(
        "Identity enrichment batch",
        organization_id=organization_id,
        attempts=attempts,
        successes=successes,
        success_rate=round(success_rate, 3),
    )

    metrics = get_metrics()
    if attempts:
        try:
            metrics.identity_resolution_attempts_total.labels(
                organization_id=organization_id,
                source_type=normalized_event.source_type,
            ).inc(attempts)
            metrics.identity_resolution_success_total.labels(
                organization_id=organization_id,
                source_type=normalized_event.source_type,
            ).inc(successes)
        except Exception:
            pass

    is_vip = bool(vip_contacts)
    base_priority = normalized_event.ingest.get("priority")
    if base_priority is None:
        base_priority = compute_ingest_priority(
            source_type=normalized_event.source_type,
            job_type=normalized_event.ingest.get("job_type"),
            is_vip=False,
        )
    priority = max(0, int(base_priority) - 2) if is_vip else int(base_priority)

    ingest = _build_ingest_metadata(
        normalized_content=normalized_payload.get("content", ""),
        source_type=normalized_event.source_type,
        source_id=normalized_event.source_id,
        conversation_id=normalized_payload.get("conversation_id"),
        message_id=normalized_event.record.get("record_id") if normalized_event.record else None,
        job_type=normalized_event.ingest.get("job_type"),
        is_vip=is_vip,
        explicit_priority=priority,
        origin_timestamp=normalized_event.ingest.get("origin_ts"),
    )

    pipeline_id = str(uuid4())
    return PipelineInputEvent(
        pipeline_id=pipeline_id,
        organization_id=organization_id,
        source_type=normalized_event.source_type,
        source_id=normalized_event.source_id,
        content=normalized_payload.get("content", ""),
        metadata={
            **(normalized_payload.get("metadata") or {}),
            "participant_contacts": resolved_contacts,
            "vip_contacts": vip_contacts,
        },
        conversation_id=normalized_payload.get("conversation_id"),
        message_ids=[
            normalized_event.record.get("record_id")
            if normalized_event.record
            else normalized_event.source_id or pipeline_id
        ],
        user_email=normalized_payload.get("user_email"),
        user_name=normalized_payload.get("user_name"),
        candidate_only=False,
        is_partial=False,
        ingest=ingest,
        enrichment={
            "resolved_contacts": resolved_contacts,
            "vip_contacts": vip_contacts,
            "success_rate": success_rate,
        },
        connection_id=normalized_event.connection_id,
        connector_type=normalized_event.connector_type,
    )
