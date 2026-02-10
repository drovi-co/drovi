"""
Microsoft Teams Connector

Extracts messages, channels, and chats from Microsoft Teams via Graph API.
Supports incremental sync using delta queries.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http_client import connector_request
from src.connectors.sources.messaging.teams.definition import CAPABILITIES, OAUTH_SCOPES, default_streams

logger = structlog.get_logger()

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"


@dataclass
class TeamsChannel:
    """Represents a Teams channel."""

    id: str
    team_id: str
    display_name: str
    description: str | None
    membership_type: str  # standard, private, shared
    web_url: str | None
    created_datetime: str | None


@dataclass
class TeamsMessage:
    """Represents a Teams message."""

    id: str
    channel_id: str | None
    chat_id: str | None
    team_id: str | None
    created_datetime: str
    last_modified_datetime: str | None
    message_type: str  # message, chatMessage, systemEventMessage
    content: str
    content_type: str  # text, html
    from_user: dict[str, Any] | None
    importance: str  # normal, high, urgent
    mentions: list[dict[str, Any]]
    attachments: list[dict[str, Any]]
    reactions: list[dict[str, Any]]
    reply_to_id: str | None = None
    web_url: str | None = None


@dataclass
class TeamsChat:
    """Represents a Teams chat (1:1 or group)."""

    id: str
    topic: str | None
    chat_type: str  # oneOnOne, group, meeting
    created_datetime: str | None
    last_updated_datetime: str | None
    members: list[dict[str, Any]]
    web_url: str | None = None


class TeamsConnector(BaseConnector):
    """
    Connector for Microsoft Teams via Graph API.

    Extracts:
    - Teams and channels
    - Channel messages
    - Chat messages (1:1 and group)

    Supports incremental sync using delta queries.
    """

    connector_type = "teams"
    capabilities = CAPABILITIES
    SCOPES = list(OAUTH_SCOPES)

    def __init__(self):
        """Initialize Teams connector."""
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if Teams credentials are valid."""
        try:
            access_token = config.get_credential("access_token")
            if not access_token:
                return False, "Missing access_token in credentials"

            async with httpx.AsyncClient() as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=f"{GRAPH_BASE_URL}/me/joinedTeams",
                    operation="check_connection",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"$top": 1},
                )

                if response.status_code == 200:
                    logger.info("Teams connection verified")
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"Microsoft Graph API error: {response.status_code}"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Teams streams."""
        return default_streams()

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from Teams."""
        self._access_token = config.get_credential("access_token")

        if stream.stream_name == "teams":
            async for batch in self._read_teams(config, stream, state):
                yield batch
        elif stream.stream_name == "channels":
            async for batch in self._read_channels(config, stream, state):
                yield batch
        elif stream.stream_name == "channel_messages":
            async for batch in self._read_channel_messages(config, stream, state):
                yield batch
        elif stream.stream_name == "chats":
            async for batch in self._read_chats(config, stream, state):
                yield batch
        elif stream.stream_name == "chat_messages":
            async for batch in self._read_chat_messages(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_teams(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read joined teams."""
        url = f"{GRAPH_BASE_URL}/me/joinedTeams"

        async with httpx.AsyncClient(timeout=30.0) as client:
            while url:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="read_teams",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for item in data.get("value", []):
                    record = self.create_record(
                        record_id=item["id"],
                        stream_name=stream.stream_name,
                        data={
                        "id": item["id"],
                        "type": "teams_team",
                        "display_name": item.get("displayName"),
                        "description": item.get("description"),
                        "visibility": item.get("visibility"),
                        "web_url": item.get("webUrl"),
                        "extracted_at": datetime.utcnow().isoformat(),
                        },
                    )
                    record.record_type = RecordType.CONVERSATION
                    batch.add_record(record)

                if batch.records:
                    batch.complete(has_more=bool(data.get("@odata.nextLink")))
                    yield batch

                url = data.get("@odata.nextLink")

    async def _read_channels(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read channels from all teams."""
        # First get all teams
        teams = []
        url = f"{GRAPH_BASE_URL}/me/joinedTeams"

        async with httpx.AsyncClient(timeout=30.0) as client:
            while url:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="read_channels:list_teams",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                response.raise_for_status()
                data = response.json()
                teams.extend(data.get("value", []))
                url = data.get("@odata.nextLink")

            # Now get channels for each team
            for team in teams:
                team_id = team["id"]
                channel_url = f"{GRAPH_BASE_URL}/teams/{team_id}/channels"

                while channel_url:
                    response = await connector_request(
                        connector=self,
                        config=config,
                        client=client,
                        method="GET",
                        url=channel_url,
                        operation="read_channels:list_channels",
                        headers={"Authorization": f"Bearer {self._access_token}"},
                    )
                    response.raise_for_status()
                    data = response.json()

                    batch = self.create_batch(stream.stream_name, config.connection_id)
                    for item in data.get("value", []):
                        channel = TeamsChannel(
                            id=item["id"],
                            team_id=team_id,
                            display_name=item.get("displayName", ""),
                            description=item.get("description"),
                            membership_type=item.get("membershipType", "standard"),
                            web_url=item.get("webUrl"),
                            created_datetime=item.get("createdDateTime"),
                        )
                        record = self.create_record(
                            record_id=channel.id,
                            stream_name=stream.stream_name,
                            data=self._channel_to_record(channel),
                        )
                        record.record_type = RecordType.CONVERSATION
                        batch.add_record(record)

                    if batch.records:
                        batch.complete(has_more=bool(data.get("@odata.nextLink")))
                        yield batch

                    channel_url = data.get("@odata.nextLink")

    async def _read_channel_messages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read messages from channels."""
        cursor = state.get_cursor(stream.stream_name)
        delta_links = cursor.get("delta_links", {}) if cursor else {}
        sync_params = config.get_setting("sync_params", {}) or {}

        # Get team IDs to sync
        team_ids = config.get_setting("team_ids")
        if sync_params.get("team_id"):
            team_ids = [sync_params.get("team_id")]
        if not team_ids:
            # Get all joined teams
            team_ids = await self._get_joined_team_ids(config)

        async with httpx.AsyncClient(timeout=60.0) as client:
            for team_id in team_ids:
                # Get channels for this team
                channel_ids = await self._get_channel_ids(config, client, team_id)
                if sync_params.get("channel_id"):
                    channel_ids = [sync_params.get("channel_id")]

                for channel_id in channel_ids:
                    delta_key = f"{team_id}_{channel_id}"

                    # Use delta link if available
                    if delta_key in delta_links:
                        url = delta_links[delta_key]
                    else:
                        url = f"{GRAPH_BASE_URL}/teams/{team_id}/channels/{channel_id}/messages/delta"

                    while url:
                        response = await connector_request(
                            connector=self,
                            config=config,
                            client=client,
                            method="GET",
                            url=url,
                            operation="read_channel_messages",
                            headers={"Authorization": f"Bearer {self._access_token}"},
                        )
                        response.raise_for_status()
                        data = response.json()

                        batch = self.create_batch(stream.stream_name, config.connection_id)
                        for item in data.get("value", []):
                            if "@removed" in item:
                                continue
                            message = self._parse_message(item, channel_id=channel_id, team_id=team_id)
                            record = self.create_record(
                                record_id=message.id,
                                stream_name=stream.stream_name,
                                data=self._message_to_record(message),
                                cursor_value=message.last_modified_datetime or message.created_datetime,
                            )
                            record.record_type = RecordType.MESSAGE
                            batch.add_record(record)

                        # Store delta link
                        new_delta_link = data.get("@odata.deltaLink")
                        if new_delta_link:
                            delta_links[delta_key] = new_delta_link

                        if batch.records:
                            batch.complete(
                                next_cursor={"delta_links": delta_links},
                                has_more=bool(data.get("@odata.nextLink")),
                            )
                            yield batch

                        url = data.get("@odata.nextLink")

    async def _read_chats(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read 1:1 and group chats."""
        url = f"{GRAPH_BASE_URL}/me/chats?$expand=members"

        async with httpx.AsyncClient(timeout=30.0) as client:
            while url:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="read_chats",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for item in data.get("value", []):
                    chat = TeamsChat(
                        id=item["id"],
                        topic=item.get("topic"),
                        chat_type=item.get("chatType", "oneOnOne"),
                        created_datetime=item.get("createdDateTime"),
                        last_updated_datetime=item.get("lastUpdatedDateTime"),
                        members=[
                            {
                                "id": m.get("userId"),
                                "display_name": m.get("displayName"),
                                "email": m.get("email"),
                            }
                            for m in item.get("members", [])
                        ],
                        web_url=item.get("webUrl"),
                    )
                    record = self.create_record(
                        record_id=chat.id,
                        stream_name=stream.stream_name,
                        data=self._chat_to_record(chat),
                    )
                    record.record_type = RecordType.CONVERSATION
                    batch.add_record(record)

                if batch.records:
                    batch.complete(has_more=bool(data.get("@odata.nextLink")))
                    yield batch

                url = data.get("@odata.nextLink")

    async def _read_chat_messages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read messages from chats."""
        cursor = state.get_cursor(stream.stream_name)
        delta_links = cursor.get("delta_links", {}) if cursor else {}
        sync_params = config.get_setting("sync_params", {}) or {}

        # Get chat IDs
        chat_ids = config.get_setting("chat_ids")
        if sync_params.get("chat_id"):
            chat_ids = [sync_params.get("chat_id")]
        if not chat_ids:
            chat_ids = await self._get_chat_ids(config)

        async with httpx.AsyncClient(timeout=60.0) as client:
            for chat_id in chat_ids:
                if chat_id in delta_links:
                    url = delta_links[chat_id]
                else:
                    url = f"{GRAPH_BASE_URL}/me/chats/{chat_id}/messages/delta"

                while url:
                    response = await connector_request(
                        connector=self,
                        config=config,
                        client=client,
                        method="GET",
                        url=url,
                        operation="read_chat_messages",
                        headers={"Authorization": f"Bearer {self._access_token}"},
                    )
                    response.raise_for_status()
                    data = response.json()

                    batch = self.create_batch(stream.stream_name, config.connection_id)
                    for item in data.get("value", []):
                        if "@removed" in item:
                            continue
                        message = self._parse_message(item, chat_id=chat_id)
                        record = self.create_record(
                            record_id=message.id,
                            stream_name=stream.stream_name,
                            data=self._message_to_record(message),
                            cursor_value=message.last_modified_datetime or message.created_datetime,
                        )
                        record.record_type = RecordType.MESSAGE
                        batch.add_record(record)

                    new_delta_link = data.get("@odata.deltaLink")
                    if new_delta_link:
                        delta_links[chat_id] = new_delta_link

                    if batch.records:
                        batch.complete(
                            next_cursor={"delta_links": delta_links},
                            has_more=bool(data.get("@odata.nextLink")),
                        )
                        yield batch

                    url = data.get("@odata.nextLink")

    async def _get_joined_team_ids(self, config: ConnectorConfig) -> list[str]:
        """Get IDs of all joined teams."""
        team_ids = []
        url = f"{GRAPH_BASE_URL}/me/joinedTeams"

        async with httpx.AsyncClient(timeout=30.0) as client:
            while url:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="get_joined_team_ids",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                response.raise_for_status()
                data = response.json()
                team_ids.extend(t["id"] for t in data.get("value", []))
                url = data.get("@odata.nextLink")

        return team_ids

    async def _get_channel_ids(
        self,
        config: ConnectorConfig,
        client: httpx.AsyncClient,
        team_id: str,
    ) -> list[str]:
        """Get channel IDs for a team."""
        channel_ids = []
        url = f"{GRAPH_BASE_URL}/teams/{team_id}/channels"

        while url:
            response = await connector_request(
                connector=self,
                config=config,
                client=client,
                method="GET",
                url=url,
                operation="get_channel_ids",
                headers={"Authorization": f"Bearer {self._access_token}"},
            )
            response.raise_for_status()
            data = response.json()
            channel_ids.extend(c["id"] for c in data.get("value", []))
            url = data.get("@odata.nextLink")

        return channel_ids

    async def _get_chat_ids(self, config: ConnectorConfig) -> list[str]:
        """Get IDs of all chats."""
        chat_ids = []
        url = f"{GRAPH_BASE_URL}/me/chats"

        async with httpx.AsyncClient(timeout=30.0) as client:
            while url:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=url,
                    operation="get_chat_ids",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                response.raise_for_status()
                data = response.json()
                chat_ids.extend(c["id"] for c in data.get("value", []))
                url = data.get("@odata.nextLink")

        return chat_ids

    def _parse_message(
        self,
        item: dict[str, Any],
        channel_id: str | None = None,
        chat_id: str | None = None,
        team_id: str | None = None,
    ) -> TeamsMessage:
        """Parse a message from API response."""
        # Extract sender info
        from_user = None
        if item.get("from"):
            user = item["from"].get("user", {})
            from_user = {
                "id": user.get("id"),
                "display_name": user.get("displayName"),
            }

        # Extract content
        body = item.get("body", {})
        content = body.get("content", "")
        content_type = body.get("contentType", "text")

        # Strip HTML if needed
        if content_type == "html":
            content = self._html_to_text(content)

        return TeamsMessage(
            id=item["id"],
            channel_id=channel_id,
            chat_id=chat_id,
            team_id=team_id,
            created_datetime=item.get("createdDateTime", ""),
            last_modified_datetime=item.get("lastModifiedDateTime"),
            message_type=item.get("messageType", "message"),
            content=content,
            content_type=content_type,
            from_user=from_user,
            importance=item.get("importance", "normal"),
            mentions=[
                {
                    "id": m.get("id"),
                    "mentioned_id": m.get("mentioned", {}).get("user", {}).get("id"),
                    "mentioned_name": m.get("mentioned", {}).get("user", {}).get("displayName"),
                }
                for m in item.get("mentions", [])
            ],
            attachments=[
                {
                    "id": a.get("id"),
                    "content_type": a.get("contentType"),
                    "name": a.get("name"),
                    "content_url": a.get("contentUrl"),
                }
                for a in item.get("attachments", [])
            ],
            reactions=[
                {
                    "reaction_type": r.get("reactionType"),
                    "user_id": r.get("user", {}).get("user", {}).get("id"),
                }
                for r in item.get("reactions", [])
            ],
            reply_to_id=item.get("replyToId"),
            web_url=item.get("webUrl"),
        )

    def _channel_to_record(self, channel: TeamsChannel) -> dict[str, Any]:
        """Convert TeamsChannel to a record dict."""
        return {
            "id": channel.id,
            "type": "teams_channel",
            "team_id": channel.team_id,
            "display_name": channel.display_name,
            "description": channel.description,
            "membership_type": channel.membership_type,
            "web_url": channel.web_url,
            "created_datetime": channel.created_datetime,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _chat_to_record(self, chat: TeamsChat) -> dict[str, Any]:
        """Convert TeamsChat to a record dict."""
        return {
            "id": chat.id,
            "type": "teams_chat",
            "topic": chat.topic,
            "chat_type": chat.chat_type,
            "created_datetime": chat.created_datetime,
            "last_updated_datetime": chat.last_updated_datetime,
            "members": chat.members,
            "member_count": len(chat.members),
            "web_url": chat.web_url,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _message_to_record(self, message: TeamsMessage) -> dict[str, Any]:
        """Convert TeamsMessage to a record dict."""
        return {
            "id": message.id,
            "type": "teams_message",
            "channel_id": message.channel_id,
            "chat_id": message.chat_id,
            "team_id": message.team_id,
            "created_datetime": message.created_datetime,
            "last_modified_datetime": message.last_modified_datetime,
            "message_type": message.message_type,
            "content": message.content,
            "content_type": message.content_type,
            "from_user_id": message.from_user.get("id") if message.from_user else None,
            "from_user_name": message.from_user.get("display_name") if message.from_user else None,
            "importance": message.importance,
            "mentions": message.mentions,
            "mention_count": len(message.mentions),
            "attachments": message.attachments,
            "attachment_count": len(message.attachments),
            "reactions": message.reactions,
            "reaction_count": len(message.reactions),
            "is_reply": message.reply_to_id is not None,
            "reply_to_id": message.reply_to_id,
            "web_url": message.web_url,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _html_to_text(self, html: str) -> str:
        """Convert HTML to plain text."""
        import re

        text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", "", text)
        text = text.replace("&nbsp;", " ")
        text = text.replace("&amp;", "&")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
        return text.strip()


# Register connector
ConnectorRegistry.register("teams", TeamsConnector)
