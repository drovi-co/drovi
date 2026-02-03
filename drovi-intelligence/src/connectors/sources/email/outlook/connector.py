"""
Microsoft Outlook Connector

Extracts emails from Outlook/Microsoft 365 via Microsoft Graph API.
Supports incremental sync using delta queries.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, ConnectorCapabilities, RecordBatch, ConnectorRegistry
from src.connectors.base.records import Record, RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http import request_with_retry

logger = structlog.get_logger()

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"


@dataclass
class OutlookMessage:
    """Represents an Outlook email message."""

    id: str
    conversation_id: str | None
    subject: str
    body_preview: str
    body_content: str
    body_content_type: str  # text or html
    from_address: dict[str, str] | None
    to_recipients: list[dict[str, str]]
    cc_recipients: list[dict[str, str]]
    bcc_recipients: list[dict[str, str]]
    sent_datetime: str | None
    received_datetime: str | None
    has_attachments: bool
    importance: str  # low, normal, high
    is_read: bool
    is_draft: bool
    categories: list[str]
    flag: dict[str, Any] | None
    internet_message_id: str | None
    parent_folder_id: str | None
    web_link: str | None
    attachments: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class OutlookFolder:
    """Represents an Outlook mail folder."""

    id: str
    display_name: str
    parent_folder_id: str | None
    child_folder_count: int
    total_item_count: int
    unread_item_count: int


class OutlookConnector(BaseConnector):
    """
    Connector for Microsoft Outlook via Graph API.

    Extracts:
    - Mail folders
    - Email messages (with body, recipients, attachments metadata)

    Supports incremental sync using Microsoft Graph delta queries.
    """

    connector_type = "outlook"

    capabilities = ConnectorCapabilities(
        supports_incremental=True,
        supports_full_refresh=True,
        supports_backfill=True,
        supports_webhooks=True,  # Microsoft Graph webhooks
        supports_real_time=True,
        default_rate_limit_per_minute=60,
        supports_concurrency=True,
        max_concurrent_streams=2,
        supports_schema_discovery=True,
    )

    SCOPES = [
        "Mail.Read",
        "Mail.ReadBasic",
        "User.Read",
        "offline_access",
    ]

    def __init__(self):
        """Initialize Outlook connector."""
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if Outlook credentials are valid."""
        try:
            access_token = config.get_credential("access_token")
            if not access_token:
                return False, "Missing access_token in credentials"

            async with httpx.AsyncClient() as client:
                response = await request_with_retry(
                    client,
                    "GET",
                    f"{GRAPH_BASE_URL}/me",
                    headers={"Authorization": f"Bearer {access_token}"},
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )

                if response.status_code == 200:
                    user = response.json()
                    logger.info(
                        "Outlook connection verified",
                        user_email=user.get("mail"),
                    )
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
        """Discover available Outlook streams."""
        return [
            StreamConfig(
                stream_name="folders",
                sync_mode=SyncMode.FULL_REFRESH,
            ),
            StreamConfig(
                stream_name="messages",
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="deltaLink",
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from Outlook."""
        self._access_token = config.get_credential("access_token")

        if stream.stream_name == "folders":
            async for batch in self._read_folders(config, stream, state):
                yield batch
        elif stream.stream_name == "messages":
            async for batch in self._read_messages(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_folders(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read mail folders from Outlook."""
        skip = 0
        page_size = 100
        has_more = True

        async with httpx.AsyncClient(timeout=30.0) as client:
            while has_more:
                response = await request_with_retry(
                    client,
                    "GET",
                    f"{GRAPH_BASE_URL}/me/mailFolders",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params={
                        "$top": page_size,
                        "$skip": skip,
                        "$select": "id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount",
                    },
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for item in data.get("value", []):
                    folder = OutlookFolder(
                        id=item["id"],
                        display_name=item.get("displayName", ""),
                        parent_folder_id=item.get("parentFolderId"),
                        child_folder_count=item.get("childFolderCount", 0),
                        total_item_count=item.get("totalItemCount", 0),
                        unread_item_count=item.get("unreadItemCount", 0),
                    )
                    record = self.create_record(
                        record_id=folder.id,
                        stream_name=stream.stream_name,
                        data=self._folder_to_record(folder),
                    )
                    record.record_type = RecordType.CUSTOM
                    batch.add_record(record)

                if batch.records:
                    batch.complete(has_more=True)
                    yield batch

                # Check for more pages
                next_link = data.get("@odata.nextLink")
                if next_link:
                    skip += page_size
                else:
                    has_more = False

    async def _read_messages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read email messages using delta queries."""
        cursor = state.get_cursor(stream.stream_name)
        delta_link = cursor.get("deltaLink") if cursor else None

        # Select fields to retrieve
        select_fields = (
            "id,conversationId,subject,bodyPreview,body,from,toRecipients,"
            "ccRecipients,bccRecipients,sentDateTime,receivedDateTime,"
            "hasAttachments,importance,isRead,isDraft,categories,flag,"
            "internetMessageId,parentFolderId,webLink"
        )

        # Start with delta link if available, otherwise start fresh
        if delta_link:
            url = delta_link
        else:
            # Get messages from specific folders or all
            folder_ids = config.get_setting("folder_ids")
            if folder_ids:
                # Sync specific folders
                for folder_id in folder_ids:
                    async for batch in self._read_folder_messages(
                        config.connection_id, folder_id, select_fields
                    ):
                        yield batch
                return
            else:
                # Use delta query for all messages
                url = f"{GRAPH_BASE_URL}/me/messages/delta?$select={select_fields}&$top=100"

        async with httpx.AsyncClient(timeout=60.0) as client:
            while url:
                response = await request_with_retry(
                    client,
                    "GET",
                    url,
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for item in data.get("value", []):
                    # Skip deleted items in delta response
                    if "@removed" in item:
                        continue

                    message = self._parse_message(item)
                    record = self.create_record(
                        record_id=message.id,
                        stream_name=stream.stream_name,
                        data=self._message_to_record(message),
                        cursor_value=message.last_modified_datetime or message.received_datetime,
                    )
                    record.record_type = RecordType.MESSAGE
                    batch.add_record(record)

                # Get next page or delta link
                next_link = data.get("@odata.nextLink")
                new_delta_link = data.get("@odata.deltaLink")

                if batch.records:
                    batch.complete(
                        next_cursor={"deltaLink": new_delta_link} if new_delta_link else None,
                        has_more=bool(next_link),
                    )
                    yield batch

                url = next_link  # Continue to next page if available

    async def _read_folder_messages(
        self,
        connection_id: str,
        folder_id: str,
        select_fields: str,
    ) -> AsyncIterator[RecordBatch]:
        """Read messages from a specific folder."""
        url = (
            f"{GRAPH_BASE_URL}/me/mailFolders/{folder_id}/messages"
            f"?$select={select_fields}&$top=100&$orderby=receivedDateTime desc"
        )

        async with httpx.AsyncClient(timeout=60.0) as client:
            while url:
                response = await request_with_retry(
                    client,
                    "GET",
                    url,
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    rate_limit_key=f"{self.connector_type}:{connection_id}",
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch("messages", connection_id)
                for item in data.get("value", []):
                    message = self._parse_message(item)
                    record = self.create_record(
                        record_id=message.id,
                        stream_name="messages",
                        data=self._message_to_record(message),
                        cursor_value=message.last_modified_datetime or message.received_datetime,
                    )
                    record.record_type = RecordType.MESSAGE
                    batch.add_record(record)

                if batch.records:
                    batch.complete(has_more=bool(data.get("@odata.nextLink")))
                    yield batch

                url = data.get("@odata.nextLink")

    def _parse_message(self, item: dict[str, Any]) -> OutlookMessage:
        """Parse an Outlook message from API response."""
        # Parse from address
        from_data = item.get("from", {}).get("emailAddress", {})
        from_address = {
            "email": from_data.get("address"),
            "name": from_data.get("name"),
        } if from_data else None

        # Parse recipients
        def parse_recipients(recipients: list[dict] | None) -> list[dict[str, str]]:
            if not recipients:
                return []
            return [
                {
                    "email": r.get("emailAddress", {}).get("address"),
                    "name": r.get("emailAddress", {}).get("name"),
                }
                for r in recipients
            ]

        # Parse body
        body = item.get("body", {})

        return OutlookMessage(
            id=item["id"],
            conversation_id=item.get("conversationId"),
            subject=item.get("subject", ""),
            body_preview=item.get("bodyPreview", ""),
            body_content=body.get("content", ""),
            body_content_type=body.get("contentType", "text"),
            from_address=from_address,
            to_recipients=parse_recipients(item.get("toRecipients")),
            cc_recipients=parse_recipients(item.get("ccRecipients")),
            bcc_recipients=parse_recipients(item.get("bccRecipients")),
            sent_datetime=item.get("sentDateTime"),
            received_datetime=item.get("receivedDateTime"),
            has_attachments=item.get("hasAttachments", False),
            importance=item.get("importance", "normal"),
            is_read=item.get("isRead", False),
            is_draft=item.get("isDraft", False),
            categories=item.get("categories", []),
            flag=item.get("flag"),
            internet_message_id=item.get("internetMessageId"),
            parent_folder_id=item.get("parentFolderId"),
            web_link=item.get("webLink"),
        )

    def _folder_to_record(self, folder: OutlookFolder) -> dict[str, Any]:
        """Convert OutlookFolder to a record dict."""
        return {
            "id": folder.id,
            "type": "outlook_folder",
            "display_name": folder.display_name,
            "parent_folder_id": folder.parent_folder_id,
            "child_folder_count": folder.child_folder_count,
            "total_item_count": folder.total_item_count,
            "unread_item_count": folder.unread_item_count,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _message_to_record(self, message: OutlookMessage) -> dict[str, Any]:
        """Convert OutlookMessage to a record dict."""
        # Extract plain text from HTML if needed
        content = message.body_content
        if message.body_content_type == "html":
            content = self._html_to_text(content)

        # Build participant list
        all_recipients = (
            message.to_recipients +
            message.cc_recipients +
            message.bcc_recipients
        )
        participant_emails = [r["email"] for r in all_recipients if r.get("email")]
        if message.from_address and message.from_address.get("email"):
            participant_emails.append(message.from_address["email"])

        return {
            "id": message.id,
            "type": "outlook_email",
            "conversation_id": message.conversation_id,
            "internet_message_id": message.internet_message_id,
            "subject": message.subject,
            "body_preview": message.body_preview,
            "body_content": content,
            "body_content_type": message.body_content_type,
            "from_email": message.from_address.get("email") if message.from_address else None,
            "from_name": message.from_address.get("name") if message.from_address else None,
            "to_recipients": message.to_recipients,
            "cc_recipients": message.cc_recipients,
            "bcc_recipients": message.bcc_recipients,
            "all_participants": list(set(participant_emails)),
            "sent_datetime": message.sent_datetime,
            "received_datetime": message.received_datetime,
            "has_attachments": message.has_attachments,
            "importance": message.importance,
            "is_read": message.is_read,
            "is_draft": message.is_draft,
            "categories": message.categories,
            "is_flagged": message.flag.get("flagStatus") == "flagged" if message.flag else False,
            "folder_id": message.parent_folder_id,
            "web_link": message.web_link,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _html_to_text(self, html: str) -> str:
        """Convert HTML to plain text (basic implementation)."""
        import re

        # Remove style and script tags
        text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)

        # Replace common elements with text equivalents
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</div>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)

        # Remove all remaining HTML tags
        text = re.sub(r"<[^>]+>", "", text)

        # Decode HTML entities
        text = text.replace("&nbsp;", " ")
        text = text.replace("&amp;", "&")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")
        text = text.replace("&quot;", '"')
        text = text.replace("&#39;", "'")

        # Clean up whitespace
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
        text = text.strip()

        return text


# Register connector
ConnectorRegistry.register("outlook", OutlookConnector)
