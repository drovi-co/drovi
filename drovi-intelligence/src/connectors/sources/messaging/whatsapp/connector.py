"""
WhatsApp Business Connector

Extracts messages from WhatsApp Business API (Cloud API).
Supports webhook-based real-time message ingestion.
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
from src.connectors.http import request_with_retry

logger = structlog.get_logger()

WHATSAPP_GRAPH_URL = "https://graph.facebook.com/v18.0"


@dataclass
class WhatsAppMessage:
    """Represents a WhatsApp message."""

    id: str
    from_number: str
    to_number: str
    timestamp: str
    type: str  # text, image, audio, video, document, location, contacts, etc.
    text: str | None = None
    caption: str | None = None
    media_id: str | None = None
    media_url: str | None = None
    mime_type: str | None = None
    location: dict[str, Any] | None = None
    contacts: list[dict[str, Any]] = field(default_factory=list)
    context: dict[str, Any] | None = None  # Reply context
    reaction: dict[str, Any] | None = None
    is_forwarded: bool = False
    is_frequently_forwarded: bool = False


@dataclass
class WhatsAppContact:
    """Represents a WhatsApp contact."""

    wa_id: str  # WhatsApp ID (phone number)
    profile_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None


class WhatsAppConnector(BaseConnector):
    """
    Connector for WhatsApp Business API.

    Extracts:
    - Messages (text, media, location, contacts)
    - Contact profiles

    Note: WhatsApp Cloud API is primarily webhook-based.
    This connector handles webhook payloads and can fetch media.
    """

    def __init__(self):
        """Initialize WhatsApp connector."""
        self._access_token: str | None = None
        self._phone_number_id: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if WhatsApp credentials are valid."""
        try:
            access_token = config.get_credential("access_token")
            phone_number_id = config.get_credential("phone_number_id")

            if not access_token:
                return False, "Missing access_token in credentials"
            if not phone_number_id:
                return False, "Missing phone_number_id in credentials"

            async with httpx.AsyncClient() as client:
                response = await request_with_retry(
                    client,
                    "GET",
                    f"{WHATSAPP_GRAPH_URL}/{phone_number_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )

                if response.status_code == 200:
                    data = response.json()
                    logger.info(
                        "WhatsApp connection verified",
                        phone_number=data.get("display_phone_number"),
                    )
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"WhatsApp API error: {response.status_code}"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available WhatsApp streams."""
        return [
            StreamConfig(
                stream_name="messages",
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="timestamp",
            ),
            StreamConfig(
                stream_name="contacts",
                sync_mode=SyncMode.FULL_REFRESH,
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from WhatsApp."""
        self._access_token = config.get_credential("access_token")
        self._phone_number_id = config.get_credential("phone_number_id")

        if stream.stream_name == "messages":
            async for batch in self._read_messages(config, stream, state):
                yield batch
        elif stream.stream_name == "contacts":
            async for batch in self._read_contacts(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_messages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """
        Read messages from WhatsApp.

        Note: WhatsApp Cloud API doesn't provide message history.
        Messages come via webhooks and should be stored locally.
        This reads from a local message store if available.
        """
        # WhatsApp doesn't have a message fetch API - messages come via webhooks
        # This would read from a local database where webhook messages are stored
        from src.db.client import get_db_pool

        cursor = state.get_cursor(stream.stream_name)
        last_timestamp = cursor.get("timestamp") if cursor else None

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                query = """
                    SELECT * FROM whatsapp_messages
                    WHERE phone_number_id = $1
                """
                params = [self._phone_number_id]

                if last_timestamp:
                    query += " AND timestamp > $2"
                    params.append(last_timestamp)

                query += " ORDER BY timestamp ASC LIMIT 1000"

                rows = await conn.fetch(query, *params)

                batch = self.create_batch(stream.stream_name, config.connection_id)
                newest_timestamp = last_timestamp

                for row in rows:
                    message = self._row_to_message(row)
                    record = self.create_record(
                        record_id=message.id,
                        stream_name=stream.stream_name,
                        data=self._message_to_record(message),
                        cursor_value=message.timestamp,
                    )
                    record.record_type = RecordType.MESSAGE
                    batch.add_record(record)

                    if not newest_timestamp or row["timestamp"] > newest_timestamp:
                        newest_timestamp = row["timestamp"]

                if batch.records:
                    batch.complete(
                        next_cursor={"timestamp": newest_timestamp} if newest_timestamp else None,
                        has_more=False,
                    )
                    yield batch

        except Exception as e:
            logger.warning(
                "Could not read WhatsApp messages from database",
                error=str(e),
            )
            # Yield empty batch - messages come via webhooks
            batch = self.create_batch(stream.stream_name, config.connection_id)
            batch.complete(has_more=False)
            yield batch

    async def _read_contacts(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read contacts from local store."""
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT DISTINCT wa_id, profile_name
                    FROM whatsapp_messages
                    WHERE phone_number_id = $1
                    """,
                    self._phone_number_id,
                )

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for row in rows:
                    contact = WhatsAppContact(
                        wa_id=row["wa_id"],
                        profile_name=row.get("profile_name"),
                    )
                    record = self.create_record(
                        record_id=contact.wa_id,
                        stream_name=stream.stream_name,
                        data=self._contact_to_record(contact),
                    )
                    record.record_type = RecordType.CONTACT
                    batch.add_record(record)

                if batch.records:
                    batch.complete(has_more=False)
                    yield batch

        except Exception as e:
            logger.warning(
                "Could not read WhatsApp contacts from database",
                error=str(e),
            )
            batch = self.create_batch(stream.stream_name, config.connection_id)
            batch.complete(has_more=False)
            yield batch

    async def process_webhook(
        self,
        payload: dict[str, Any],
    ) -> list[WhatsAppMessage]:
        """
        Process incoming webhook payload from WhatsApp.

        This is called by the webhook handler to parse messages.
        """
        messages = []

        entry = payload.get("entry", [])
        for e in entry:
            changes = e.get("changes", [])
            for change in changes:
                value = change.get("value", {})

                # Extract messages
                for msg in value.get("messages", []):
                    message = self._parse_webhook_message(msg, value)
                    messages.append(message)

        return messages

    def _parse_webhook_message(
        self,
        msg: dict[str, Any],
        value: dict[str, Any],
    ) -> WhatsAppMessage:
        """Parse a message from webhook payload."""
        msg_type = msg.get("type", "text")

        # Extract text content
        text = None
        caption = None
        media_id = None

        if msg_type == "text":
            text = msg.get("text", {}).get("body")
        elif msg_type in ("image", "video", "audio", "document", "sticker"):
            media = msg.get(msg_type, {})
            media_id = media.get("id")
            caption = media.get("caption")
        elif msg_type == "reaction":
            reaction = msg.get("reaction", {})
            text = reaction.get("emoji")

        # Extract context (for replies)
        context = None
        if "context" in msg:
            context = {
                "message_id": msg["context"].get("id"),
                "from": msg["context"].get("from"),
            }

        # Extract contact info
        contacts_data = value.get("contacts", [])
        from_contact = contacts_data[0] if contacts_data else {}

        return WhatsAppMessage(
            id=msg.get("id", ""),
            from_number=msg.get("from", ""),
            to_number=value.get("metadata", {}).get("display_phone_number", ""),
            timestamp=msg.get("timestamp", ""),
            type=msg_type,
            text=text,
            caption=caption,
            media_id=media_id,
            location=msg.get("location"),
            contacts=msg.get("contacts", []),
            context=context,
            reaction=msg.get("reaction"),
            is_forwarded=msg.get("context", {}).get("forwarded", False),
            is_frequently_forwarded=msg.get("context", {}).get("frequently_forwarded", False),
        )

    async def fetch_media(self, media_id: str) -> tuple[bytes, str] | None:
        """Fetch media content by ID."""
        try:
            async with httpx.AsyncClient() as client:
                # Get media URL
                response = await request_with_retry(
                    client,
                    "GET",
                    f"{WHATSAPP_GRAPH_URL}/{media_id}",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                response.raise_for_status()
                media_data = response.json()
                media_url = media_data.get("url")
                mime_type = media_data.get("mime_type", "application/octet-stream")

                if not media_url:
                    return None

                # Download media
                media_response = await request_with_retry(
                    client,
                    "GET",
                    media_url,
                    headers={"Authorization": f"Bearer {self._access_token}"},
                )
                media_response.raise_for_status()

                return media_response.content, mime_type

        except Exception as e:
            logger.error("Failed to fetch WhatsApp media", media_id=media_id, error=str(e))
            return None

    def _row_to_message(self, row: dict[str, Any]) -> WhatsAppMessage:
        """Convert database row to WhatsAppMessage."""
        return WhatsAppMessage(
            id=row["message_id"],
            from_number=row["from_number"],
            to_number=row["to_number"],
            timestamp=str(row["timestamp"]),
            type=row["message_type"],
            text=row.get("text"),
            caption=row.get("caption"),
            media_id=row.get("media_id"),
            media_url=row.get("media_url"),
            mime_type=row.get("mime_type"),
            location=row.get("location"),
            contacts=row.get("contacts", []),
            context=row.get("context"),
            is_forwarded=row.get("is_forwarded", False),
        )

    def _message_to_record(self, message: WhatsAppMessage) -> dict[str, Any]:
        """Convert WhatsAppMessage to a record dict."""
        # Build content from text or caption
        content = message.text or message.caption or ""

        return {
            "id": message.id,
            "type": "whatsapp_message",
            "message_type": message.type,
            "from_number": message.from_number,
            "to_number": message.to_number,
            "timestamp": message.timestamp,
            "content": content,
            "text": message.text,
            "caption": message.caption,
            "media_id": message.media_id,
            "media_url": message.media_url,
            "mime_type": message.mime_type,
            "location": message.location,
            "contacts": message.contacts,
            "is_reply": message.context is not None,
            "reply_to_message_id": message.context.get("message_id") if message.context else None,
            "is_forwarded": message.is_forwarded,
            "is_frequently_forwarded": message.is_frequently_forwarded,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _contact_to_record(self, contact: WhatsAppContact) -> dict[str, Any]:
        """Convert WhatsAppContact to a record dict."""
        return {
            "id": contact.wa_id,
            "type": "whatsapp_contact",
            "wa_id": contact.wa_id,
            "phone_number": contact.wa_id,
            "profile_name": contact.profile_name,
            "first_name": contact.first_name,
            "last_name": contact.last_name,
            "company": contact.company,
            "extracted_at": datetime.utcnow().isoformat(),
        }


# Register connector
ConnectorRegistry.register("whatsapp", WhatsAppConnector)
