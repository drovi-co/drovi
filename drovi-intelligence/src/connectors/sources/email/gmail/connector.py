"""
Gmail Connector

Extracts emails and threads from Gmail using the Gmail API.
Supports incremental sync via historyId.
"""

import base64
from collections.abc import AsyncIterator
from datetime import datetime
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

import structlog
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorCapabilities, ConnectorRegistry
from src.connectors.base.records import Record, RecordBatch, RecordType, UnifiedMessage
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


class GmailConnector(BaseConnector):
    """
    Gmail data source connector.

    Supports:
    - Messages stream (individual emails)
    - Threads stream (email conversations)
    - Labels stream (Gmail labels)

    Uses historyId for efficient incremental sync.
    """

    connector_type = "gmail"

    capabilities = ConnectorCapabilities(
        supports_incremental=True,
        supports_full_refresh=True,
        supports_backfill=True,
        supports_webhooks=True,  # Gmail Push Notifications
        supports_real_time=True,
        default_rate_limit_per_minute=250,  # Gmail quota
        supports_concurrency=True,
        max_concurrent_streams=2,
        supports_schema_discovery=True,
    )

    # Gmail API scopes
    SCOPES = [
        "https://www.googleapis.com/auth/gmail.readonly",
    ]

    def __init__(self):
        """Initialize Gmail connector."""
        self._service = None

    def _get_service(self, config: ConnectorConfig) -> Any:
        """Get or create Gmail API service."""
        if self._service:
            return self._service

        credentials = Credentials(
            token=config.auth.access_token,
            refresh_token=config.auth.refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=config.auth.extra.get("client_id", ""),
            client_secret=config.auth.extra.get("client_secret", ""),
        )

        self._service = build("gmail", "v1", credentials=credentials)
        return self._service

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Verify Gmail credentials are valid."""
        try:
            service = self._get_service(config)
            # Try to get profile to verify credentials
            profile = service.users().getProfile(userId="me").execute()

            logger.info(
                "Gmail connection verified",
                email=profile.get("emailAddress"),
                messages_total=profile.get("messagesTotal"),
            )
            return True, None

        except HttpError as e:
            error_msg = f"Gmail API error: {e.reason}"
            logger.error("Gmail connection failed", error=error_msg)
            return False, error_msg
        except Exception as e:
            error_msg = f"Connection error: {str(e)}"
            logger.error("Gmail connection failed", error=error_msg)
            return False, error_msg

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Gmail streams."""
        return [
            StreamConfig(
                stream_name="messages",
                enabled=True,
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="historyId",
                primary_key=["id"],
                batch_size=100,
            ),
            StreamConfig(
                stream_name="threads",
                enabled=True,
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="historyId",
                primary_key=["id"],
                batch_size=50,
            ),
            StreamConfig(
                stream_name="labels",
                enabled=False,  # Optional stream
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
        """Read data from a Gmail stream."""
        if stream.stream_name == "messages":
            async for batch in self._read_messages(config, stream, state):
                yield batch
        elif stream.stream_name == "threads":
            async for batch in self._read_threads(config, stream, state):
                yield batch
        elif stream.stream_name == "labels":
            async for batch in self._read_labels(config, stream, state):
                yield batch
        else:
            raise ValueError(f"Unknown stream: {stream.stream_name}")

    async def _read_messages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read messages using incremental sync."""
        service = self._get_service(config)

        # Get cursor from state
        history_id = None
        if state:
            cursor = state.get_cursor(stream.stream_name)
            history_id = cursor.get("historyId")
        sync_params = config.get_setting("sync_params", {}) or {}
        if sync_params.get("start_history_id"):
            history_id = sync_params.get("start_history_id")

        if history_id and stream.sync_mode == SyncMode.INCREMENTAL:
            # Incremental sync using history API
            async for batch in self._read_messages_incremental(
                service, config, stream, history_id
            ):
                yield batch
        else:
            # Full refresh - list all messages
            async for batch in self._read_messages_full(service, config, stream):
                yield batch

    async def _read_messages_full(
        self,
        service: Any,
        config: ConnectorConfig,
        stream: StreamConfig,
    ) -> AsyncIterator[RecordBatch]:
        """Full refresh of all messages."""
        batch = self.create_batch(stream.stream_name, config.connection_id)
        page_token = None
        total_records = 0
        latest_history_id = None

        # Build query for filtering
        query = config.provider_config.get("query", "")
        sync_params = config.get_setting("sync_params", {}) or {}
        backfill_start = sync_params.get("backfill_start") or config.backfill_start_date
        backfill_end = sync_params.get("backfill_end")
        if backfill_start:
            if isinstance(backfill_start, str):
                try:
                    backfill_start = datetime.fromisoformat(backfill_start)
                except ValueError:
                    backfill_start = None
            if backfill_start:
                query += f" after:{backfill_start.strftime('%Y/%m/%d')}"
        if backfill_end:
            if isinstance(backfill_end, str):
                try:
                    backfill_end = datetime.fromisoformat(backfill_end)
                except ValueError:
                    backfill_end = None
            if backfill_end:
                query += f" before:{backfill_end.strftime('%Y/%m/%d')}"

        while True:
            try:
                # List messages
                results = service.users().messages().list(
                    userId="me",
                    maxResults=stream.batch_size,
                    pageToken=page_token,
                    q=query.strip() if query.strip() else None,
                ).execute()

                messages = results.get("messages", [])

                for msg_ref in messages:
                    # Fetch full message
                    msg = service.users().messages().get(
                        userId="me",
                        id=msg_ref["id"],
                        format="full",
                    ).execute()

                    record = self._parse_message(msg, config)
                    batch.add_record(record)
                    total_records += 1

                    # Track latest historyId for cursor
                    msg_history_id = msg.get("historyId")
                    if msg_history_id:
                        if not latest_history_id or int(msg_history_id) > int(latest_history_id):
                            latest_history_id = msg_history_id

                    # Yield batch when full
                    if len(batch.records) >= stream.batch_size:
                        batch.complete(
                            next_cursor={"historyId": latest_history_id} if latest_history_id else None,
                            has_more=True,
                        )
                        yield batch
                        batch = self.create_batch(stream.stream_name, config.connection_id)

                # Check for more pages
                page_token = results.get("nextPageToken")
                if not page_token:
                    break

                # Respect max_records limit
                if stream.max_records and total_records >= stream.max_records:
                    break

            except HttpError as e:
                logger.error("Gmail API error", error=str(e))
                raise

        # Yield final batch
        if batch.records:
            batch.complete(
                next_cursor={"historyId": latest_history_id} if latest_history_id else None,
                has_more=False,
            )
            yield batch

    async def _read_messages_incremental(
        self,
        service: Any,
        config: ConnectorConfig,
        stream: StreamConfig,
        start_history_id: str,
    ) -> AsyncIterator[RecordBatch]:
        """Incremental sync using Gmail History API."""
        batch = self.create_batch(stream.stream_name, config.connection_id)
        page_token = None
        latest_history_id = start_history_id
        sync_params = config.get_setting("sync_params", {}) or {}
        history_types = sync_params.get("history_types") or ["messageAdded"]

        while True:
            try:
                # Get history since last sync
                results = service.users().history().list(
                    userId="me",
                    startHistoryId=start_history_id,
                    historyTypes=history_types,
                    maxResults=100,
                    pageToken=page_token,
                ).execute()

                history = results.get("history", [])
                new_history_id = results.get("historyId")

                if new_history_id:
                    latest_history_id = new_history_id

                # Process history records
                for record in history:
                    messages_added = record.get("messagesAdded", [])
                    for msg_added in messages_added:
                        msg_ref = msg_added.get("message", {})

                        # Fetch full message
                        try:
                            msg = service.users().messages().get(
                                userId="me",
                                id=msg_ref["id"],
                                format="full",
                            ).execute()

                            record = self._parse_message(msg, config)
                            batch.add_record(record)

                        except HttpError as e:
                            if e.resp.status == 404:
                                # Message was deleted
                                continue
                            raise

                # Yield batch when full
                if len(batch.records) >= stream.batch_size:
                    batch.complete(
                        next_cursor={"historyId": latest_history_id},
                        has_more=True,
                    )
                    yield batch
                    batch = self.create_batch(stream.stream_name, config.connection_id)

                # Check for more pages
                page_token = results.get("nextPageToken")
                if not page_token:
                    break

            except HttpError as e:
                if e.resp.status == 404:
                    # History expired, need full refresh
                    logger.warning(
                        "Gmail history expired, performing full refresh",
                        history_id=start_history_id,
                    )
                    async for full_batch in self._read_messages_full(service, config, stream):
                        yield full_batch
                    return
                raise

        # Yield final batch
        if batch.records:
            batch.complete(
                next_cursor={"historyId": latest_history_id},
                has_more=False,
            )
            yield batch

    async def _read_threads(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read email threads."""
        service = self._get_service(config)
        batch = self.create_batch(stream.stream_name, config.connection_id)
        page_token = None
        latest_history_id = None

        while True:
            try:
                results = service.users().threads().list(
                    userId="me",
                    maxResults=stream.batch_size,
                    pageToken=page_token,
                ).execute()

                threads = results.get("threads", [])

                for thread_ref in threads:
                    # Fetch full thread
                    thread = service.users().threads().get(
                        userId="me",
                        id=thread_ref["id"],
                        format="full",
                    ).execute()

                    record = self._parse_thread(thread, config)
                    batch.add_record(record)

                    # Track historyId
                    thread_history_id = thread.get("historyId")
                    if thread_history_id:
                        if not latest_history_id or int(thread_history_id) > int(latest_history_id):
                            latest_history_id = thread_history_id

                # Yield batch when full
                if len(batch.records) >= stream.batch_size:
                    batch.complete(
                        next_cursor={"historyId": latest_history_id} if latest_history_id else None,
                        has_more=True,
                    )
                    yield batch
                    batch = self.create_batch(stream.stream_name, config.connection_id)

                page_token = results.get("nextPageToken")
                if not page_token:
                    break

            except HttpError as e:
                logger.error("Gmail API error", error=str(e))
                raise

        # Yield final batch
        if batch.records:
            batch.complete(
                next_cursor={"historyId": latest_history_id} if latest_history_id else None,
                has_more=False,
            )
            yield batch

    async def _read_labels(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """Read Gmail labels."""
        service = self._get_service(config)
        batch = self.create_batch(stream.stream_name, config.connection_id)

        try:
            results = service.users().labels().list(userId="me").execute()
            labels = results.get("labels", [])

            for label in labels:
                record = self.create_record(
                    record_id=label["id"],
                    stream_name=stream.stream_name,
                    data=label,
                )
                record.record_type = RecordType.CUSTOM
                batch.add_record(record)

            batch.complete(has_more=False)
            yield batch

        except HttpError as e:
            logger.error("Gmail API error", error=str(e))
            raise

    def _parse_message(self, msg: dict[str, Any], config: ConnectorConfig) -> Record:
        """Parse Gmail message into Record."""
        headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}

        # Parse sender
        from_header = headers.get("from", "")
        sender_name, sender_email = parseaddr(from_header)

        # Parse recipients
        to_header = headers.get("to", "")
        cc_header = headers.get("cc", "")
        recipients = [parseaddr(addr) for addr in to_header.split(",") if addr.strip()]
        cc_recipients = [parseaddr(addr) for addr in cc_header.split(",") if addr.strip()]

        # Parse date
        date_header = headers.get("date", "")
        sent_at = None
        try:
            sent_at = parsedate_to_datetime(date_header)
        except Exception:
            # Fallback to internal date
            internal_date = msg.get("internalDate")
            if internal_date:
                sent_at = datetime.fromtimestamp(int(internal_date) / 1000)

        # Extract body
        body_text = self._extract_body(msg.get("payload", {}))

        # Get labels
        label_ids = msg.get("labelIds", [])

        # Build unified message
        data = {
            "id": msg["id"],
            "thread_id": msg.get("threadId"),
            "subject": headers.get("subject", ""),
            "body_text": body_text,
            "sender_email": sender_email,
            "sender_name": sender_name,
            "recipient_emails": [email for name, email in recipients],
            "recipient_names": [name for name, email in recipients],
            "cc_emails": [email for name, email in cc_recipients],
            "sent_at": sent_at.isoformat() if sent_at else None,
            "labels": label_ids,
            "is_read": "UNREAD" not in label_ids,
            "snippet": msg.get("snippet", ""),
            "history_id": msg.get("historyId"),
            "internal_date": msg.get("internalDate"),
        }

        record = self.create_record(
            record_id=msg["id"],
            stream_name="messages",
            data=data,
            cursor_value=msg.get("historyId"),
        )
        record.record_type = RecordType.MESSAGE

        return record

    def _parse_thread(self, thread: dict[str, Any], config: ConnectorConfig) -> Record:
        """Parse Gmail thread into Record."""
        messages = thread.get("messages", [])

        # Get thread metadata from first message
        first_msg = messages[0] if messages else {}
        headers = {h["name"].lower(): h["value"] for h in first_msg.get("payload", {}).get("headers", [])}

        # Collect all participants
        participants = set()
        for msg in messages:
            msg_headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
            if msg_headers.get("from"):
                participants.add(parseaddr(msg_headers["from"])[1])
            for to in msg_headers.get("to", "").split(","):
                if to.strip():
                    participants.add(parseaddr(to)[1])

        data = {
            "id": thread["id"],
            "subject": headers.get("subject", ""),
            "snippet": thread.get("snippet", ""),
            "message_count": len(messages),
            "participants": list(participants),
            "history_id": thread.get("historyId"),
            "messages": [
                {
                    "id": msg["id"],
                    "snippet": msg.get("snippet", ""),
                    "internal_date": msg.get("internalDate"),
                }
                for msg in messages
            ],
        }

        record = self.create_record(
            record_id=thread["id"],
            stream_name="threads",
            data=data,
            cursor_value=thread.get("historyId"),
        )
        record.record_type = RecordType.CONVERSATION

        return record

    def _extract_body(self, payload: dict[str, Any]) -> str:
        """Extract plain text body from message payload."""
        body_text = ""

        # Check for direct body
        body = payload.get("body", {})
        if body.get("data"):
            try:
                body_text = base64.urlsafe_b64decode(body["data"]).decode("utf-8")
                return body_text
            except Exception:
                pass

        # Check parts for multipart messages
        parts = payload.get("parts", [])
        for part in parts:
            mime_type = part.get("mimeType", "")

            if mime_type == "text/plain":
                part_body = part.get("body", {})
                if part_body.get("data"):
                    try:
                        body_text = base64.urlsafe_b64decode(part_body["data"]).decode("utf-8")
                        return body_text
                    except Exception:
                        pass

            # Recurse into nested parts
            if "parts" in part:
                nested_text = self._extract_body(part)
                if nested_text:
                    return nested_text

        # Fallback to HTML if no plain text
        for part in parts:
            if part.get("mimeType") == "text/html":
                part_body = part.get("body", {})
                if part_body.get("data"):
                    try:
                        html = base64.urlsafe_b64decode(part_body["data"]).decode("utf-8")
                        # Strip HTML tags (basic)
                        import re
                        body_text = re.sub(r"<[^>]+>", " ", html)
                        body_text = re.sub(r"\s+", " ", body_text).strip()
                        return body_text
                    except Exception:
                        pass

        return body_text

    def to_unified_message(self, record: Record, config: ConnectorConfig) -> UnifiedMessage:
        """Convert Gmail record to UnifiedMessage."""
        data = record.data

        return UnifiedMessage(
            id=f"gmail:{data['id']}",
            source_type="gmail",
            source_id=data["id"],
            connection_id=config.connection_id,
            organization_id=config.organization_id,
            subject=data.get("subject"),
            body_text=data.get("body_text", ""),
            sender_email=data.get("sender_email"),
            sender_name=data.get("sender_name"),
            recipient_emails=data.get("recipient_emails", []),
            recipient_names=data.get("recipient_names", []),
            cc_emails=data.get("cc_emails", []),
            thread_id=data.get("thread_id"),
            is_reply=bool(data.get("thread_id")),
            sent_at=datetime.fromisoformat(data["sent_at"]) if data.get("sent_at") else datetime.utcnow(),
            labels=data.get("labels", []),
            is_read=data.get("is_read", False),
            raw_data_hash=record.raw_data_hash,
        )


# Register connector
ConnectorRegistry._connectors["gmail"] = GmailConnector
