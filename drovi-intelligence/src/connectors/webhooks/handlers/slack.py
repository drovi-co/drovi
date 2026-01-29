"""
Slack Webhook Handler

Processes incoming Slack events and triggers incremental syncs.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog

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
        # Import here to avoid circular imports
        from src.connectors.scheduling.scheduler import get_scheduler

        try:
            scheduler = get_scheduler()

            # Find connection for this team
            connection_id = await self._find_connection_for_team(team_id)
            if not connection_id:
                logger.warning(
                    "No connection found for Slack team",
                    team_id=team_id,
                )
                return

            # Queue incremental sync job
            await scheduler.trigger_sync_by_id(
                connection_id=connection_id,
                streams=["messages"],
                incremental=True,
                sync_params={
                    "channel_id": channel_id,
                    "since_ts": since_ts,
                },
            )

            logger.info(
                "Incremental sync queued for Slack channel",
                team_id=team_id,
                channel_id=channel_id,
                connection_id=connection_id,
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

        logger.info(
            "Updating Slack message metadata",
            team_id=team_id,
            channel_id=channel_id,
            message_ts=message_ts,
            reaction=reaction,
            reaction_added=added,
        )

        # In production: update message in database
        # For now, just log the event

    async def _refresh_channel_list(self, team_id: str) -> None:
        """
        Refresh the channel list for a team.

        Called when channels are created, deleted, or modified.
        """
        logger.info(
            "Refreshing Slack channel list",
            team_id=team_id,
        )

        # In production: queue channel discovery job
        # For now, just log the event

    async def _find_connection_for_team(self, team_id: str) -> str | None:
        """
        Find the connection ID for a Slack team.

        Looks up the connection by team_id in the database.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT id FROM connections
                    WHERE connector_type = 'slack'
                    AND config->>'team_id' = $1
                    AND status = 'active'
                    LIMIT 1
                    """,
                    team_id,
                )
                return row["id"] if row else None

        except Exception as e:
            logger.error(
                "Failed to find connection for Slack team",
                team_id=team_id,
                error=str(e),
            )
            return None
