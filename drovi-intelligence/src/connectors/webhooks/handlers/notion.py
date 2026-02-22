"""
Notion Webhook Handler.

Routes Notion webhook payloads into the connector webhook inbox/outbox queue so
they are processed by the existing worker path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog

from src.connectors.webhooks.inbox import enqueue_webhook_event
from src.db.client import get_db_pool

logger = structlog.get_logger()


@dataclass(frozen=True)
class NotionWebhookEvent:
    """Normalized Notion webhook payload details."""

    event_type: str
    workspace_id: str | None
    object_id: str | None
    object_type: str | None
    event_id: str | None
    organization_id: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class NotionConnectionTarget:
    """Resolved Notion connection routing target."""

    connection_id: str
    organization_id: str


class NotionWebhookHandler:
    """
    Handler for Notion webhook events.

    The handler resolves the affected connection(s), enqueues events via the
    webhook inbox/outbox tables, and optionally triggers sync directly when Kafka
    streaming is disabled.
    """

    DEFAULT_STREAMS = ("pages", "databases")

    async def handle_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Process a Notion webhook payload and queue connector sync work."""
        event = self._parse_event(payload)
        targets = await self._resolve_targets(
            workspace_id=event.workspace_id,
            organization_id=event.organization_id,
        )

        if not targets:
            logger.warning(
                "No Notion connection targets resolved for webhook event",
                workspace_id=event.workspace_id,
                organization_id=event.organization_id,
                event_type=event.event_type,
            )
            return {
                "status": "ignored",
                "event_type": event.event_type,
                "workspace_id": event.workspace_id,
                "resolved_connections": 0,
                "queued": 0,
                "duplicates": 0,
                "errors": 0,
            }

        normalized_event_type = self._normalize_event_type(event.event_type)
        streams = self._select_streams(event)
        sync_params = self._build_sync_params(event)
        dedupe_event_id = self._build_dedupe_event_id(event)

        from src.streaming import is_streaming_enabled

        kafka_enabled = is_streaming_enabled()
        scheduler = None
        if not kafka_enabled:
            from src.connectors.scheduling.scheduler import SyncJobType, get_scheduler

            scheduler = get_scheduler()
            fallback_job_type = SyncJobType.WEBHOOK
        else:
            fallback_job_type = None

        queued = 0
        duplicates = 0
        errors = 0
        for target in targets:
            try:
                result = await enqueue_webhook_event(
                    provider="notion",
                    connection_id=target.connection_id,
                    organization_id=target.organization_id,
                    event_type=normalized_event_type,
                    payload=event.raw,
                    sync_params=sync_params,
                    streams=streams,
                    event_id=dedupe_event_id,
                )
                inserted = bool(result.get("inserted"))
                if inserted:
                    queued += 1
                else:
                    duplicates += 1

                if inserted and scheduler is not None:
                    await scheduler.trigger_sync_by_id(
                        connection_id=target.connection_id,
                        organization_id=target.organization_id,
                        streams=streams or None,
                        full_refresh=False,
                        job_type=fallback_job_type,
                        sync_params=sync_params,
                    )
            except Exception as exc:
                errors += 1
                logger.error(
                    "Failed to queue Notion webhook event",
                    connection_id=target.connection_id,
                    organization_id=target.organization_id,
                    event_type=normalized_event_type,
                    error=str(exc),
                )

        return {
            "status": "queued" if queued else "ignored",
            "event_type": normalized_event_type,
            "workspace_id": event.workspace_id,
            "resolved_connections": len(targets),
            "queued": queued,
            "duplicates": duplicates,
            "errors": errors,
            "kafka_enabled": kafka_enabled,
        }

    def _parse_event(self, payload: dict[str, Any]) -> NotionWebhookEvent:
        """Extract routing and sync details from the raw payload."""
        event_type = str(
            payload.get("type")
            or payload.get("event_type")
            or payload.get("eventType")
            or "event"
        )
        workspace_id = self._extract_workspace_id(payload)
        object_id, object_type = self._extract_object_fields(payload)
        event_id = self._extract_event_id(payload)
        organization_id = self._extract_org_id(payload)

        return NotionWebhookEvent(
            event_type=event_type,
            workspace_id=workspace_id,
            object_id=object_id,
            object_type=object_type,
            event_id=event_id,
            organization_id=organization_id,
            raw=payload,
        )

    async def _resolve_targets(
        self,
        *,
        workspace_id: str | None,
        organization_id: str | None,
    ) -> list[NotionConnectionTarget]:
        """Resolve active Notion connections for the incoming event."""
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows: list[dict[str, Any]] = []

            if workspace_id and organization_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id
                    FROM connections
                    WHERE connector_type = 'notion'
                      AND status = 'active'
                      AND organization_id = $1
                      AND (
                        config->>'workspace_id' = $2
                        OR config->>'workspaceId' = $2
                        OR config->>'workspace' = $2
                        OR config->'workspace'->>'id' = $2
                      )
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    organization_id,
                    workspace_id,
                )
            elif workspace_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id
                    FROM connections
                    WHERE connector_type = 'notion'
                      AND status = 'active'
                      AND (
                        config->>'workspace_id' = $1
                        OR config->>'workspaceId' = $1
                        OR config->>'workspace' = $1
                        OR config->'workspace'->>'id' = $1
                      )
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    workspace_id,
                )

            if not rows and organization_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id
                    FROM connections
                    WHERE connector_type = 'notion'
                      AND status = 'active'
                      AND organization_id = $1
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    organization_id,
                )

            # Last-resort fallback: if exactly one active Notion connection exists,
            # route to it even without explicit org/workspace hints.
            if not rows and not organization_id and not workspace_id:
                candidate_rows = await conn.fetch(
                    """
                    SELECT id, organization_id
                    FROM connections
                    WHERE connector_type = 'notion'
                      AND status = 'active'
                    ORDER BY updated_at DESC
                    LIMIT 2
                    """
                )
                if len(candidate_rows) == 1:
                    rows = candidate_rows

        targets: list[NotionConnectionTarget] = []
        seen: set[tuple[str, str]] = set()
        for row in rows:
            connection_id = str(row["id"])
            org_id = str(row["organization_id"])
            key = (connection_id, org_id)
            if key in seen:
                continue
            seen.add(key)
            targets.append(
                NotionConnectionTarget(
                    connection_id=connection_id,
                    organization_id=org_id,
                )
            )
        return targets

    def _select_streams(self, event: NotionWebhookEvent) -> list[str]:
        """
        Choose streams for targeted sync based on event/object type.
        """
        signature = f"{event.event_type} {event.object_type or ''}".lower()
        if "database" in signature:
            return ["databases"]
        if "page" in signature or "block" in signature or "comment" in signature:
            return ["pages"]
        return list(self.DEFAULT_STREAMS)

    def _build_sync_params(self, event: NotionWebhookEvent) -> dict[str, Any]:
        """Build webhook-specific sync params for connector execution."""
        params: dict[str, Any] = {"notion_event_type": event.event_type}
        if event.workspace_id:
            params["workspace_id"] = event.workspace_id
        if event.object_id:
            params["object_id"] = event.object_id
        if event.object_type:
            params["object_type"] = event.object_type
        return params

    def _normalize_event_type(self, event_type: str) -> str:
        normalized = str(event_type or "event").strip().lower()
        normalized = normalized.replace(" ", "_")
        if normalized.startswith("notion."):
            return normalized
        return f"notion.{normalized}"

    def _build_dedupe_event_id(self, event: NotionWebhookEvent) -> str | None:
        if event.event_id and event.workspace_id:
            return f"{event.workspace_id}:{event.event_id}"
        if event.event_id:
            return event.event_id
        if event.object_id:
            return f"{event.event_type}:{event.object_id}"
        return None

    def _extract_org_id(self, payload: dict[str, Any]) -> str | None:
        for key in ("organization_id", "org_id", "organizationId"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _extract_workspace_id(self, payload: dict[str, Any]) -> str | None:
        candidates = [
            payload.get("workspace_id"),
            payload.get("workspaceId"),
            payload.get("workspace"),
        ]

        workspace_obj = payload.get("workspace")
        if isinstance(workspace_obj, dict):
            candidates.extend(
                [
                    workspace_obj.get("id"),
                    workspace_obj.get("workspace_id"),
                    workspace_obj.get("workspaceId"),
                ]
            )

        data_obj = payload.get("data")
        if isinstance(data_obj, dict):
            candidates.extend(
                [
                    data_obj.get("workspace_id"),
                    data_obj.get("workspaceId"),
                ]
            )
            nested_workspace = data_obj.get("workspace")
            if isinstance(nested_workspace, dict):
                candidates.extend(
                    [
                        nested_workspace.get("id"),
                        nested_workspace.get("workspace_id"),
                    ]
                )

        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None

    def _extract_object_fields(self, payload: dict[str, Any]) -> tuple[str | None, str | None]:
        object_id: str | None = None
        object_type: str | None = None

        if isinstance(payload.get("data"), dict):
            data_obj = payload["data"]
            if isinstance(data_obj.get("id"), str):
                object_id = data_obj.get("id")
            if isinstance(data_obj.get("object"), str):
                object_type = data_obj.get("object")

        if isinstance(payload.get("entity"), dict):
            entity_obj = payload["entity"]
            if object_id is None and isinstance(entity_obj.get("id"), str):
                object_id = entity_obj.get("id")
            if object_type is None and isinstance(entity_obj.get("type"), str):
                object_type = entity_obj.get("type")

        if isinstance(payload.get("object"), dict):
            object_obj = payload["object"]
            if object_id is None and isinstance(object_obj.get("id"), str):
                object_id = object_obj.get("id")
            if object_type is None and isinstance(object_obj.get("object"), str):
                object_type = object_obj.get("object")

        for key, inferred_type in (
            ("page_id", "page"),
            ("database_id", "database"),
            ("block_id", "block"),
            ("comment_id", "comment"),
        ):
            raw_value = payload.get(key)
            if object_id is None and isinstance(raw_value, str) and raw_value.strip():
                object_id = raw_value.strip()
                if object_type is None:
                    object_type = inferred_type

        if object_type is None and isinstance(payload.get("object"), str):
            object_type = str(payload["object"])

        return object_id, object_type

    def _extract_event_id(self, payload: dict[str, Any]) -> str | None:
        for key in ("event_id", "eventId", "webhook_id", "delivery_id", "request_id", "requestId"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
