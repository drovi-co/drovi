"""
Record Types

Defines the data structures for records extracted by connectors.
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RecordType(str, Enum):
    """Types of records that can be extracted."""

    MESSAGE = "message"        # Email, Slack message, etc.
    DOCUMENT = "document"      # Notion page, Google Doc, etc.
    EVENT = "event"            # Calendar event, meeting
    CONTACT = "contact"        # CRM contact, person
    FILE = "file"              # Attachment, file metadata
    CONVERSATION = "conversation"  # Thread, channel, chat
    CUSTOM = "custom"          # Provider-specific


class Record(BaseModel):
    """
    A single record extracted from a data source.

    This is the universal format for all extracted data.
    """

    # Identity
    record_id: str  # Unique ID within the source
    source_type: str  # e.g., "gmail", "slack"
    stream_name: str  # e.g., "messages", "threads"
    record_type: RecordType = RecordType.MESSAGE

    # Data
    data: dict[str, Any]  # The actual record data

    # Metadata
    extracted_at: datetime = Field(default_factory=datetime.utcnow)

    # Cursor information for incremental sync
    cursor_value: Any | None = None  # e.g., historyId, timestamp

    # Provenance
    raw_data_hash: str | None = None  # For deduplication

    class Config:
        """Pydantic config."""
        extra = "allow"

    @property
    def unique_key(self) -> str:
        """Generate unique key for this record."""
        return f"{self.source_type}:{self.stream_name}:{self.record_id}"


class RecordBatch(BaseModel):
    """
    A batch of records from a sync operation.

    Includes metadata about the sync state.
    """

    # Records
    records: list[Record] = Field(default_factory=list)

    # Batch metadata
    stream_name: str
    connection_id: str

    # Cursor state after this batch
    next_cursor: dict[str, Any] | None = None
    has_more: bool = False  # More records available

    # Statistics
    record_count: int = 0
    byte_count: int = 0

    # Timing
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None

    class Config:
        """Pydantic config."""
        extra = "allow"

    def add_record(self, record: Record) -> None:
        """Add a record to the batch."""
        self.records.append(record)
        self.record_count = len(self.records)

    def complete(self, next_cursor: dict[str, Any] | None = None, has_more: bool = False) -> None:
        """Mark batch as complete."""
        self.completed_at = datetime.utcnow()
        self.next_cursor = next_cursor
        self.has_more = has_more
        self.record_count = len(self.records)


class UnifiedMessage(BaseModel):
    """
    Canonical message schema for all communication sources.

    Maps email, Slack, Teams, etc. to a common format.
    This is the normalized output ready for intelligence extraction.
    """

    # Identity
    id: str
    source_type: str  # "email", "slack", "teams"
    source_id: str    # Original ID in source system
    connection_id: str
    organization_id: str

    # Content
    subject: str | None = None
    body_text: str
    body_html: str | None = None

    # Participants
    sender_email: str | None = None
    sender_name: str | None = None
    recipient_emails: list[str] = Field(default_factory=list)
    recipient_names: list[str] = Field(default_factory=list)
    cc_emails: list[str] = Field(default_factory=list)

    # Threading
    thread_id: str | None = None
    parent_id: str | None = None
    is_reply: bool = False
    conversation_id: str | None = None

    # Timestamps
    sent_at: datetime
    received_at: datetime | None = None

    # Attachments
    attachment_names: list[str] = Field(default_factory=list)
    attachment_count: int = 0

    # Metadata
    labels: list[str] = Field(default_factory=list)
    is_read: bool = False
    importance: str = "normal"  # low, normal, high

    # Provenance
    raw_data_hash: str | None = None
    extracted_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"


class UnifiedDocument(BaseModel):
    """
    Canonical document schema for files and pages.

    Maps PDFs, Google Docs, Notion pages, etc.
    """

    # Identity
    id: str
    source_type: str
    source_id: str
    connection_id: str
    organization_id: str

    # Content
    title: str
    content_text: str
    content_html: str | None = None

    # Hierarchy
    parent_id: str | None = None
    children_ids: list[str] = Field(default_factory=list)

    # Ownership
    owner_email: str | None = None
    owner_name: str | None = None
    collaborator_emails: list[str] = Field(default_factory=list)

    # Metadata
    created_at: datetime
    updated_at: datetime
    tags: list[str] = Field(default_factory=list)
    url: str | None = None

    # Content analysis
    word_count: int = 0
    language: str | None = None

    # Provenance
    raw_data_hash: str | None = None
    extracted_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"


class UnifiedEvent(BaseModel):
    """
    Canonical event schema for calendar events and meetings.
    """

    # Identity
    id: str
    source_type: str
    source_id: str
    connection_id: str
    organization_id: str

    # Event details
    title: str
    description: str | None = None
    location: str | None = None

    # Timing
    start_time: datetime
    end_time: datetime
    all_day: bool = False
    timezone: str | None = None

    # Participants
    organizer_email: str | None = None
    organizer_name: str | None = None
    attendee_emails: list[str] = Field(default_factory=list)
    attendee_names: list[str] = Field(default_factory=list)

    # Status
    status: str = "confirmed"  # confirmed, tentative, cancelled
    response_status: str | None = None  # accepted, declined, tentative

    # Recurrence
    is_recurring: bool = False
    recurrence_rule: str | None = None

    # Links
    meeting_url: str | None = None
    calendar_url: str | None = None

    # Provenance
    raw_data_hash: str | None = None
    extracted_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"
