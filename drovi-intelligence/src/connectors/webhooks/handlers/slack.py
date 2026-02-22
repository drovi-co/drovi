"""
Slack Webhook Handler

Processes incoming Slack events and triggers incremental syncs.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog

from src.connectors.webhooks.inbox import enqueue_webhook_event

logger = structlog.get_logger()


@dataclass
class SlackEvent:
    """Parsed Slack event."""

    type: str
    team_id: str
    channel_id: str | None = None
    user_id: str | None = None
    ts: str | None = None
    thread_ts: str | None = None
    text: str | None = None
    raw: dict[str, Any] | None = None


class SlackWebhookHandler:
    """
    Handler for Slack webhook events.

    Processes events from Slack Events API and triggers appropriate actions:
    - New messages → Incremental sync
    - Reactions → Update message metadata
    - Channel events → Update channel list
    """

    # Events that should trigger incremental sync
    SYNC_TRIGGER_EVENTS = {
        "message",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
    }

    # Events that should update metadata only
    METADATA_EVENTS = {
        "reaction_added",
        "reaction_removed",
        "star_added",
        "star_removed",
        "pin_added",
        "pin_removed",
    }

    # Channel-related events
    CHANNEL_EVENTS = {
        "channel_created",
        "channel_deleted",
        "channel_archive",
        "channel_unarchive",
        "channel_rename",
        "member_joined_channel",
        "member_left_channel",
    }

    def __init__(self):
        """Initialize Slack webhook handler."""
        self._processing_queue: list[SlackEvent] = []

    async def handle_event(self, payload: dict[str, Any]) -> None:
        """
        Handle a Slack event callback.

        Args:
            payload: Full Slack event payload
        """
        event = payload.get("event", {})
        event_type = event.get("type", "unknown")
        team_id = payload.get("team_id")

        # Parse the event
        parsed_event = SlackEvent(
            type=event_type,
            team_id=team_id,
            channel_id=event.get("channel"),
            user_id=event.get("user"),
            ts=event.get("ts"),
            thread_ts=event.get("thread_ts"),
            text=event.get("text"),
            raw=event,
        )

        logger.info(
            "Processing Slack event",
            event_type=event_type,
            team_id=team_id,
            channel_id=parsed_event.channel_id,
        )

        # Route to appropriate handler
        if event_type in self.SYNC_TRIGGER_EVENTS:
            await self._handle_message_event(parsed_event)
        elif event_type in self.METADATA_EVENTS:
            await self._handle_metadata_event(parsed_event)
        elif event_type in self.CHANNEL_EVENTS:
            await self._handle_channel_event(parsed_event)
        else:
            logger.debug("Unhandled Slack event type", event_type=event_type)

    async def _handle_message_event(self, event: SlackEvent) -> None:
        """
        Handle a new message event.

        Triggers incremental sync for the channel.
        """
        if not event.channel_id:
            return

        # Skip bot messages and message edits (subtypes)
        raw = event.raw or {}
        if raw.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
            logger.debug("Skipping message subtype", subtype=raw.get("subtype"))
            return

        logger.info(
            "Slack message received, queueing incremental sync",
            team_id=event.team_id,
            channel_id=event.channel_id,
            ts=event.ts,
            is_thread_reply=bool(event.thread_ts),
        )

        # Queue incremental sync
        await self._queue_incremental_sync(
            team_id=event.team_id,
            channel_id=event.channel_id,
            since_ts=event.ts,
        )

    async def _handle_metadata_event(self, event: SlackEvent) -> None:
        """
        Handle a metadata event (reactions, stars, pins).

        Updates message metadata without full sync.
        """
        raw = event.raw or {}
        item = raw.get("item", {})

        logger.info(
            "Slack metadata event",
            event_type=event.type,
            team_id=event.team_id,
            item_type=item.get("type"),
            item_channel=item.get("channel"),
            item_ts=item.get("ts"),
        )

        # For reactions, we may want to update sentiment/importance
        if event.type in ("reaction_added", "reaction_removed"):
            reaction = raw.get("reaction")
            await self._update_message_metadata(
                team_id=event.team_id,
                channel_id=item.get("channel"),
                message_ts=item.get("ts"),
                reaction=reaction,
                added=event.type == "reaction_added",
            )

    async def _handle_channel_event(self, event: SlackEvent) -> None:
        """
        Handle a channel event.

        Updates channel list and membership.
        """
        raw = event.raw or {}
        channel = raw.get("channel", {})

        if isinstance(channel, dict):
            channel_id = channel.get("id")
            channel_name = channel.get("name")
        else:
            channel_id = channel
            channel_name = None

        logger.info(
            "Slack channel event",
            event_type=event.type,
            team_id=event.team_id,
            channel_id=channel_id,
            channel_name=channel_name,
        )

        # Queue channel refresh
        await self._refresh_channel_list(team_id=event.team_id)

    async def _queue_incremental_sync(
        self,
        team_id: str,
        channel_id: str,
        since_ts: str | None = None,
    ) -> None:
        """
        Queue an incremental sync for a Slack channel.

        In production, this would:
        1. Find the connection for this team
        2. Queue a sync job via the scheduler
        3. Sync only messages since the given timestamp
        """
        try:
            await self._queue_slack_sync_event(
                team_id=team_id,
                event_type="slack.message",
                payload={"team_id": team_id, "channel_id": channel_id, "since_ts": since_ts},
                sync_params={"channel_id": channel_id, "since_ts": since_ts},
                streams=["messages"],
                full_refresh=False,
                event_id=f"{team_id}:{channel_id}:{since_ts}" if since_ts else f"{team_id}:{channel_id}",
            )
        except Exception as e:
            logger.error(
                "Failed to queue Slack incremental sync",
                team_id=team_id,
                channel_id=channel_id,
                error=str(e),
            )

    async def _update_message_metadata(
        self,
        team_id: str,
        channel_id: str | None,
        message_ts: str | None,
        reaction: str | None,
        added: bool,
    ) -> None:
        """
        Update metadata for a specific message.

        In production, this would update the message's reaction count
        and potentially re-score its importance.
        """
        if not channel_id or not message_ts:
            return

        await self._queue_slack_sync_event(
            team_id=team_id,
            event_type="slack.message_metadata",
            payload={
                "team_id": team_id,
                "channel_id": channel_id,
                "message_ts": message_ts,
                "reaction": reaction,
                "reaction_added": added,
            },
            sync_params={
                "channel_id": channel_id,
                "message_ts": message_ts,
                "metadata_only": True,
                "reaction": reaction,
                "reaction_added": added,
            },
            streams=["messages"],
            full_refresh=False,
            event_id=f"{team_id}:{channel_id}:{message_ts}:{reaction}:{'add' if added else 'remove'}",
        )

    async def _refresh_channel_list(self, team_id: str) -> None:
        """
        Refresh the channel list for a team.

        Called when channels are created, deleted, or modified.
        """
        await self._queue_slack_sync_event(
            team_id=team_id,
            event_type="slack.refresh_channels",
            payload={"team_id": team_id},
            sync_params={"refresh_channels": True},
            streams=["channels"],
            full_refresh=True,
            event_id=f"{team_id}:refresh_channels",
        )

    async def _queue_slack_sync_event(
        self,
        *,
        team_id: str,
        event_type: str,
        payload: dict[str, Any],
        sync_params: dict[str, Any],
        streams: list[str],
        full_refresh: bool,
        event_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Queue a Slack webhook-derived event through the inbox/outbox path.
        """
        from src.connectors.scheduling.scheduler import SyncJobType, get_scheduler
        from src.streaming import is_streaming_enabled

        scheduler = get_scheduler()

        connection_id = await self._find_connection_for_team(team_id)
        if not connection_id:
            logger.warning(
                "No connection found for Slack team",
                team_id=team_id,
                event_type=event_type,
            )
            return None

        organization_id = await self._get_org_id_for_connection(connection_id)
        if not organization_id:
            logger.warning(
                "No organization found for Slack connection",
                connection_id=connection_id,
                event_type=event_type,
            )
            return None

        result = await enqueue_webhook_event(
            provider="slack",
            connection_id=connection_id,
            organization_id=organization_id,
            event_type=event_type,
            payload=payload,
            sync_params=sync_params,
            streams=streams,
            event_id=event_id,
        )
        inserted = bool(result.get("inserted"))

        if inserted and not is_streaming_enabled():
            await scheduler.trigger_sync_by_id(
                connection_id=connection_id,
                organization_id=organization_id,
                streams=streams,
                full_refresh=full_refresh,
                job_type=SyncJobType.WEBHOOK,
                sync_params=sync_params,
            )

        logger.info(
            "Slack webhook event queued",
            team_id=team_id,
            event_type=event_type,
            connection_id=connection_id,
            inserted=inserted,
            kafka_enabled=is_streaming_enabled(),
        )
        return result

    async def _find_connection_for_team(self, team_id: str) -> str | None:
        """
        Find the connection ID for a Slack team.

        Looks up the connection by team_id in the database.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = None
                if team_id:
                    row = await conn.fetchrow(
                        """
                        SELECT id
                        FROM connections
                        WHERE connector_type = 'slack'
                          AND status = 'active'
                          AND (
                            config->>'team_id' = $1
                            OR config->>'teamId' = $1
                            OR config->>'team' = $1
                            OR config->'team'->>'id' = $1
                          )
                        ORDER BY updated_at DESC
                        LIMIT 1
                        """,
                        team_id,
                    )
                if row:
                    return str(row["id"])

                # Fallback for older connections missing team_id metadata:
                # route only when a single active Slack connection exists.
                candidates = await conn.fetch(
                    """
                    SELECT id
                    FROM connections
                    WHERE connector_type = 'slack'
                      AND status = 'active'
                    ORDER BY updated_at DESC
                    LIMIT 2
                    """
                )
                if len(candidates) == 1:
                    return str(candidates[0]["id"])
                return None

        except Exception as e:
            logger.error(
                "Failed to find connection for Slack team",
                team_id=team_id,
                error=str(e),
            )
            return None

    async def _get_org_id_for_connection(self, connection_id: str) -> str | None:
        """Fetch organization_id for a connection."""
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT organization_id FROM connections WHERE id = $1",
                    connection_id,
                )
                return row["organization_id"] if row else None
        except Exception as e:
            logger.error(
                "Failed to fetch organization for connection",
                connection_id=connection_id,
                error=str(e),
            )
            return None
