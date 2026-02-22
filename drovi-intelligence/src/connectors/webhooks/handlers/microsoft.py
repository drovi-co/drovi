"""
Microsoft Graph webhook handler.

Maps Microsoft Graph change notifications (Outlook/Teams) to connector
connections, queues events via connector webhook inbox/outbox, and triggers
sync fallback when Kafka streaming is disabled.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

import structlog

from src.connectors.webhooks.inbox import enqueue_webhook_event
from src.db.client import get_db_pool

logger = structlog.get_logger()


@dataclass(frozen=True)
class MicrosoftWebhookEvent:
    connector_type: str
    change_type: str
    resource: str
    subscription_id: str | None
    tenant_id: str | None
    organization_id: str | None
    connection_id: str | None
    user_email: str | None
    object_id: str | None
    raw: dict[str, Any]


@dataclass(frozen=True)
class MicrosoftConnectionTarget:
    connector_type: str
    connection_id: str
    organization_id: str


class MicrosoftWebhookHandler:
    """Handler for Microsoft Graph webhook notifications."""

    DEFAULT_TEAMS_STREAMS = ("teams", "channels", "channel_messages", "chats", "chat_messages")
    DEFAULT_OUTLOOK_STREAMS = ("folders", "messages")

    async def handle_notification(self, notification: dict[str, Any]) -> dict[str, Any]:
        event = self._parse_notification(notification)
        targets = await self._resolve_targets(event)

        if not targets:
            logger.warning(
                "No Microsoft connection targets resolved for webhook notification",
                connector_type=event.connector_type,
                change_type=event.change_type,
                subscription_id=event.subscription_id,
            )
            return {
                "status": "ignored",
                "connector_type": event.connector_type,
                "resolved_connections": 0,
                "queued": 0,
                "duplicates": 0,
                "errors": 0,
            }

        event_type = self._build_event_type(event)
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
                    provider=target.connector_type,
                    connection_id=target.connection_id,
                    organization_id=target.organization_id,
                    event_type=event_type,
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
                    "Failed to queue Microsoft webhook notification",
                    connector_type=target.connector_type,
                    connection_id=target.connection_id,
                    organization_id=target.organization_id,
                    error=str(exc),
                )

        return {
            "status": "queued" if queued else "ignored",
            "connector_type": event.connector_type,
            "resolved_connections": len(targets),
            "queued": queued,
            "duplicates": duplicates,
            "errors": errors,
            "kafka_enabled": kafka_enabled,
        }

    def _parse_notification(self, notification: dict[str, Any]) -> MicrosoftWebhookEvent:
        resource = str(notification.get("resource") or "")
        change_type = str(notification.get("changeType") or "updated").lower()
        subscription_id = self._as_nonempty_str(notification.get("subscriptionId"))
        tenant_id = self._as_nonempty_str(notification.get("tenantId"))

        resource_data = notification.get("resourceData")
        if isinstance(resource_data, dict):
            tenant_id = tenant_id or self._as_nonempty_str(resource_data.get("tenantId"))
        else:
            resource_data = {}

        client_state = self._parse_client_state(notification.get("clientState"))
        organization_id = (
            self._as_nonempty_str(notification.get("organization_id"))
            or self._as_nonempty_str(notification.get("organizationId"))
            or client_state.get("organization_id")
            or client_state.get("org_id")
        )
        connection_id = (
            self._as_nonempty_str(notification.get("connection_id"))
            or self._as_nonempty_str(notification.get("connectionId"))
            or client_state.get("connection_id")
        )
        user_email = (
            self._as_nonempty_str(resource_data.get("userPrincipalName"))
            or self._as_nonempty_str(resource_data.get("email"))
            or self._as_nonempty_str(notification.get("userPrincipalName"))
            or self._as_nonempty_str(notification.get("email"))
        )
        object_id = self._as_nonempty_str(resource_data.get("id"))
        connector_type = self._detect_connector_type(resource, resource_data)

        return MicrosoftWebhookEvent(
            connector_type=connector_type,
            change_type=change_type,
            resource=resource,
            subscription_id=subscription_id,
            tenant_id=tenant_id,
            organization_id=organization_id,
            connection_id=connection_id,
            user_email=user_email,
            object_id=object_id,
            raw=notification,
        )

    async def _resolve_targets(self, event: MicrosoftWebhookEvent) -> list[MicrosoftConnectionTarget]:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows: list[dict[str, Any]] = []

            if event.connection_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE id = $1
                      AND status = 'active'
                      AND connector_type = $2
                    LIMIT 1
                    """,
                    event.connection_id,
                    event.connector_type,
                )
                if rows and event.organization_id and str(rows[0]["organization_id"]) != event.organization_id:
                    rows = []

            if not rows and event.tenant_id and event.organization_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE connector_type = $1
                      AND status = 'active'
                      AND organization_id = $2
                      AND (
                        config->>'tenant_id' = $3
                        OR config->>'tenantId' = $3
                      )
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    event.connector_type,
                    event.organization_id,
                    event.tenant_id,
                )
            elif not rows and event.tenant_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE connector_type = $1
                      AND status = 'active'
                      AND (
                        config->>'tenant_id' = $2
                        OR config->>'tenantId' = $2
                      )
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    event.connector_type,
                    event.tenant_id,
                )

            if not rows and event.user_email and event.organization_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE connector_type = $1
                      AND status = 'active'
                      AND organization_id = $2
                      AND (
                        lower(config->>'email') = lower($3)
                        OR lower(config->>'email_address') = lower($3)
                        OR lower(config->>'user_principal_name') = lower($3)
                      )
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    event.connector_type,
                    event.organization_id,
                    event.user_email,
                )
            elif not rows and event.user_email:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE connector_type = $1
                      AND status = 'active'
                      AND (
                        lower(config->>'email') = lower($2)
                        OR lower(config->>'email_address') = lower($2)
                        OR lower(config->>'user_principal_name') = lower($2)
                      )
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    event.connector_type,
                    event.user_email,
                )

            if not rows and event.organization_id:
                rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE connector_type = $1
                      AND status = 'active'
                      AND organization_id = $2
                    ORDER BY updated_at DESC
                    LIMIT 25
                    """,
                    event.connector_type,
                    event.organization_id,
                )

            if not rows and not event.organization_id:
                candidate_rows = await conn.fetch(
                    """
                    SELECT id, organization_id, connector_type
                    FROM connections
                    WHERE connector_type = $1
                      AND status = 'active'
                    ORDER BY updated_at DESC
                    LIMIT 2
                    """,
                    event.connector_type,
                )
                if len(candidate_rows) == 1:
                    rows = candidate_rows

        targets: list[MicrosoftConnectionTarget] = []
        seen: set[tuple[str, str, str]] = set()
        for row in rows:
            connection_id = str(row["id"])
            organization_id = str(row["organization_id"])
            connector_type = str(row["connector_type"])
            key = (connector_type, connection_id, organization_id)
            if key in seen:
                continue
            seen.add(key)
            targets.append(
                MicrosoftConnectionTarget(
                    connector_type=connector_type,
                    connection_id=connection_id,
                    organization_id=organization_id,
                )
            )
        return targets

    def _detect_connector_type(self, resource: str, resource_data: dict[str, Any]) -> str:
        resource_lc = resource.lower()
        if (
            "/teams" in resource_lc
            or "/channels" in resource_lc
            or "/chats" in resource_lc
        ):
            return "teams"

        odata_type = self._as_nonempty_str(resource_data.get("@odata.type")) or ""
        odata_lc = odata_type.lower()
        if "chatmessage" in odata_lc or "team" in odata_lc or "channel" in odata_lc:
            return "teams"

        return "outlook"

    def _select_streams(self, event: MicrosoftWebhookEvent) -> list[str]:
        resource = event.resource.lower()
        if event.connector_type == "teams":
            if "/messages" in resource and "/chats/" in resource:
                return ["chat_messages"]
            if "/messages" in resource:
                return ["channel_messages"]
            if "/channels" in resource:
                return ["channels"]
            if "/chats" in resource:
                return ["chats"]
            if "/teams" in resource:
                return ["teams"]
            return list(self.DEFAULT_TEAMS_STREAMS)

        if "/mailfolders" in resource:
            return ["folders"]
        if "/messages" in resource:
            return ["messages"]
        return list(self.DEFAULT_OUTLOOK_STREAMS)

    def _build_sync_params(self, event: MicrosoftWebhookEvent) -> dict[str, Any]:
        params: dict[str, Any] = {
            "provider": "microsoft",
            "connector_type": event.connector_type,
            "change_type": event.change_type,
            "resource": event.resource,
        }
        if event.subscription_id:
            params["subscription_id"] = event.subscription_id
        if event.tenant_id:
            params["tenant_id"] = event.tenant_id
        if event.object_id:
            params["object_id"] = event.object_id
        return params

    def _build_event_type(self, event: MicrosoftWebhookEvent) -> str:
        return f"microsoft.{event.connector_type}.{event.change_type}"

    def _build_dedupe_event_id(self, event: MicrosoftWebhookEvent) -> str | None:
        parts = [event.subscription_id, event.object_id, event.change_type]
        compact = [part for part in parts if part]
        if not compact:
            return None
        return ":".join(compact)

    def _parse_client_state(self, raw_client_state: Any) -> dict[str, str]:
        if not isinstance(raw_client_state, str):
            return {}
        client_state = raw_client_state.strip()
        if not client_state:
            return {}

        def _normalize_dict(value: Any) -> dict[str, str]:
            if not isinstance(value, dict):
                return {}
            out: dict[str, str] = {}
            for key, val in value.items():
                if isinstance(val, str) and val.strip():
                    out[str(key)] = val.strip()
            return out

        if client_state.startswith("{"):
            try:
                return _normalize_dict(json.loads(client_state))
            except Exception:
                return {}

        try:
            decoded = base64.urlsafe_b64decode(client_state + "===")
            decoded_text = decoded.decode("utf-8")
            if decoded_text.startswith("{"):
                return _normalize_dict(json.loads(decoded_text))
        except Exception:
            pass

        if "=" in client_state and ("|" in client_state or ";" in client_state or "," in client_state):
            separator = "|" if "|" in client_state else ";" if ";" in client_state else ","
            out: dict[str, str] = {}
            for segment in client_state.split(separator):
                if "=" not in segment:
                    continue
                key, value = segment.split("=", 1)
                key = key.strip()
                value = value.strip()
                if key and value:
                    out[key] = value
            return out

        return {}

    def _as_nonempty_str(self, value: Any) -> str | None:
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None
