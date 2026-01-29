"""
Microsoft Teams Webhook Handler

Processes incoming Teams events and triggers incremental syncs.
Handles notifications from Microsoft Graph webhooks.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class TeamsEvent:
    """Parsed Teams event."""

    type: str  # message, channelCreated, channelDeleted, etc.
    subscription_id: str | None = None
    tenant_id: str | None = None
    team_id: str | None = None
    channel_id: str | None = None
    chat_id: str | None = None
    message_id: str | None = None
    user_id: str | None = None
    change_type: str | None = None  # created, updated, deleted
    resource: str | None = None
    raw: dict[str, Any] | None = None


class TeamsWebhookHandler:
    """
    Handler for Microsoft Teams webhook events.

    Processes events from Microsoft Graph change notifications:
    - New messages → Incremental sync
    - Channel events → Update channel list
    - Chat events → Update chat list

    Microsoft Graph uses subscription-based webhooks where you subscribe
    to specific resources (teams, channels, chats) and receive notifications.
    """

    # Resource types that trigger incremental sync
    SYNC_TRIGGER_RESOURCES = {
        "/teams/{team-id}/channels/{channel-id}/messages",
        "/chats/{chat-id}/messages",
        "/users/{user-id}/chats/{chat-id}/messages",
    }

    # Resource types for channel/team events
    CHANNEL_RESOURCES = {
        "/teams/{team-id}/channels",
    }

    # Resource types for chat events
    CHAT_RESOURCES = {
        "/chats",
        "/users/{user-id}/chats",
    }

    def __init__(self):
        """Initialize Teams webhook handler."""
        self._processing_queue: list[TeamsEvent] = []

    async def handle_notification(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Handle a Microsoft Graph change notification.

        Args:
            payload: Full notification payload from Microsoft Graph

        Returns:
            Response dict with processing status
        """
        # Handle validation request (Microsoft Graph subscription validation)
        if "validationToken" in payload:
            validation_token = payload["validationToken"]
            logger.info("Teams webhook validation request received")
            return {"validationToken": validation_token}

        # Process notifications
        notifications = payload.get("value", [])
        processed = 0
        errors = 0

        for notification in notifications:
            try:
                await self._process_notification(notification)
                processed += 1
            except Exception as e:
                logger.error(
                    "Failed to process Teams notification",
                    error=str(e),
                    notification=notification,
                )
                errors += 1

        return {
            "status": "processed",
            "processed": processed,
            "errors": errors,
        }

    async def _process_notification(self, notification: dict[str, Any]) -> None:
        """
        Process a single change notification.

        Args:
            notification: Individual notification from the value array
        """
        subscription_id = notification.get("subscriptionId")
        change_type = notification.get("changeType")  # created, updated, deleted
        resource = notification.get("resource", "")
        resource_data = notification.get("resourceData", {})

        # Parse the event
        event = TeamsEvent(
            type=self._determine_event_type(resource, change_type),
            subscription_id=subscription_id,
            tenant_id=notification.get("tenantId"),
            change_type=change_type,
            resource=resource,
            raw=notification,
        )

        # Extract IDs from resource path
        self._parse_resource_path(event, resource, resource_data)

        logger.info(
            "Processing Teams notification",
            event_type=event.type,
            change_type=change_type,
            team_id=event.team_id,
            channel_id=event.channel_id,
            chat_id=event.chat_id,
        )

        # Route to appropriate handler
        if self._is_message_resource(resource):
            await self._handle_message_event(event)
        elif self._is_channel_resource(resource):
            await self._handle_channel_event(event)
        elif self._is_chat_resource(resource):
            await self._handle_chat_event(event)
        else:
            logger.debug("Unhandled Teams resource type", resource=resource)

    def _determine_event_type(self, resource: str, change_type: str | None) -> str:
        """Determine event type from resource and change type."""
        if "/messages" in resource:
            return f"message.{change_type}" if change_type else "message"
        elif "/channels" in resource:
            return f"channel.{change_type}" if change_type else "channel"
        elif "/chats" in resource:
            return f"chat.{change_type}" if change_type else "chat"
        elif "/teams" in resource:
            return f"team.{change_type}" if change_type else "team"
        return "unknown"

    def _parse_resource_path(
        self,
        event: TeamsEvent,
        resource: str,
        resource_data: dict[str, Any],
    ) -> None:
        """Extract IDs from resource path."""
        # Resource paths look like:
        # /teams/{team-id}/channels/{channel-id}/messages/{message-id}
        # /chats/{chat-id}/messages/{message-id}

        parts = resource.strip("/").split("/")

        for i, part in enumerate(parts):
            if part == "teams" and i + 1 < len(parts):
                event.team_id = parts[i + 1]
            elif part == "channels" and i + 1 < len(parts):
                event.channel_id = parts[i + 1]
            elif part == "chats" and i + 1 < len(parts):
                event.chat_id = parts[i + 1]
            elif part == "messages" and i + 1 < len(parts):
                event.message_id = parts[i + 1]

        # Also try to get IDs from resourceData
        if resource_data:
            event.message_id = event.message_id or resource_data.get("id")

    def _is_message_resource(self, resource: str) -> bool:
        """Check if resource is a message resource."""
        return "/messages" in resource

    def _is_channel_resource(self, resource: str) -> bool:
        """Check if resource is a channel resource."""
        return "/channels" in resource and "/messages" not in resource

    def _is_chat_resource(self, resource: str) -> bool:
        """Check if resource is a chat resource."""
        return "/chats" in resource and "/messages" not in resource

    async def _handle_message_event(self, event: TeamsEvent) -> None:
        """
        Handle a new message event.

        Triggers incremental sync for the channel or chat.
        """
        # Skip deleted messages for now (could be handled differently)
        if event.change_type == "deleted":
            logger.debug("Skipping deleted message event")
            return

        logger.info(
            "Teams message received, queueing incremental sync",
            team_id=event.team_id,
            channel_id=event.channel_id,
            chat_id=event.chat_id,
            message_id=event.message_id,
        )

        if event.channel_id and event.team_id:
            # Channel message
            await self._queue_channel_sync(
                tenant_id=event.tenant_id,
                team_id=event.team_id,
                channel_id=event.channel_id,
            )
        elif event.chat_id:
            # Chat message
            await self._queue_chat_sync(
                tenant_id=event.tenant_id,
                chat_id=event.chat_id,
            )

    async def _handle_channel_event(self, event: TeamsEvent) -> None:
        """
        Handle a channel event.

        Updates channel list and membership.
        """
        logger.info(
            "Teams channel event",
            event_type=event.type,
            team_id=event.team_id,
            channel_id=event.channel_id,
            change_type=event.change_type,
        )

        # Refresh channel list for the team
        if event.team_id:
            await self._refresh_channels(tenant_id=event.tenant_id, team_id=event.team_id)

    async def _handle_chat_event(self, event: TeamsEvent) -> None:
        """
        Handle a chat event.

        Updates chat list.
        """
        logger.info(
            "Teams chat event",
            event_type=event.type,
            chat_id=event.chat_id,
            change_type=event.change_type,
        )

        # Refresh chats list
        await self._refresh_chats(tenant_id=event.tenant_id)

    async def _queue_channel_sync(
        self,
        tenant_id: str | None,
        team_id: str,
        channel_id: str,
    ) -> None:
        """
        Queue an incremental sync for a Teams channel.
        """
        from src.connectors.scheduling.scheduler import get_scheduler

        try:
            scheduler = get_scheduler()

            # Find connection for this tenant
            connection_id = await self._find_connection_for_tenant(tenant_id)
            if not connection_id:
                logger.warning(
                    "No connection found for Teams tenant",
                    tenant_id=tenant_id,
                )
                return

            # Queue incremental sync job
            await scheduler.trigger_sync_by_id(
                connection_id=connection_id,
                streams=["channel_messages"],
                incremental=True,
                sync_params={
                    "team_id": team_id,
                    "channel_id": channel_id,
                },
            )

            logger.info(
                "Incremental sync queued for Teams channel",
                tenant_id=tenant_id,
                team_id=team_id,
                channel_id=channel_id,
                connection_id=connection_id,
            )

        except Exception as e:
            logger.error(
                "Failed to queue Teams channel sync",
                tenant_id=tenant_id,
                team_id=team_id,
                channel_id=channel_id,
                error=str(e),
            )

    async def _queue_chat_sync(
        self,
        tenant_id: str | None,
        chat_id: str,
    ) -> None:
        """
        Queue an incremental sync for a Teams chat.
        """
        from src.connectors.scheduling.scheduler import get_scheduler

        try:
            scheduler = get_scheduler()

            connection_id = await self._find_connection_for_tenant(tenant_id)
            if not connection_id:
                logger.warning(
                    "No connection found for Teams tenant",
                    tenant_id=tenant_id,
                )
                return

            await scheduler.trigger_sync_by_id(
                connection_id=connection_id,
                streams=["chat_messages"],
                incremental=True,
                sync_params={
                    "chat_id": chat_id,
                },
            )

            logger.info(
                "Incremental sync queued for Teams chat",
                tenant_id=tenant_id,
                chat_id=chat_id,
                connection_id=connection_id,
            )

        except Exception as e:
            logger.error(
                "Failed to queue Teams chat sync",
                tenant_id=tenant_id,
                chat_id=chat_id,
                error=str(e),
            )

    async def _refresh_channels(
        self,
        tenant_id: str | None,
        team_id: str,
    ) -> None:
        """
        Refresh the channel list for a team.
        """
        logger.info(
            "Refreshing Teams channel list",
            tenant_id=tenant_id,
            team_id=team_id,
        )

        # Queue channel discovery
        try:
            from src.connectors.scheduling.scheduler import get_scheduler

            scheduler = get_scheduler()
            connection_id = await self._find_connection_for_tenant(tenant_id)

            if connection_id:
                await scheduler.trigger_sync_by_id(
                    connection_id=connection_id,
                    streams=["channels"],
                    incremental=False,  # Full refresh for channels
                )
        except Exception as e:
            logger.error("Failed to refresh Teams channels", error=str(e))

    async def _refresh_chats(self, tenant_id: str | None) -> None:
        """
        Refresh the chats list.
        """
        logger.info(
            "Refreshing Teams chats list",
            tenant_id=tenant_id,
        )

        try:
            from src.connectors.scheduling.scheduler import get_scheduler

            scheduler = get_scheduler()
            connection_id = await self._find_connection_for_tenant(tenant_id)

            if connection_id:
                await scheduler.trigger_sync_by_id(
                    connection_id=connection_id,
                    streams=["chats"],
                    incremental=False,
                )
        except Exception as e:
            logger.error("Failed to refresh Teams chats", error=str(e))

    async def _find_connection_for_tenant(self, tenant_id: str | None) -> str | None:
        """
        Find the connection ID for a Teams tenant.

        Looks up the connection by tenant_id in the database.
        """
        if not tenant_id:
            return None

        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT id FROM connections
                    WHERE connector_type = 'teams'
                    AND config->>'tenant_id' = $1
                    AND status = 'active'
                    LIMIT 1
                    """,
                    tenant_id,
                )
                return row["id"] if row else None

        except Exception as e:
            logger.error(
                "Failed to find connection for Teams tenant",
                tenant_id=tenant_id,
                error=str(e),
            )
            return None

    async def verify_subscription(
        self,
        validation_token: str,
    ) -> str:
        """
        Return validation token for Microsoft Graph subscription validation.

        Microsoft Graph sends a validation request when creating/renewing subscriptions.
        We must respond with the validation token in plain text.
        """
        return validation_token
