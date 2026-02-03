"""
Gmail Webhook Handler

Processes incoming Gmail push notifications and triggers incremental syncs.
"""

from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any

import structlog

from src.connectors.webhooks.inbox import enqueue_webhook_event

logger = structlog.get_logger()


@dataclass
class GmailNotification:
    """Parsed Gmail push notification."""

    email_address: str
    history_id: int
    expiration: int | None = None
    raw: dict[str, Any] | None = None


class GmailWebhookHandler:
    """
    Handler for Gmail push notifications.

    Processes notifications from Gmail Pub/Sub and triggers incremental syncs.
    Gmail uses a watch/push model where we get notified of changes and then
    fetch the actual changes using the History API.
    """

    def __init__(self):
        """Initialize Gmail webhook handler."""
        pass

    async def handle_notification(self, notification: dict[str, Any]) -> None:
        """
        Handle a Gmail push notification.

        Args:
            notification: Decoded Pub/Sub message data
        """
        # Parse the notification
        email_address = notification.get("emailAddress", "")
        history_id = notification.get("historyId")

        if not email_address or not history_id:
            logger.warning(
                "Invalid Gmail notification - missing required fields",
                has_email=bool(email_address),
                has_history_id=bool(history_id),
            )
            return

        parsed = GmailNotification(
            email_address=email_address,
            history_id=int(history_id),
            expiration=notification.get("expiration"),
            raw=notification,
        )

        logger.info(
            "Processing Gmail notification",
            email_address=email_address,
            history_id=history_id,
        )

        # Queue incremental sync
        await self._queue_incremental_sync(parsed)

    async def _queue_incremental_sync(self, notification: GmailNotification) -> None:
        """
        Queue an incremental sync based on the notification.

        Uses the History API to fetch only changes since the last known history_id.
        """
        from src.connectors.scheduling.scheduler import get_scheduler

        try:
            scheduler = get_scheduler()

            # Find connection for this email address
            connection_id = await self._find_connection_for_email(
                notification.email_address
            )
            if not connection_id:
                logger.warning(
                    "No connection found for Gmail account",
                    email_address=notification.email_address,
                )
                return

            # Get the last known history ID for this connection
            last_history_id = await self._get_last_history_id(connection_id)

            if last_history_id and notification.history_id <= last_history_id:
                logger.debug(
                    "Skipping Gmail notification - already processed",
                    email_address=notification.email_address,
                    notification_history_id=notification.history_id,
                    last_history_id=last_history_id,
                )
                return

            organization_id = await self._get_org_id_for_connection(connection_id)
            if not organization_id:
                logger.warning(
                    "No organization found for Gmail connection",
                    connection_id=connection_id,
                )
                return

            sync_params = {
                "start_history_id": last_history_id or notification.history_id,
                "history_types": ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
            }

            from src.streaming import is_streaming_enabled

            await enqueue_webhook_event(
                provider="gmail",
                connection_id=connection_id,
                organization_id=organization_id,
                event_type="gmail.history",
                payload=asdict(notification),
                sync_params=sync_params,
                streams=["messages"],
                event_id=str(notification.history_id),
            )

            # Queue incremental sync job only if Kafka is disabled
            if not is_streaming_enabled():
                await scheduler.trigger_sync_by_id(
                    connection_id=connection_id,
                    organization_id=organization_id,
                    streams=["messages"],
                    full_refresh=False,
                    sync_params=sync_params,
                )

            logger.info(
                "Incremental sync queued for Gmail",
                email_address=notification.email_address,
                connection_id=connection_id,
                start_history_id=last_history_id,
                new_history_id=notification.history_id,
            )

            # Update the last known history ID
            await self._update_last_history_id(connection_id, notification.history_id)

        except Exception as e:
            logger.error(
                "Failed to queue Gmail incremental sync",
                email_address=notification.email_address,
                error=str(e),
            )

    async def _find_connection_for_email(self, email_address: str) -> str | None:
        """
        Find the connection ID for a Gmail account.

        Looks up the connection by email address in the database.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT id FROM connections
                    WHERE connector_type = 'gmail'
                    AND config->>'email_address' = $1
                    AND status = 'active'
                    LIMIT 1
                    """,
                    email_address,
                )
                return row["id"] if row else None

        except Exception as e:
            logger.error(
                "Failed to find connection for Gmail account",
                email_address=email_address,
                error=str(e),
            )
            return None

    async def _get_last_history_id(self, connection_id: str) -> int | None:
        """
        Get the last processed history ID for a connection.

        Stored in sync_states table for the 'messages' stream.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT cursor_state->>'historyId' as history_id
                    FROM sync_states
                    WHERE connection_id = $1
                    AND stream_name = 'messages'
                    """,
                    connection_id,
                )
                if row and row["history_id"]:
                    return int(row["history_id"])
                return None

        except Exception as e:
            logger.error(
                "Failed to get last history ID",
                connection_id=connection_id,
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

    async def _update_last_history_id(
        self,
        connection_id: str,
        history_id: int,
    ) -> None:
        """
        Update the last processed history ID for a connection.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO sync_states (id, connection_id, stream_name, cursor_state, last_sync_started_at)
                    VALUES (gen_random_uuid(), $1, 'messages', jsonb_build_object('historyId', $2::text), NOW())
                    ON CONFLICT (connection_id, stream_name)
                    DO UPDATE SET
                        cursor_state = sync_states.cursor_state || jsonb_build_object('historyId', $2::text),
                        last_sync_started_at = NOW()
                """,
                    connection_id,
                    str(history_id),
                )

        except Exception as e:
            logger.error(
                "Failed to update last history ID",
                connection_id=connection_id,
                history_id=history_id,
                error=str(e),
            )


class GmailWatchManager:
    """
    Manages Gmail watch subscriptions.

    Gmail watches expire after 7 days, so we need to renew them periodically.
    """

    WATCH_EXPIRY_BUFFER_HOURS = 24  # Renew 24 hours before expiry

    def __init__(self):
        """Initialize Gmail watch manager."""
        pass

    async def setup_watch(
        self,
        connection_id: str,
        email_address: str,
        topic_name: str,
    ) -> dict[str, Any]:
        """
        Set up a Gmail watch subscription.

        Args:
            connection_id: The connection ID
            email_address: Gmail address to watch
            topic_name: Pub/Sub topic for notifications

        Returns:
            Watch response with historyId and expiration
        """
        from src.connectors.auth.token_manager import get_token_manager

        try:
            token_manager = await get_token_manager()
            access_token = await token_manager.get_valid_token(
                connection_id=connection_id,
                provider="google",
            )

            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "topicName": topic_name,
                        "labelIds": ["INBOX"],
                        "labelFilterBehavior": "INCLUDE",
                    },
                )

                response.raise_for_status()
                watch_response = response.json()

                logger.info(
                    "Gmail watch set up",
                    connection_id=connection_id,
                    email_address=email_address,
                    history_id=watch_response.get("historyId"),
                    expiration=watch_response.get("expiration"),
                )

                return watch_response

        except Exception as e:
            logger.error(
                "Failed to set up Gmail watch",
                connection_id=connection_id,
                email_address=email_address,
                error=str(e),
            )
            raise

    async def stop_watch(
        self,
        connection_id: str,
    ) -> None:
        """
        Stop a Gmail watch subscription.

        Args:
            connection_id: The connection ID
        """
        from src.connectors.auth.token_manager import get_token_manager

        try:
            token_manager = await get_token_manager()
            access_token = await token_manager.get_valid_token(
                connection_id=connection_id,
                provider="google",
            )

            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://gmail.googleapis.com/gmail/v1/users/me/stop",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                    },
                )

                # Stop returns 204 No Content on success
                if response.status_code not in (200, 204):
                    response.raise_for_status()

                logger.info(
                    "Gmail watch stopped",
                    connection_id=connection_id,
                )

        except Exception as e:
            logger.error(
                "Failed to stop Gmail watch",
                connection_id=connection_id,
                error=str(e),
            )
            raise

    async def renew_expiring_watches(self) -> int:
        """
        Renew all Gmail watches that are about to expire.

        Returns:
            Number of watches renewed
        """
        from src.db.client import get_db_pool
        from datetime import timedelta

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                # Find connections with expiring watches
                expiry_threshold = datetime.utcnow() + timedelta(
                    hours=self.WATCH_EXPIRY_BUFFER_HOURS
                )

                rows = await conn.fetch(
                    """
                    SELECT
                        c.id as connection_id,
                        c.config->>'email_address' as email_address,
                        c.config->>'topic_name' as topic_name,
                        ss.cursor_state->>'watch_expiration' as watch_expiration
                    FROM connections c
                    LEFT JOIN sync_states ss ON c.id = ss.connection_id AND ss.stream_name = 'watch'
                    WHERE c.connector_type = 'gmail'
                    AND c.status = 'active'
                    AND (
                        ss.cursor_state->>'watch_expiration' IS NULL
                        OR (ss.cursor_state->>'watch_expiration')::bigint < $1
                    )
                    """,
                    int(expiry_threshold.timestamp() * 1000),
                )

            renewed = 0
            for row in rows:
                try:
                    watch_response = await self.setup_watch(
                        connection_id=row["connection_id"],
                        email_address=row["email_address"],
                        topic_name=row["topic_name"] or "projects/drovi/topics/gmail-notifications",
                    )

                    # Update expiration in sync_states
                    async with pool.acquire() as conn:
                        await conn.execute(
                            """
                            INSERT INTO sync_states (id, connection_id, stream_name, cursor_state, last_sync_started_at)
                            VALUES (gen_random_uuid(), $1, 'watch', jsonb_build_object(
                                'watch_expiration', $2,
                                'history_id', $3
                            ), NOW())
                            ON CONFLICT (connection_id, stream_name)
                            DO UPDATE SET
                                cursor_state = jsonb_build_object(
                                    'watch_expiration', $2,
                                    'history_id', $3
                                ),
                                last_sync_started_at = NOW()
                            """,
                            row["connection_id"],
                            watch_response.get("expiration"),
                            watch_response.get("historyId"),
                        )

                    renewed += 1

                except Exception as e:
                    logger.error(
                        "Failed to renew Gmail watch",
                        connection_id=row["connection_id"],
                        error=str(e),
                    )

            logger.info(
                "Gmail watch renewal completed",
                renewed=renewed,
                total_checked=len(rows),
            )

            return renewed

        except Exception as e:
            logger.error(
                "Failed to renew expiring Gmail watches",
                error=str(e),
            )
            return 0
