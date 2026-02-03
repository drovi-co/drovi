"""
Slack Connector

Extracts messages, channels, and threads from Slack using the Slack SDK.
Supports incremental sync via message timestamps.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import structlog
from slack_sdk.web.async_client import AsyncWebClient
from slack_sdk.errors import SlackApiError

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorCapabilities, ConnectorRegistry
from src.connectors.base.records import Record, RecordBatch, RecordType, UnifiedMessage
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


class SlackConnector(BaseConnector):
    """
    Slack data source connector.

    Supports:
    - Messages stream (channel messages)
    - Channels stream (channel metadata)
    - Users stream (user profiles)
    - Threads stream (threaded conversations)

    Uses message timestamps for efficient incremental sync.
    """

    connector_type = "slack"

    capabilities = ConnectorCapabilities(
        supports_incremental=True,
        supports_full_refresh=True,
        supports_backfill=True,
        supports_webhooks=True,  # Slack Events API
        supports_real_time=True,
        default_rate_limit_per_minute=50,  # Slack tier limits
        supports_concurrency=True,
        max_concurrent_streams=3,
        supports_schema_discovery=True,
    )

    # Slack OAuth scopes
    SCOPES = [
        "channels:history",
        "channels:read",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "mpim:history",
        "mpim:read",
        "users:read",
        "users:read.email",
    ]

    def __init__(self):
        """Initialize Slack connector."""
        self._client: AsyncWebClient | None = None
        self._user_cache: dict[str, dict] = {}

    def _get_client(self, config: ConnectorConfig) -> AsyncWebClient:
        """Get or create Slack client."""
        if self._client:
            return self._client

        self._client = AsyncWebClient(token=config.auth.access_token)
        return self._client

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Verify Slack credentials are valid."""
        try:
            client = self._get_client(config)
            response = await client.auth_test()

            if response["ok"]:
                logger.info(
                    "Slack connection verified",
                    team=response.get("team"),
                    user=response.get("user"),
                )
                return True, None
            else:
                return False, response.get("error", "Unknown error")

        except SlackApiError as e:
            error_msg = f"Slack API error: {e.response['error']}"
            logger.error("Slack connection failed", error=error_msg)
            return False, error_msg
        except Exception as e:
            error_msg = f"Connection error: {str(e)}"
            logger.error("Slack connection failed", error=error_msg)
            return False, error_msg

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Slack streams."""
        return [
            StreamConfig(
                stream_name="messages",
                enabled=True,
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="ts",
                primary_key=["channel", "ts"],
                batch_size=100,
            ),
            StreamConfig(
                stream_name="channels",
                enabled=True,
                sync_mode=SyncMode.FULL_REFRESH,
                primary_key=["id"],
                batch_size=100,
            ),
            StreamConfig(
                stream_name="users",
                enabled=True,
                sync_mode=SyncMode.FULL_REFRESH,
                primary_key=["id"],
                batch_size=100,
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read data from a Slack stream."""
        if stream.stream_name == "messages":
            async for batch in self._read_messages(config, stream, state):
                yield batch
        elif stream.stream_name == "channels":
            async for batch in self._read_channels(config, stream, state):
                yield batch
        elif stream.stream_name == "users":
            async for batch in self._read_users(config, stream, state):
                yield batch
        else:
            raise ValueError(f"Unknown stream: {stream.stream_name}")

    async def _read_messages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read messages from all channels."""
        client = self._get_client(config)

        # First, get all channels (or a specific channel if webhook-triggered)
        sync_params = config.get_setting("sync_params", {}) or {}
        channel_filter = sync_params.get("channel_id")
        channels = await self._get_all_channels(client)
        if channel_filter:
            channels = [c for c in channels if c.get("id") == channel_filter]

        # Get cursor from state
        channel_cursors = {}
        if state:
            cursor = state.get_cursor(stream.stream_name)
            channel_cursors = cursor.get("channel_cursors", {})

        latest_cursors = dict(channel_cursors)

        def to_slack_ts(value: str | float | int | None) -> str | None:
            if value is None:
                return None
            if isinstance(value, (int, float)):
                return str(value)
            if isinstance(value, str):
                try:
                    dt = datetime.fromisoformat(value)
                    return str(dt.timestamp())
                except Exception:
                    return value
            return None

        backfill_start = sync_params.get("backfill_start")
        backfill_end = sync_params.get("backfill_end")
        backfill_oldest = to_slack_ts(backfill_start)
        backfill_latest = to_slack_ts(backfill_end)

        for channel in channels:
            channel_id = channel["id"]
            channel_name = channel.get("name", channel_id)

            # Get last timestamp for this channel
            oldest_ts = sync_params.get("since_ts") or backfill_oldest or channel_cursors.get(channel_id)
            latest_ts = backfill_latest

            logger.info(
                "Syncing Slack channel",
                channel=channel_name,
                oldest_ts=oldest_ts,
            )

            async for batch in self._read_channel_messages(
                client, config, stream, channel, oldest_ts, latest_ts
            ):
                # Update latest cursor for this channel
                if batch.records:
                    latest_ts = max(r.cursor_value for r in batch.records if r.cursor_value)
                    if latest_ts:
                        latest_cursors[channel_id] = latest_ts

                batch.next_cursor = {"channel_cursors": latest_cursors}
                yield batch

            # Small delay to respect rate limits
            await asyncio.sleep(0.5)

    async def _get_all_channels(self, client: AsyncWebClient) -> list[dict]:
        """Get all accessible channels."""
        channels = []
        cursor = None

        while True:
            response = await client.conversations_list(
                types="public_channel,private_channel,mpim,im",
                limit=200,
                cursor=cursor,
            )

            if response["ok"]:
                channels.extend(response.get("channels", []))
                cursor = response.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break
            else:
                break

        return channels

    async def _read_channel_messages(
        self,
        client: AsyncWebClient,
        config: ConnectorConfig,
        stream: StreamConfig,
        channel: dict,
        oldest_ts: str | None = None,
        latest_ts: str | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read messages from a single channel."""
        batch = self.create_batch(stream.stream_name, config.connection_id)
        cursor = None
        channel_id = channel["id"]

        while True:
            try:
                # Fetch messages
                kwargs: dict[str, Any] = {
                    "channel": channel_id,
                    "limit": stream.batch_size,
                }
                if cursor:
                    kwargs["cursor"] = cursor
                if oldest_ts:
                    kwargs["oldest"] = oldest_ts
                if latest_ts:
                    kwargs["latest"] = latest_ts

                response = await client.conversations_history(**kwargs)

                if not response["ok"]:
                    logger.error(
                        "Failed to fetch messages",
                        channel=channel_id,
                        error=response.get("error"),
                    )
                    break

                messages = response.get("messages", [])

                for msg in messages:
                    # Skip non-message types
                    if msg.get("subtype") in ["channel_join", "channel_leave", "bot_message"]:
                        continue

                    record = await self._parse_message(msg, channel, config)
                    batch.add_record(record)

                    # Yield batch when full
                    if len(batch.records) >= stream.batch_size:
                        batch.complete(has_more=True)
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                # Check for more pages
                cursor = response.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break

            except SlackApiError as e:
                logger.error(
                    "Slack API error",
                    channel=channel_id,
                    error=str(e),
                )
                break

        # Yield final batch
        if batch.records:
            batch.complete(has_more=False)
            yield batch

    async def _parse_message(
        self,
        msg: dict[str, Any],
        channel: dict,
        config: ConnectorConfig,
    ) -> Record:
        """Parse Slack message into Record."""
        # Get user info
        user_id = msg.get("user")
        user_info = await self._get_user(self._get_client(config), user_id) if user_id else {}

        # Parse timestamp to datetime
        ts = msg.get("ts", "")
        sent_at = None
        if ts:
            try:
                sent_at = datetime.fromtimestamp(float(ts))
            except Exception:
                pass

        # Check for thread
        thread_ts = msg.get("thread_ts")
        is_thread_reply = thread_ts and thread_ts != ts

        data = {
            "ts": ts,
            "channel_id": channel["id"],
            "channel_name": channel.get("name", ""),
            "channel_type": channel.get("type", self._get_channel_type(channel)),
            "text": msg.get("text", ""),
            "user_id": user_id,
            "user_name": user_info.get("real_name", user_info.get("name", "")),
            "user_email": user_info.get("profile", {}).get("email"),
            "sent_at": sent_at.isoformat() if sent_at else None,
            "thread_ts": thread_ts,
            "is_thread_reply": is_thread_reply,
            "reply_count": msg.get("reply_count", 0),
            "reactions": msg.get("reactions", []),
            "files": [
                {
                    "id": f.get("id"),
                    "name": f.get("name"),
                    "mimetype": f.get("mimetype"),
                    "size": f.get("size"),
                }
                for f in msg.get("files", [])
            ],
            "attachments": msg.get("attachments", []),
        }

        record = self.create_record(
            record_id=f"{channel['id']}:{ts}",
            stream_name="messages",
            data=data,
            cursor_value=ts,
        )
        record.record_type = RecordType.MESSAGE

        return record

    def _get_channel_type(self, channel: dict) -> str:
        """Determine channel type."""
        if channel.get("is_im"):
            return "dm"
        elif channel.get("is_mpim"):
            return "group_dm"
        elif channel.get("is_private"):
            return "private_channel"
        else:
            return "public_channel"

    async def _get_user(self, client: AsyncWebClient, user_id: str) -> dict:
        """Get user info with caching."""
        if not user_id:
            return {}

        if user_id in self._user_cache:
            return self._user_cache[user_id]

        try:
            response = await client.users_info(user=user_id)
            if response["ok"]:
                user = response.get("user", {})
                self._user_cache[user_id] = user
                return user
        except SlackApiError:
            pass

        return {}

    async def _read_channels(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read channel metadata."""
        client = self._get_client(config)
        batch = self.create_batch(stream.stream_name, config.connection_id)

        channels = await self._get_all_channels(client)

        for channel in channels:
            data = {
                "id": channel["id"],
                "name": channel.get("name", ""),
                "type": self._get_channel_type(channel),
                "is_private": channel.get("is_private", False),
                "is_archived": channel.get("is_archived", False),
                "is_general": channel.get("is_general", False),
                "topic": channel.get("topic", {}).get("value", ""),
                "purpose": channel.get("purpose", {}).get("value", ""),
                "member_count": channel.get("num_members", 0),
                "created": channel.get("created"),
                "creator": channel.get("creator"),
            }

            record = self.create_record(
                record_id=channel["id"],
                stream_name=stream.stream_name,
                data=data,
            )
            record.record_type = RecordType.CONVERSATION
            batch.add_record(record)

        batch.complete(has_more=False)
        yield batch

    async def _read_users(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read user profiles."""
        client = self._get_client(config)
        batch = self.create_batch(stream.stream_name, config.connection_id)
        cursor = None

        while True:
            try:
                response = await client.users_list(limit=200, cursor=cursor)

                if not response["ok"]:
                    break

                members = response.get("members", [])

                for user in members:
                    # Skip bots and deleted users
                    if user.get("is_bot") or user.get("deleted"):
                        continue

                    profile = user.get("profile", {})
                    data = {
                        "id": user["id"],
                        "name": user.get("name", ""),
                        "real_name": user.get("real_name", ""),
                        "email": profile.get("email"),
                        "display_name": profile.get("display_name", ""),
                        "title": profile.get("title", ""),
                        "phone": profile.get("phone", ""),
                        "status_text": profile.get("status_text", ""),
                        "status_emoji": profile.get("status_emoji", ""),
                        "timezone": user.get("tz", ""),
                        "is_admin": user.get("is_admin", False),
                        "is_owner": user.get("is_owner", False),
                        "avatar_url": profile.get("image_192", ""),
                    }

                    record = self.create_record(
                        record_id=user["id"],
                        stream_name=stream.stream_name,
                        data=data,
                    )
                    record.record_type = RecordType.CONTACT
                    batch.add_record(record)

                cursor = response.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break

            except SlackApiError as e:
                logger.error("Slack API error", error=str(e))
                break

        batch.complete(has_more=False)
        yield batch

    def to_unified_message(self, record: Record, config: ConnectorConfig) -> UnifiedMessage:
        """Convert Slack record to UnifiedMessage."""
        data = record.data

        return UnifiedMessage(
            id=f"slack:{data['channel_id']}:{data['ts']}",
            source_type="slack",
            source_id=f"{data['channel_id']}:{data['ts']}",
            connection_id=config.connection_id,
            organization_id=config.organization_id,
            body_text=data.get("text", ""),
            sender_email=data.get("user_email"),
            sender_name=data.get("user_name"),
            thread_id=data.get("thread_ts"),
            parent_id=data.get("thread_ts") if data.get("is_thread_reply") else None,
            is_reply=data.get("is_thread_reply", False),
            conversation_id=data.get("channel_id"),
            sent_at=datetime.fromisoformat(data["sent_at"]) if data.get("sent_at") else datetime.utcnow(),
            attachment_names=[f.get("name", "") for f in data.get("files", [])],
            attachment_count=len(data.get("files", [])),
            raw_data_hash=record.raw_data_hash,
        )


# Register connector
ConnectorRegistry._connectors["slack"] = SlackConnector
