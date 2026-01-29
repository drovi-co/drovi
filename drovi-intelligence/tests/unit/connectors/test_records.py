"""
Unit tests for Connector Record Types.

Tests Record, RecordBatch, and Unified schemas.
"""

import pytest
from datetime import datetime

from src.connectors.base.records import (
    Record,
    RecordBatch,
    RecordType,
    UnifiedDocument,
    UnifiedEvent,
    UnifiedMessage,
)

pytestmark = pytest.mark.unit


# =============================================================================
# RecordType Tests
# =============================================================================


class TestRecordType:
    """Tests for RecordType enum."""

    def test_message_type(self):
        """Test MESSAGE type."""
        assert RecordType.MESSAGE.value == "message"

    def test_document_type(self):
        """Test DOCUMENT type."""
        assert RecordType.DOCUMENT.value == "document"

    def test_event_type(self):
        """Test EVENT type."""
        assert RecordType.EVENT.value == "event"

    def test_contact_type(self):
        """Test CONTACT type."""
        assert RecordType.CONTACT.value == "contact"

    def test_file_type(self):
        """Test FILE type."""
        assert RecordType.FILE.value == "file"

    def test_conversation_type(self):
        """Test CONVERSATION type."""
        assert RecordType.CONVERSATION.value == "conversation"

    def test_custom_type(self):
        """Test CUSTOM type."""
        assert RecordType.CUSTOM.value == "custom"


# =============================================================================
# Record Tests
# =============================================================================


class TestRecord:
    """Tests for Record model."""

    def test_required_fields(self):
        """Test required fields."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={"content": "Hello"},
        )

        assert record.record_id == "rec_123"
        assert record.source_type == "gmail"
        assert record.stream_name == "messages"
        assert record.data == {"content": "Hello"}

    def test_default_record_type(self):
        """Test default record type is MESSAGE."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
        )

        assert record.record_type == RecordType.MESSAGE

    def test_custom_record_type(self):
        """Test setting custom record type."""
        record = Record(
            record_id="doc_123",
            source_type="notion",
            stream_name="pages",
            record_type=RecordType.DOCUMENT,
            data={"title": "Test Page"},
        )

        assert record.record_type == RecordType.DOCUMENT

    def test_extracted_at_default(self):
        """Test extracted_at is set automatically."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
        )

        assert record.extracted_at is not None
        assert isinstance(record.extracted_at, datetime)

    def test_cursor_value(self):
        """Test cursor value."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
            cursor_value="cursor_abc",
        )

        assert record.cursor_value == "cursor_abc"

    def test_cursor_value_default_none(self):
        """Test cursor value defaults to None."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
        )

        assert record.cursor_value is None

    def test_raw_data_hash(self):
        """Test raw data hash."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
            raw_data_hash="abc123def456",
        )

        assert record.raw_data_hash == "abc123def456"

    def test_unique_key(self):
        """Test unique_key property."""
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
        )

        assert record.unique_key == "gmail:messages:rec_123"

    def test_unique_key_different_records(self):
        """Test unique_key is different for different records."""
        record1 = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data={},
        )
        record2 = Record(
            record_id="rec_456",
            source_type="slack",
            stream_name="channels",
            data={},
        )

        assert record1.unique_key != record2.unique_key

    def test_complex_data(self):
        """Test record with complex data."""
        data = {
            "subject": "Meeting Notes",
            "body": "Discussion points...",
            "attachments": [
                {"name": "file1.pdf", "size": 1024},
                {"name": "file2.docx", "size": 2048},
            ],
            "metadata": {
                "labels": ["important", "work"],
                "flags": {"read": True},
            },
        }
        record = Record(
            record_id="rec_123",
            source_type="gmail",
            stream_name="messages",
            data=data,
        )

        assert record.data["attachments"][0]["name"] == "file1.pdf"
        assert record.data["metadata"]["labels"] == ["important", "work"]


# =============================================================================
# RecordBatch Tests
# =============================================================================


class TestRecordBatch:
    """Tests for RecordBatch model."""

    def test_required_fields(self):
        """Test required fields."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert batch.stream_name == "messages"
        assert batch.connection_id == "conn_123"

    def test_default_records(self):
        """Test records default to empty list."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert batch.records == []

    def test_default_has_more(self):
        """Test has_more defaults to False."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert batch.has_more is False

    def test_default_counts(self):
        """Test default counts are zero."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert batch.record_count == 0
        assert batch.byte_count == 0

    def test_started_at_default(self):
        """Test started_at is set automatically."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert batch.started_at is not None

    def test_completed_at_default_none(self):
        """Test completed_at defaults to None."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        assert batch.completed_at is None

    def test_add_record(self):
        """Test adding a record."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )
        record = Record(
            record_id="rec_1",
            source_type="gmail",
            stream_name="messages",
            data={"content": "Hello"},
        )

        batch.add_record(record)

        assert len(batch.records) == 1
        assert batch.record_count == 1

    def test_add_multiple_records(self):
        """Test adding multiple records."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        for i in range(5):
            record = Record(
                record_id=f"rec_{i}",
                source_type="gmail",
                stream_name="messages",
                data={"content": f"Message {i}"},
            )
            batch.add_record(record)

        assert len(batch.records) == 5
        assert batch.record_count == 5

    def test_complete_batch(self):
        """Test completing a batch."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )
        batch.add_record(
            Record(
                record_id="rec_1",
                source_type="gmail",
                stream_name="messages",
                data={},
            )
        )

        batch.complete(next_cursor={"historyId": "456"}, has_more=True)

        assert batch.completed_at is not None
        assert batch.next_cursor == {"historyId": "456"}
        assert batch.has_more is True
        assert batch.record_count == 1

    def test_complete_no_more(self):
        """Test completing with no more records."""
        batch = RecordBatch(
            stream_name="messages",
            connection_id="conn_123",
        )

        batch.complete()

        assert batch.has_more is False
        assert batch.next_cursor is None


# =============================================================================
# UnifiedMessage Tests
# =============================================================================


class TestUnifiedMessage:
    """Tests for UnifiedMessage model."""

    def test_required_fields(self):
        """Test required fields."""
        msg = UnifiedMessage(
            id="msg_123",
            source_type="email",
            source_id="gmail_456",
            connection_id="conn_789",
            organization_id="org_abc",
            body_text="Hello world",
            sent_at=datetime(2024, 1, 15, 10, 30),
        )

        assert msg.id == "msg_123"
        assert msg.source_type == "email"
        assert msg.body_text == "Hello world"

    def test_optional_subject(self):
        """Test optional subject."""
        msg = UnifiedMessage(
            id="msg_123",
            source_type="email",
            source_id="gmail_456",
            connection_id="conn_789",
            organization_id="org_abc",
            subject="Re: Meeting Notes",
            body_text="Hello",
            sent_at=datetime.utcnow(),
        )

        assert msg.subject == "Re: Meeting Notes"

    def test_participants(self):
        """Test participant fields."""
        msg = UnifiedMessage(
            id="msg_123",
            source_type="email",
            source_id="gmail_456",
            connection_id="conn_789",
            organization_id="org_abc",
            body_text="Hello",
            sent_at=datetime.utcnow(),
            sender_email="alice@example.com",
            sender_name="Alice",
            recipient_emails=["bob@example.com", "charlie@example.com"],
            recipient_names=["Bob", "Charlie"],
            cc_emails=["david@example.com"],
        )

        assert msg.sender_email == "alice@example.com"
        assert len(msg.recipient_emails) == 2
        assert len(msg.cc_emails) == 1

    def test_threading(self):
        """Test threading fields."""
        msg = UnifiedMessage(
            id="msg_123",
            source_type="email",
            source_id="gmail_456",
            connection_id="conn_789",
            organization_id="org_abc",
            body_text="Hello",
            sent_at=datetime.utcnow(),
            thread_id="thread_abc",
            parent_id="msg_100",
            is_reply=True,
            conversation_id="conv_xyz",
        )

        assert msg.thread_id == "thread_abc"
        assert msg.is_reply is True

    def test_attachments(self):
        """Test attachment fields."""
        msg = UnifiedMessage(
            id="msg_123",
            source_type="email",
            source_id="gmail_456",
            connection_id="conn_789",
            organization_id="org_abc",
            body_text="See attached",
            sent_at=datetime.utcnow(),
            attachment_names=["report.pdf", "data.xlsx"],
            attachment_count=2,
        )

        assert msg.attachment_count == 2
        assert "report.pdf" in msg.attachment_names

    def test_metadata(self):
        """Test metadata fields."""
        msg = UnifiedMessage(
            id="msg_123",
            source_type="email",
            source_id="gmail_456",
            connection_id="conn_789",
            organization_id="org_abc",
            body_text="Important update",
            sent_at=datetime.utcnow(),
            labels=["important", "work"],
            is_read=True,
            importance="high",
        )

        assert "important" in msg.labels
        assert msg.is_read is True
        assert msg.importance == "high"


# =============================================================================
# UnifiedDocument Tests
# =============================================================================


class TestUnifiedDocument:
    """Tests for UnifiedDocument model."""

    def test_required_fields(self):
        """Test required fields."""
        doc = UnifiedDocument(
            id="doc_123",
            source_type="notion",
            source_id="notion_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Project Plan",
            content_text="## Overview\n\nThis document...",
            created_at=datetime(2024, 1, 1),
            updated_at=datetime(2024, 1, 15),
        )

        assert doc.id == "doc_123"
        assert doc.title == "Project Plan"

    def test_hierarchy(self):
        """Test hierarchy fields."""
        doc = UnifiedDocument(
            id="doc_123",
            source_type="notion",
            source_id="notion_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Sub Page",
            content_text="Content",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_id="doc_100",
            children_ids=["doc_124", "doc_125"],
        )

        assert doc.parent_id == "doc_100"
        assert len(doc.children_ids) == 2

    def test_ownership(self):
        """Test ownership fields."""
        doc = UnifiedDocument(
            id="doc_123",
            source_type="notion",
            source_id="notion_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Shared Doc",
            content_text="Content",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            owner_email="alice@example.com",
            owner_name="Alice",
            collaborator_emails=["bob@example.com"],
        )

        assert doc.owner_email == "alice@example.com"
        assert len(doc.collaborator_emails) == 1


# =============================================================================
# UnifiedEvent Tests
# =============================================================================


class TestUnifiedEvent:
    """Tests for UnifiedEvent model."""

    def test_required_fields(self):
        """Test required fields."""
        event = UnifiedEvent(
            id="event_123",
            source_type="calendar",
            source_id="gcal_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Team Meeting",
            start_time=datetime(2024, 1, 15, 10, 0),
            end_time=datetime(2024, 1, 15, 11, 0),
        )

        assert event.id == "event_123"
        assert event.title == "Team Meeting"

    def test_timing(self):
        """Test timing fields."""
        event = UnifiedEvent(
            id="event_123",
            source_type="calendar",
            source_id="gcal_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Meeting",
            start_time=datetime(2024, 1, 15, 10, 0),
            end_time=datetime(2024, 1, 15, 11, 0),
            all_day=False,
            timezone="America/New_York",
        )

        assert event.all_day is False
        assert event.timezone == "America/New_York"

    def test_participants(self):
        """Test participant fields."""
        event = UnifiedEvent(
            id="event_123",
            source_type="calendar",
            source_id="gcal_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Meeting",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow(),
            organizer_email="alice@example.com",
            organizer_name="Alice",
            attendee_emails=["bob@example.com", "charlie@example.com"],
            attendee_names=["Bob", "Charlie"],
        )

        assert event.organizer_email == "alice@example.com"
        assert len(event.attendee_emails) == 2

    def test_status(self):
        """Test status fields."""
        event = UnifiedEvent(
            id="event_123",
            source_type="calendar",
            source_id="gcal_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Meeting",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow(),
            status="confirmed",
            response_status="accepted",
        )

        assert event.status == "confirmed"
        assert event.response_status == "accepted"

    def test_recurrence(self):
        """Test recurrence fields."""
        event = UnifiedEvent(
            id="event_123",
            source_type="calendar",
            source_id="gcal_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Weekly Standup",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow(),
            is_recurring=True,
            recurrence_rule="FREQ=WEEKLY;BYDAY=MO",
        )

        assert event.is_recurring is True
        assert "WEEKLY" in event.recurrence_rule

    def test_links(self):
        """Test link fields."""
        event = UnifiedEvent(
            id="event_123",
            source_type="calendar",
            source_id="gcal_456",
            connection_id="conn_789",
            organization_id="org_abc",
            title="Meeting",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow(),
            meeting_url="https://meet.google.com/abc-123",
            calendar_url="https://calendar.google.com/event?eid=abc",
        )

        assert "meet.google.com" in event.meeting_url
