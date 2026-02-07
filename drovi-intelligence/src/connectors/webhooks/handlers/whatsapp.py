"""
WhatsApp Business Webhook Handler

Processes incoming WhatsApp webhooks from the Cloud API.
Handles messages, status updates, and message failures.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass
class WhatsAppMessage:
    """Parsed WhatsApp message from webhook."""

    id: str
    from_number: str
    to_number: str
    timestamp: str
    type: str  # text, image, audio, video, document, location, contacts, etc.
    text: str | None = None
    caption: str | None = None
    media_id: str | None = None
    mime_type: str | None = None
    location: dict[str, Any] | None = None
    contacts: list[dict[str, Any]] = field(default_factory=list)
    context: dict[str, Any] | None = None  # Reply context
    reaction: dict[str, Any] | None = None
    is_forwarded: bool = False
    profile_name: str | None = None


@dataclass
class WhatsAppStatus:
    """Parsed WhatsApp status update."""

    message_id: str
    recipient_id: str
    status: str  # sent, delivered, read, failed
    timestamp: str
    conversation_id: str | None = None
    pricing_model: str | None = None
    error_code: str | None = None
    error_title: str | None = None


class WhatsAppWebhookHandler:
    """
    Handler for WhatsApp Business API webhooks.

    Processes events from WhatsApp Cloud API:
    - Incoming messages (text, media, location, contacts)
    - Message status updates (sent, delivered, read, failed)
    - System events

    WhatsApp Cloud API sends webhooks for all message events.
    Messages should be stored locally for later sync.
    """

    # Message types to process
    SUPPORTED_MESSAGE_TYPES = {
        "text",
        "image",
        "audio",
        "video",
        "document",
        "sticker",
        "location",
        "contacts",
        "reaction",
        "button",  # Button reply
        "interactive",  # List/button response
    }

    # Status types
    STATUS_TYPES = {"sent", "delivered", "read", "failed"}

    def __init__(self):
        """Initialize WhatsApp webhook handler."""
        self._messages_to_store: list[WhatsAppMessage] = []

    async def handle_webhook(self, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Handle a WhatsApp Cloud API webhook.

        Args:
            payload: Full webhook payload

        Returns:
            Response dict with processing status
        """
        # WhatsApp expects a 200 response quickly
        # Process asynchronously if needed

        messages_processed = 0
        statuses_processed = 0
        errors = 0

        try:
            entries = payload.get("entry", [])

            for entry in entries:
                changes = entry.get("changes", [])

                for change in changes:
                    field = change.get("field")

                    if field == "messages":
                        value = change.get("value", {})

                        # Process messages
                        messages = value.get("messages", [])
                        for msg in messages:
                            try:
                                await self._handle_message(msg, value)
                                messages_processed += 1
                            except Exception as e:
                                logger.error(
                                    "Failed to process WhatsApp message",
                                    error=str(e),
                                )
                                errors += 1

                        # Process status updates
                        statuses = value.get("statuses", [])
                        for status in statuses:
                            try:
                                await self._handle_status(status)
                                statuses_processed += 1
                            except Exception as e:
                                logger.error(
                                    "Failed to process WhatsApp status",
                                    error=str(e),
                                )
                                errors += 1

        except Exception as e:
            logger.error("Failed to process WhatsApp webhook", error=str(e))
            errors += 1

        return {
            "status": "processed",
            "messages_processed": messages_processed,
            "statuses_processed": statuses_processed,
            "errors": errors,
        }

    async def verify_webhook(
        self,
        mode: str,
        token: str,
        challenge: str,
        verify_token: str,
    ) -> str | None:
        """
        Verify webhook subscription (GET request from WhatsApp).

        Args:
            mode: Should be "subscribe"
            token: Verify token sent by WhatsApp
            challenge: Challenge string to return
            verify_token: Our configured verify token

        Returns:
            Challenge string if verification passes, None otherwise
        """
        if mode == "subscribe" and token == verify_token:
            logger.info("WhatsApp webhook verified")
            return challenge
        else:
            logger.warning(
                "WhatsApp webhook verification failed",
                mode=mode,
                token_match=token == verify_token,
            )
            return None

    async def _handle_message(
        self,
        msg: dict[str, Any],
        value: dict[str, Any],
    ) -> None:
        """
        Handle an incoming message.

        Args:
            msg: Message object from webhook
            value: Parent value object containing metadata
        """
        msg_type = msg.get("type", "unknown")

        if msg_type not in self.SUPPORTED_MESSAGE_TYPES:
            logger.debug("Unsupported message type", type=msg_type)
            return

        # Extract metadata
        metadata = value.get("metadata", {})
        phone_number_id = metadata.get("phone_number_id")
        display_phone_number = metadata.get("display_phone_number")

        # Extract contact info
        contacts = value.get("contacts", [])
        contact = contacts[0] if contacts else {}
        profile_name = contact.get("profile", {}).get("name")
        wa_id = contact.get("wa_id")

        # Parse message content
        message = self._parse_message(
            msg=msg,
            msg_type=msg_type,
            to_number=display_phone_number or "",
            profile_name=profile_name,
        )

        logger.info(
            "WhatsApp message received",
            message_id=message.id,
            from_number=message.from_number,
            type=message.type,
            phone_number_id=phone_number_id,
        )

        # Store message for later sync
        await self._store_message(message, phone_number_id)

        # Trigger intelligence extraction
        await self._process_for_intelligence(message, phone_number_id)

    def _parse_message(
        self,
        msg: dict[str, Any],
        msg_type: str,
        to_number: str,
        profile_name: str | None,
    ) -> WhatsAppMessage:
        """Parse a message from webhook payload."""
        text = None
        caption = None
        media_id = None
        mime_type = None
        location = None
        contacts = []
        reaction = None

        # Extract content based on type
        if msg_type == "text":
            text = msg.get("text", {}).get("body")

        elif msg_type in ("image", "video", "audio", "document", "sticker"):
            media_data = msg.get(msg_type, {})
            media_id = media_data.get("id")
            mime_type = media_data.get("mime_type")
            caption = media_data.get("caption")

        elif msg_type == "location":
            loc = msg.get("location", {})
            location = {
                "latitude": loc.get("latitude"),
                "longitude": loc.get("longitude"),
                "name": loc.get("name"),
                "address": loc.get("address"),
            }

        elif msg_type == "contacts":
            contacts = msg.get("contacts", [])

        elif msg_type == "reaction":
            reaction = msg.get("reaction", {})
            text = reaction.get("emoji")

        elif msg_type == "button":
            text = msg.get("button", {}).get("text")

        elif msg_type == "interactive":
            interactive = msg.get("interactive", {})
            reply_type = interactive.get("type")
            if reply_type == "button_reply":
                text = interactive.get("button_reply", {}).get("title")
            elif reply_type == "list_reply":
                text = interactive.get("list_reply", {}).get("title")

        # Extract context (for replies)
        context = None
        if "context" in msg:
            ctx = msg["context"]
            context = {
                "message_id": ctx.get("id"),
                "from": ctx.get("from"),
            }

        return WhatsAppMessage(
            id=msg.get("id", ""),
            from_number=msg.get("from", ""),
            to_number=to_number,
            timestamp=msg.get("timestamp", ""),
            type=msg_type,
            text=text,
            caption=caption,
            media_id=media_id,
            mime_type=mime_type,
            location=location,
            contacts=contacts,
            context=context,
            reaction=reaction,
            is_forwarded=msg.get("context", {}).get("forwarded", False),
            profile_name=profile_name,
        )

    async def _handle_status(self, status: dict[str, Any]) -> None:
        """
        Handle a message status update.

        Args:
            status: Status object from webhook
        """
        parsed_status = WhatsAppStatus(
            message_id=status.get("id", ""),
            recipient_id=status.get("recipient_id", ""),
            status=status.get("status", ""),
            timestamp=status.get("timestamp", ""),
            conversation_id=status.get("conversation", {}).get("id"),
            pricing_model=status.get("pricing", {}).get("pricing_model"),
        )

        # Handle errors
        if parsed_status.status == "failed":
            errors = status.get("errors", [])
            if errors:
                error = errors[0]
                parsed_status.error_code = str(error.get("code"))
                parsed_status.error_title = error.get("title")

            logger.warning(
                "WhatsApp message delivery failed",
                message_id=parsed_status.message_id,
                error_code=parsed_status.error_code,
                error_title=parsed_status.error_title,
            )
        else:
            logger.info(
                "WhatsApp message status update",
                message_id=parsed_status.message_id,
                status=parsed_status.status,
                recipient_id=parsed_status.recipient_id,
            )

        # Update message status in database
        await self._update_message_status(parsed_status)

    async def _store_message(
        self,
        message: WhatsAppMessage,
        phone_number_id: str | None,
    ) -> None:
        """
        Store message in database for later sync.

        WhatsApp Cloud API doesn't provide message history,
        so we must store incoming messages from webhooks.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO whatsapp_messages (
                        message_id, phone_number_id, wa_id, profile_name,
                        from_number, to_number, timestamp, message_type,
                        text, caption, media_id, mime_type,
                        location, contacts, context, is_forwarded,
                        created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8,
                        $9, $10, $11, $12, $13, $14, $15, $16, NOW()
                    )
                    ON CONFLICT (message_id) DO NOTHING
                    """,
                    message.id,
                    phone_number_id,
                    message.from_number,
                    message.profile_name,
                    message.from_number,
                    message.to_number,
                    message.timestamp,
                    message.type,
                    message.text,
                    message.caption,
                    message.media_id,
                    message.mime_type,
                    message.location,
                    message.contacts,
                    message.context,
                    message.is_forwarded,
                )

                logger.debug(
                    "WhatsApp message stored",
                    message_id=message.id,
                    phone_number_id=phone_number_id,
                )

        except Exception as e:
            logger.error(
                "Failed to store WhatsApp message",
                message_id=message.id,
                error=str(e),
            )

    async def _update_message_status(self, status: WhatsAppStatus) -> None:
        """
        Update message status in database.
        """
        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE whatsapp_messages
                    SET delivery_status = $2,
                        status_updated_at = NOW(),
                        error_code = $3,
                        error_title = $4
                    WHERE message_id = $1
                    """,
                    status.message_id,
                    status.status,
                    status.error_code,
                    status.error_title,
                )

        except Exception as e:
            logger.error(
                "Failed to update WhatsApp message status",
                message_id=status.message_id,
                error=str(e),
            )

    async def _process_for_intelligence(
        self,
        message: WhatsAppMessage,
        phone_number_id: str | None,
    ) -> None:
        """
        Process message for intelligence extraction.

        Triggers the intelligence pipeline for new messages.
        """
        # Skip non-text messages for now
        content = message.text or message.caption
        if not content:
            return

        try:
            # Find connection for this phone number
            connection_id = await self._find_connection_for_phone(phone_number_id)
            if not connection_id:
                logger.debug(
                    "No connection found for WhatsApp phone",
                    phone_number_id=phone_number_id,
                )
                return

            # Get organization ID
            from src.db.client import get_db_pool

            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT organization_id FROM connections WHERE id = $1",
                    connection_id,
                )
                if not row:
                    return
                organization_id = str(row["organization_id"])

            # Queue for intelligence extraction via the Kafka event plane.
            #
            # This keeps webhook handlers fast and makes processing restart-safe.
            from src.config import get_settings
            from src.ingestion.priority import compute_ingest_priority
            from src.streaming.kafka_producer import get_kafka_producer

            settings = get_settings()
            if not settings.kafka_enabled:
                # Fallback for dev/test when Kafka is disabled: run extraction inline.
                from src.orchestrator.graph import run_intelligence_extraction

                await run_intelligence_extraction(
                    content=content,
                    organization_id=organization_id,
                    source_type="whatsapp",
                    source_id=message.id,
                    source_account_id=str(connection_id),
                    conversation_id=None,
                    message_ids=[message.id],
                    user_email=None,
                    user_name=message.profile_name,
                    metadata={
                        "connector_type": "whatsapp",
                        "connection_id": str(connection_id),
                        "message_id": message.id,
                        "from_number": message.from_number,
                        "to_number": message.to_number,
                        "profile_name": message.profile_name,
                        "is_reply": message.context is not None,
                    },
                )
            else:
                producer = await get_kafka_producer()
                priority = compute_ingest_priority(
                    source_type="whatsapp",
                    job_type="webhook",
                )
                await producer.produce_raw_event(
                    organization_id=organization_id,
                    source_type="whatsapp",
                    event_type="whatsapp.message.received",
                    source_id=message.id,
                    priority=priority,
                    payload={
                        "connector_type": "whatsapp",
                        "connection_id": str(connection_id),
                        "job_type": "webhook",
                        # Keep the key as `text` so normalization extracts content reliably.
                        "text": content,
                        "metadata": {
                            "message_id": message.id,
                            "from_number": message.from_number,
                            "to_number": message.to_number,
                            "profile_name": message.profile_name,
                            "is_reply": message.context is not None,
                        },
                    },
                )

            logger.info(
                "WhatsApp message queued for intelligence extraction",
                message_id=message.id,
                organization_id=organization_id,
            )

        except Exception as e:
            logger.error(
                "Failed to queue WhatsApp message for intelligence",
                message_id=message.id,
                error=str(e),
            )

    async def _find_connection_for_phone(
        self,
        phone_number_id: str | None,
    ) -> str | None:
        """
        Find the connection ID for a WhatsApp phone number.
        """
        if not phone_number_id:
            return None

        from src.db.client import get_db_pool

        try:
            pool = await get_db_pool()
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT id FROM connections
                    WHERE connector_type = 'whatsapp'
                    AND config->>'phone_number_id' = $1
                    AND status = 'active'
                    LIMIT 1
                    """,
                    phone_number_id,
                )
                return row["id"] if row else None

        except Exception as e:
            logger.error(
                "Failed to find connection for WhatsApp phone",
                phone_number_id=phone_number_id,
                error=str(e),
            )
            return None
