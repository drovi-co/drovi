"""
Google Docs Connector

Extracts documents from Google Drive, including:
- Google Docs (converted to plain text/markdown)
- Google Sheets (as structured data)
- Google Slides (as text content)
- PDFs and other uploaded files

Supports incremental sync based on modifiedTime.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()

GOOGLE_DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3"
GOOGLE_DOCS_BASE_URL = "https://docs.googleapis.com/v1"


@dataclass
class GoogleDocument:
    """Represents a Google Drive document."""

    id: str
    name: str
    mime_type: str
    created_time: str
    modified_time: str
    web_view_link: str | None
    owners: list[dict[str, Any]]
    last_modifying_user: dict[str, Any] | None
    shared: bool
    starred: bool
    trashed: bool
    parents: list[str]
    content: str = ""
    properties: dict[str, Any] = field(default_factory=dict)


class GoogleDocsConnector(BaseConnector):
    """
    Connector for Google Drive documents.

    Extracts:
    - Google Docs (with full text content)
    - Google Sheets (as CSV/structured data)
    - Google Slides (text extraction)
    - PDF files (metadata, optionally content with Vision API)

    Supports incremental sync based on modifiedTime.
    """

    # MIME types for Google Workspace files
    GOOGLE_DOC_MIME = "application/vnd.google-apps.document"
    GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet"
    GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation"
    GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder"

    # Supported export formats
    EXPORT_FORMATS = {
        GOOGLE_DOC_MIME: "text/plain",
        GOOGLE_SHEET_MIME: "text/csv",
        GOOGLE_SLIDES_MIME: "text/plain",
    }

    def __init__(self):
        """Initialize Google Docs connector."""
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if Google Drive credentials are valid."""
        try:
            access_token = config.credentials.get("access_token")
            if not access_token:
                return False, "Missing access_token in credentials"

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{GOOGLE_DRIVE_BASE_URL}/about",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"fields": "user"},
                )

                if response.status_code == 200:
                    user = response.json().get("user", {})
                    logger.info(
                        "Google Drive connection verified",
                        user_email=user.get("emailAddress"),
                    )
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"Google Drive API error: {response.status_code}"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Google Drive streams."""
        return [
            StreamConfig(
                stream_name="documents",
                sync_mode="incremental",
                cursor_field="modifiedTime",
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from Google Drive."""
        self._access_token = config.credentials.get("access_token")

        if stream.stream_name == "documents":
            async for batch in self._read_documents(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_documents(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read documents from Google Drive."""
        cursor = state.get_cursor(stream.stream_name)
        last_sync_time = cursor.get("modifiedTime") if cursor else None

        # Build query
        query_parts = [
            "trashed = false",
            f"mimeType != '{self.GOOGLE_FOLDER_MIME}'",
        ]

        # Filter by modified time for incremental sync
        if last_sync_time:
            query_parts.append(f"modifiedTime > '{last_sync_time}'")

        # Filter by folder if specified
        folder_ids = config.settings.get("folder_ids")
        if folder_ids:
            folder_conditions = " or ".join(
                f"'{fid}' in parents" for fid in folder_ids
            )
            query_parts.append(f"({folder_conditions})")

        # Filter by MIME types if specified
        mime_types = config.settings.get("mime_types")
        if mime_types:
            mime_conditions = " or ".join(
                f"mimeType = '{mt}'" for mt in mime_types
            )
            query_parts.append(f"({mime_conditions})")

        query = " and ".join(query_parts)

        fields = (
            "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, "
            "webViewLink, owners, lastModifyingUser, shared, starred, trashed, parents)"
        )

        page_token = None
        has_more = True
        newest_time = last_sync_time

        async with httpx.AsyncClient(timeout=60.0) as client:
            while has_more:
                params: dict[str, Any] = {
                    "q": query,
                    "fields": fields,
                    "pageSize": 100,
                    "orderBy": "modifiedTime desc",
                }
                if page_token:
                    params["pageToken"] = page_token

                response = await client.get(
                    f"{GOOGLE_DRIVE_BASE_URL}/files",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

                documents = []
                for file_data in data.get("files", []):
                    # Fetch content for supported types
                    doc = await self._fetch_document_content(client, file_data)
                    documents.append(self._document_to_record(doc))

                    # Track newest modified time
                    modified_time = file_data.get("modifiedTime")
                    if modified_time and (not newest_time or modified_time > newest_time):
                        newest_time = modified_time

                if documents:
                    yield RecordBatch(
                        records=documents,
                        next_cursor={"modifiedTime": newest_time} if newest_time else None,
                    )

                page_token = data.get("nextPageToken")
                has_more = bool(page_token)

    async def _fetch_document_content(
        self,
        client: httpx.AsyncClient,
        file_data: dict[str, Any],
    ) -> GoogleDocument:
        """Fetch document with content."""
        file_id = file_data["id"]
        mime_type = file_data.get("mimeType", "")
        content = ""

        # Export Google Workspace files
        if mime_type in self.EXPORT_FORMATS:
            export_mime = self.EXPORT_FORMATS[mime_type]
            try:
                response = await client.get(
                    f"{GOOGLE_DRIVE_BASE_URL}/files/{file_id}/export",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params={"mimeType": export_mime},
                )
                if response.status_code == 200:
                    content = response.text
            except Exception as e:
                logger.warning(
                    "Failed to export document",
                    file_id=file_id,
                    error=str(e),
                )

        # For Google Docs, also try to get structured content
        if mime_type == self.GOOGLE_DOC_MIME:
            try:
                structured_content = await self._fetch_docs_content(client, file_id)
                if structured_content:
                    content = structured_content
            except Exception as e:
                logger.debug(
                    "Could not fetch structured doc content",
                    file_id=file_id,
                    error=str(e),
                )

        return GoogleDocument(
            id=file_id,
            name=file_data.get("name", ""),
            mime_type=mime_type,
            created_time=file_data.get("createdTime", ""),
            modified_time=file_data.get("modifiedTime", ""),
            web_view_link=file_data.get("webViewLink"),
            owners=file_data.get("owners", []),
            last_modifying_user=file_data.get("lastModifyingUser"),
            shared=file_data.get("shared", False),
            starred=file_data.get("starred", False),
            trashed=file_data.get("trashed", False),
            parents=file_data.get("parents", []),
            content=content,
        )

    async def _fetch_docs_content(
        self,
        client: httpx.AsyncClient,
        doc_id: str,
    ) -> str | None:
        """Fetch Google Docs content via Docs API."""
        try:
            response = await client.get(
                f"{GOOGLE_DOCS_BASE_URL}/documents/{doc_id}",
                headers={"Authorization": f"Bearer {self._access_token}"},
            )

            if response.status_code != 200:
                return None

            doc = response.json()
            content_parts = []

            # Extract text from document body
            body = doc.get("body", {})
            for element in body.get("content", []):
                text = self._extract_text_from_element(element)
                if text:
                    content_parts.append(text)

            return "\n".join(content_parts)

        except Exception:
            return None

    def _extract_text_from_element(self, element: dict[str, Any]) -> str:
        """Extract text from a Google Docs element."""
        text_parts = []

        # Paragraph
        if "paragraph" in element:
            para = element["paragraph"]
            for elem in para.get("elements", []):
                if "textRun" in elem:
                    text_parts.append(elem["textRun"].get("content", ""))

        # Table
        if "table" in element:
            table = element["table"]
            for row in table.get("tableRows", []):
                row_texts = []
                for cell in row.get("tableCells", []):
                    cell_text = []
                    for content in cell.get("content", []):
                        cell_text.append(self._extract_text_from_element(content))
                    row_texts.append(" ".join(cell_text))
                text_parts.append(" | ".join(row_texts))

        # List item (handled similar to paragraph)
        if "listItem" in element:
            list_item = element["listItem"]
            for elem in list_item.get("elements", []):
                if "textRun" in elem:
                    text_parts.append("• " + elem["textRun"].get("content", ""))

        return "".join(text_parts)

    def _document_to_record(self, doc: GoogleDocument) -> dict[str, Any]:
        """Convert GoogleDocument to a record dict."""
        # Determine document type from MIME
        doc_type = "document"
        if doc.mime_type == self.GOOGLE_DOC_MIME:
            doc_type = "google_doc"
        elif doc.mime_type == self.GOOGLE_SHEET_MIME:
            doc_type = "google_sheet"
        elif doc.mime_type == self.GOOGLE_SLIDES_MIME:
            doc_type = "google_slides"
        elif doc.mime_type.startswith("application/pdf"):
            doc_type = "pdf"

        # Extract owner info
        owner_emails = [o.get("emailAddress") for o in doc.owners if o.get("emailAddress")]
        last_modifier = doc.last_modifying_user.get("emailAddress") if doc.last_modifying_user else None

        return {
            "id": doc.id,
            "type": f"google_drive_{doc_type}",
            "name": doc.name,
            "mime_type": doc.mime_type,
            "created_time": doc.created_time,
            "modified_time": doc.modified_time,
            "web_view_link": doc.web_view_link,
            "owner_emails": owner_emails,
            "last_modifier_email": last_modifier,
            "shared": doc.shared,
            "starred": doc.starred,
            "parent_folders": doc.parents,
            "content": doc.content,
            "content_length": len(doc.content),
            "extracted_at": datetime.utcnow().isoformat(),
        }


# Register connector
ConnectorRegistry.register("google_docs", GoogleDocsConnector)
