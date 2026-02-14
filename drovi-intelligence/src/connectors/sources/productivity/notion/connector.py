"""
Notion Connector

Extracts pages, databases, and content from Notion workspaces.
Implements incremental sync using last_edited_time.
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
from src.connectors.sources.productivity.notion.definition import CAPABILITIES, OAUTH_SCOPES, default_streams

logger = structlog.get_logger()

NOTION_API_VERSION = "2022-06-28"
NOTION_BASE_URL = "https://api.notion.com/v1"


@dataclass
class NotionBlock:
    """Represents a Notion block."""

    id: str
    type: str
    created_time: str
    last_edited_time: str
    has_children: bool
    parent_id: str | None = None
    content: dict[str, Any] = field(default_factory=dict)
    children: list["NotionBlock"] = field(default_factory=list)


@dataclass
class NotionPage:
    """Represents a Notion page."""

    id: str
    title: str
    url: str
    created_time: str
    last_edited_time: str
    created_by: str | None = None
    last_edited_by: str | None = None
    parent_type: str | None = None
    parent_id: str | None = None
    properties: dict[str, Any] = field(default_factory=dict)
    content_blocks: list[NotionBlock] = field(default_factory=list)
    plain_text_content: str = ""


@dataclass
class NotionDatabase:
    """Represents a Notion database."""

    id: str
    title: str
    url: str
    created_time: str
    last_edited_time: str
    properties_schema: dict[str, Any] = field(default_factory=dict)
    rows: list[dict[str, Any]] = field(default_factory=list)


class NotionConnector(BaseConnector):
    """
    Connector for Notion workspaces.

    Extracts:
    - Pages (with full block content)
    - Databases (with schema and rows)

    Supports incremental sync based on last_edited_time.
    """

    connector_type = "notion"

    capabilities = CAPABILITIES

    SCOPES = list(OAUTH_SCOPES)

    def __init__(self):
        """Initialize Notion connector."""
        self._client: httpx.AsyncClient | None = None
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if Notion credentials are valid."""
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
                    url=f"{NOTION_BASE_URL}/users/me",
                    operation="check_connection",
                    headers=self._get_headers(access_token),
                )

                if response.status_code == 200:
                    user = response.json()
                    logger.info(
                        "Notion connection verified",
                        user_type=user.get("type"),
                        user_name=user.get("name"),
                    )
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"Notion API error: {response.status_code}"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Notion streams."""
        return default_streams()

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from a Notion stream."""
        self._access_token = config.get_credential("access_token")

        if stream.stream_name == "pages":
            async for batch in self._read_pages(config, stream, state):
                yield batch
        elif stream.stream_name == "databases":
            async for batch in self._read_databases(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_pages(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read pages from Notion."""
        cursor = state.get_cursor(stream.stream_name)
        last_sync_time = cursor.get("last_edited_time") if cursor else None

        # Build search filter
        filter_params: dict[str, Any] = {
            "filter": {"property": "object", "value": "page"},
            "sort": {"direction": "descending", "timestamp": "last_edited_time"},
            "page_size": 100,
        }

        has_more = True
        start_cursor = None

        async with httpx.AsyncClient(timeout=60.0) as client:
            while has_more:
                if start_cursor:
                    filter_params["start_cursor"] = start_cursor

                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="POST",
                    url=f"{NOTION_BASE_URL}/search",
                    operation="read_pages",
                    headers=self._get_headers(self._access_token),
                    json=filter_params,
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                newest_time = last_sync_time

                for result in data.get("results", []):
                    page_edited = result.get("last_edited_time")

                    # Skip if already synced
                    if last_sync_time and page_edited <= last_sync_time:
                        has_more = False
                        break

                    # Fetch full page content
                    page = await self._fetch_page_content(config, client, result)
                    record = self.create_record(
                        record_id=page.id,
                        stream_name=stream.stream_name,
                        data=self._page_to_record(page),
                        cursor_value=page.last_edited_time,
                    )
                    record.record_type = RecordType.DOCUMENT
                    batch.add_record(record)

                    # Track newest time
                    if not newest_time or page_edited > newest_time:
                        newest_time = page_edited

                if batch.records:
                    batch.complete(
                        next_cursor={"last_edited_time": newest_time} if newest_time else None,
                        has_more=bool(data.get("has_more", False)),
                    )
                    yield batch

                has_more = has_more and data.get("has_more", False)
                start_cursor = data.get("next_cursor")

    async def _read_databases(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read databases from Notion."""
        cursor = state.get_cursor(stream.stream_name)
        last_sync_time = cursor.get("last_edited_time") if cursor else None

        filter_params: dict[str, Any] = {
            "filter": {"property": "object", "value": "database"},
            "sort": {"direction": "descending", "timestamp": "last_edited_time"},
            "page_size": 100,
        }

        has_more = True
        start_cursor = None

        async with httpx.AsyncClient(timeout=60.0) as client:
            while has_more:
                if start_cursor:
                    filter_params["start_cursor"] = start_cursor

                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="POST",
                    url=f"{NOTION_BASE_URL}/search",
                    operation="read_databases",
                    headers=self._get_headers(self._access_token),
                    json=filter_params,
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                newest_time = last_sync_time

                for result in data.get("results", []):
                    db_edited = result.get("last_edited_time")

                    if last_sync_time and db_edited <= last_sync_time:
                        has_more = False
                        break

                    # Fetch database with rows
                    db = await self._fetch_database_rows(config, client, result)
                    record = self.create_record(
                        record_id=db.id,
                        stream_name=stream.stream_name,
                        data=self._database_to_record(db),
                        cursor_value=db.last_edited_time,
                    )
                    record.record_type = RecordType.DOCUMENT
                    batch.add_record(record)

                    if not newest_time or db_edited > newest_time:
                        newest_time = db_edited

                if batch.records:
                    batch.complete(
                        next_cursor={"last_edited_time": newest_time} if newest_time else None,
                        has_more=bool(data.get("has_more", False)),
                    )
                    yield batch

                has_more = has_more and data.get("has_more", False)
                start_cursor = data.get("next_cursor")

    async def _fetch_page_content(
        self,
        config: ConnectorConfig,
        client: httpx.AsyncClient,
        page_data: dict[str, Any],
    ) -> NotionPage:
        """Fetch full content of a Notion page including blocks."""
        page_id = page_data["id"]

        # Extract title
        title = self._extract_title(page_data.get("properties", {}))

        # Fetch blocks
        blocks = await self._fetch_blocks(config, client, page_id)

        # Convert blocks to plain text
        plain_text = self._blocks_to_plain_text(blocks)

        # Extract parent info
        parent = page_data.get("parent", {})
        parent_type = parent.get("type")
        parent_id = parent.get(parent_type) if parent_type else None

        return NotionPage(
            id=page_id,
            title=title,
            url=page_data.get("url", ""),
            created_time=page_data.get("created_time", ""),
            last_edited_time=page_data.get("last_edited_time", ""),
            created_by=page_data.get("created_by", {}).get("id"),
            last_edited_by=page_data.get("last_edited_by", {}).get("id"),
            parent_type=parent_type,
            parent_id=parent_id,
            properties=page_data.get("properties", {}),
            content_blocks=blocks,
            plain_text_content=plain_text,
        )

    async def _fetch_blocks(
        self,
        config: ConnectorConfig,
        client: httpx.AsyncClient,
        block_id: str,
        depth: int = 0,
        max_depth: int = 3,
    ) -> list[NotionBlock]:
        """Recursively fetch blocks and their children."""
        if depth > max_depth:
            return []

        blocks = []
        start_cursor = None
        has_more = True

        while has_more:
            params = {"page_size": 100}
            if start_cursor:
                params["start_cursor"] = start_cursor

            response = await connector_request(
                connector=self,
                config=config,
                client=client,
                method="GET",
                url=f"{NOTION_BASE_URL}/blocks/{block_id}/children",
                operation="fetch_blocks",
                headers=self._get_headers(self._access_token),
                params=params,
            )
            response.raise_for_status()
            data = response.json()

            for block_data in data.get("results", []):
                block = NotionBlock(
                    id=block_data["id"],
                    type=block_data["type"],
                    created_time=block_data.get("created_time", ""),
                    last_edited_time=block_data.get("last_edited_time", ""),
                    has_children=block_data.get("has_children", False),
                    parent_id=block_id,
                    content=block_data.get(block_data["type"], {}),
                )

                # Fetch children if any
                if block.has_children:
                    block.children = await self._fetch_blocks(
                        config, client, block.id, depth + 1, max_depth
                    )

                blocks.append(block)

            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")

        return blocks

    async def _fetch_database_rows(
        self,
        config: ConnectorConfig,
        client: httpx.AsyncClient,
        db_data: dict[str, Any],
    ) -> NotionDatabase:
        """Fetch database schema and rows."""
        db_id = db_data["id"]
        title = self._extract_title_from_list(db_data.get("title", []))

        # Fetch rows (pages in the database)
        rows = []
        start_cursor = None
        has_more = True

        while has_more:
            params: dict[str, Any] = {"page_size": 100}
            if start_cursor:
                params["start_cursor"] = start_cursor

            response = await connector_request(
                connector=self,
                config=config,
                client=client,
                method="POST",
                url=f"{NOTION_BASE_URL}/databases/{db_id}/query",
                operation="fetch_database_rows",
                headers=self._get_headers(self._access_token),
                json=params,
            )
            response.raise_for_status()
            data = response.json()

            for row in data.get("results", []):
                rows.append({
                    "id": row["id"],
                    "properties": self._parse_properties(row.get("properties", {})),
                    "created_time": row.get("created_time"),
                    "last_edited_time": row.get("last_edited_time"),
                })

            has_more = data.get("has_more", False)
            start_cursor = data.get("next_cursor")

        return NotionDatabase(
            id=db_id,
            title=title,
            url=db_data.get("url", ""),
            created_time=db_data.get("created_time", ""),
            last_edited_time=db_data.get("last_edited_time", ""),
            properties_schema=db_data.get("properties", {}),
            rows=rows,
        )

    def _get_headers(self, access_token: str | None) -> dict[str, str]:
        """Get headers for Notion API requests."""
        return {
            "Authorization": f"Bearer {access_token}",
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
        }

    def _extract_title(self, properties: dict[str, Any]) -> str:
        """Extract title from page properties."""
        for prop in properties.values():
            if prop.get("type") == "title":
                title_list = prop.get("title", [])
                return self._extract_title_from_list(title_list)
        return "Untitled"

    def _extract_title_from_list(self, title_list: list[dict[str, Any]]) -> str:
        """Extract plain text from a rich text list."""
        return "".join(
            item.get("plain_text", "") for item in title_list
        ) or "Untitled"

    def _blocks_to_plain_text(self, blocks: list[NotionBlock]) -> str:
        """Convert blocks to plain text content."""
        text_parts = []

        for block in blocks:
            block_text = self._block_to_text(block)
            if block_text:
                text_parts.append(block_text)

            # Recursively process children
            if block.children:
                child_text = self._blocks_to_plain_text(block.children)
                if child_text:
                    text_parts.append(child_text)

        return "\n".join(text_parts)

    def _block_to_text(self, block: NotionBlock) -> str:
        """Convert a single block to plain text."""
        content = block.content

        # Text-based blocks
        if block.type in (
            "paragraph",
            "heading_1",
            "heading_2",
            "heading_3",
            "bulleted_list_item",
            "numbered_list_item",
            "toggle",
            "quote",
            "callout",
        ):
            rich_text = content.get("rich_text", [])
            return self._extract_title_from_list(rich_text)

        # To-do blocks
        if block.type == "to_do":
            checked = "☑" if content.get("checked") else "☐"
            text = self._extract_title_from_list(content.get("rich_text", []))
            return f"{checked} {text}"

        # Code blocks
        if block.type == "code":
            code = self._extract_title_from_list(content.get("rich_text", []))
            language = content.get("language", "")
            return f"```{language}\n{code}\n```"

        return ""

    def _parse_properties(self, properties: dict[str, Any]) -> dict[str, Any]:
        """Parse database row properties into simple values."""
        parsed = {}

        for name, prop in properties.items():
            prop_type = prop.get("type")
            value = None

            if prop_type == "title":
                value = self._extract_title_from_list(prop.get("title", []))
            elif prop_type == "rich_text":
                value = self._extract_title_from_list(prop.get("rich_text", []))
            elif prop_type == "number":
                value = prop.get("number")
            elif prop_type == "select":
                select = prop.get("select")
                value = select.get("name") if select else None
            elif prop_type == "multi_select":
                value = [s.get("name") for s in prop.get("multi_select", [])]
            elif prop_type == "date":
                date = prop.get("date")
                value = date.get("start") if date else None
            elif prop_type == "checkbox":
                value = prop.get("checkbox")
            elif prop_type == "url":
                value = prop.get("url")
            elif prop_type == "email":
                value = prop.get("email")
            elif prop_type == "phone_number":
                value = prop.get("phone_number")
            elif prop_type == "people":
                value = [p.get("id") for p in prop.get("people", [])]
            elif prop_type == "relation":
                value = [r.get("id") for r in prop.get("relation", [])]
            elif prop_type == "status":
                status = prop.get("status")
                value = status.get("name") if status else None

            parsed[name] = value

        return parsed

    def _page_to_record(self, page: NotionPage) -> dict[str, Any]:
        """Convert NotionPage to a record dict."""
        return {
            "id": page.id,
            "type": "notion_page",
            "title": page.title,
            "url": page.url,
            "created_time": page.created_time,
            "last_edited_time": page.last_edited_time,
            "created_by": page.created_by,
            "last_edited_by": page.last_edited_by,
            "parent_type": page.parent_type,
            "parent_id": page.parent_id,
            "properties": page.properties,
            "content": page.plain_text_content,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _database_to_record(self, db: NotionDatabase) -> dict[str, Any]:
        """Convert NotionDatabase to a record dict."""
        return {
            "id": db.id,
            "type": "notion_database",
            "title": db.title,
            "url": db.url,
            "created_time": db.created_time,
            "last_edited_time": db.last_edited_time,
            "properties_schema": db.properties_schema,
            "rows": db.rows,
            "row_count": len(db.rows),
            "extracted_at": datetime.utcnow().isoformat(),
        }


# Register connector
ConnectorRegistry.register("notion", NotionConnector)
