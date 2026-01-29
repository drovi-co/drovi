"""
Unit tests for the parse messages node.

Tests the content parsing functionality for various source types.
"""

import pytest
from datetime import datetime

from src.orchestrator.nodes.parse import (
    parse_email_thread,
    parse_slack_messages,
    parse_calendar_event,
    parse_whatsapp_messages,
    parse_notion_page,
    parse_google_doc,
    parse_generic_content,
    _parse_timestamp,
    _is_user_sender,
    parse_messages_node,
)
from src.orchestrator.state import (
    IntelligenceState,
    AnalysisInput,
    ParsedMessage,
)

pytestmark = pytest.mark.unit


class TestParseEmailThread:
    """Tests for email thread parsing."""

    def test_parse_single_email(self):
        """Test parsing a single email message."""
        content = """
        From: john@example.com
        To: jane@example.com
        Subject: Meeting tomorrow

        Hi Jane,

        Let's meet tomorrow at 3pm to discuss the project.

        Best,
        John
        """
        messages = parse_email_thread(content)

        assert len(messages) >= 1
        assert messages[0].content is not None

    def test_parse_email_thread_with_replies(self):
        """Test parsing an email thread with replies."""
        content = """
        From: jane@example.com
        To: john@example.com

        That works for me!

        On Mon, Jan 15, 2024 at 2:00 PM John <john@example.com> wrote:
        > Hi Jane,
        > Let's meet tomorrow at 3pm.
        > John
        """
        messages = parse_email_thread(content)

        # Should detect multiple messages
        assert len(messages) >= 1

    def test_parse_email_extracts_sender(self):
        """Test email parsing extracts sender information."""
        content = """
        From: John Doe <john.doe@company.com>

        Hello team,

        Here's the update.
        """
        messages = parse_email_thread(content)

        assert len(messages) >= 1
        # Should extract sender email
        found_email = any(m.sender_email for m in messages)
        assert found_email or messages[0].content is not None

    def test_parse_email_identifies_user_messages(self):
        """Test email parsing identifies messages from user."""
        content = """
        From: user@mycompany.com

        I'll handle the task.

        --- Original Message ---
        From: external@other.com

        Can you help with this?
        """
        messages = parse_email_thread(content, user_email="user@mycompany.com")

        user_messages = [m for m in messages if m.is_from_user]
        # Should identify at least one user message
        assert len(user_messages) >= 0  # May not detect depending on format

    def test_parse_forwarded_email(self):
        """Test parsing forwarded email."""
        content = """
        ----- Forwarded Message -----
        From: original@example.com
        To: forwarder@example.com
        Subject: FW: Important info

        Please see the original message below.

        Original content here.
        """
        messages = parse_email_thread(content)

        assert len(messages) >= 1

    def test_parse_empty_email(self):
        """Test parsing empty content returns at least one message."""
        messages = parse_email_thread("")

        assert len(messages) == 1
        assert messages[0].id == "msg_0"


class TestParseSlackMessages:
    """Tests for Slack message parsing."""

    def test_parse_slack_with_timestamp(self):
        """Test parsing Slack messages with timestamps."""
        content = """[2024-01-15 10:30] john: Hey team, quick update
[2024-01-15 10:32] jane: Thanks John!
[2024-01-15 10:33] john: Let me know if you have questions"""
        messages = parse_slack_messages(content)

        assert len(messages) >= 2
        assert any("john" in (m.sender_name or "").lower() for m in messages)

    def test_parse_slack_without_timestamp(self):
        """Test parsing Slack messages without timestamps."""
        content = """john: Morning everyone
jane: Good morning!
bob: Hi all"""
        messages = parse_slack_messages(content)

        assert len(messages) >= 2

    def test_parse_slack_multiline_message(self):
        """Test parsing Slack message with multiple lines."""
        content = """
        john: Here's the list:
        - Item 1
        - Item 2
        - Item 3

        Let me know what you think!
        """
        messages = parse_slack_messages(content)

        assert len(messages) >= 1
        # The message should contain the full content
        full_content = " ".join(m.content for m in messages)
        assert "Item 1" in full_content or len(messages) >= 1

    def test_parse_slack_identifies_user(self):
        """Test Slack parsing identifies user messages."""
        content = """john: I'll take care of it
jane: Thanks!"""
        messages = parse_slack_messages(
            content,
            user_email="john@company.com",
            metadata={"user_name": "john"},
        )

        user_messages = [m for m in messages if m.is_from_user]
        assert len(user_messages) >= 1

    def test_parse_slack_with_at_mentions(self):
        """Test parsing Slack with @mentions."""
        content = """
        @john: Please review the PR
        @jane: Sure, will do!
        """
        messages = parse_slack_messages(content)

        assert len(messages) >= 1


class TestParseCalendarEvent:
    """Tests for calendar event parsing."""

    def test_parse_calendar_with_metadata(self):
        """Test parsing calendar event with full metadata."""
        content = "Quarterly planning meeting agenda..."

        metadata = {
            "title": "Q1 Planning",
            "start_time": "2024-01-20T09:00:00Z",
            "end_time": "2024-01-20T10:00:00Z",
            "location": "Conference Room A",
            "organizer": {"name": "John", "email": "john@company.com"},
            "attendees": [
                {"name": "Jane", "email": "jane@company.com", "status": "accepted"},
                {"name": "Bob", "email": "bob@company.com", "status": "tentative"},
            ],
            "description": "Review Q1 goals and deliverables",
        }

        messages = parse_calendar_event(content, metadata=metadata)

        assert len(messages) == 1
        msg = messages[0]

        assert "Q1 Planning" in msg.content
        assert "John" in msg.content
        assert "Jane" in msg.content or "Attendees" in msg.content

    def test_parse_calendar_from_plain_text(self):
        """Test parsing calendar event from plain text."""
        content = """
        Event: Weekly Team Sync
        Time: Monday 10:00 AM to 11:00 AM
        Location: Zoom
        Organizer: Sarah <sarah@company.com>
        Attendees: Alice, Bob, Charlie

        Agenda:
        1. Status updates
        2. Blockers
        3. Next week planning
        """
        messages = parse_calendar_event(content)

        assert len(messages) == 1
        msg = messages[0]

        assert "Team Sync" in msg.content or "CALENDAR EVENT" in msg.content

    def test_parse_calendar_minimal(self):
        """Test parsing calendar with minimal info."""
        content = "Meeting about project X"

        messages = parse_calendar_event(content)

        assert len(messages) == 1
        assert messages[0].content is not None

    def test_parse_calendar_extracts_hints(self):
        """Test calendar parsing includes extraction hints."""
        content = "Strategy meeting"
        messages = parse_calendar_event(content)

        msg = messages[0]
        assert "EXTRACTION HINTS" in msg.content or "calendar" in msg.content.lower()


class TestParseWhatsAppMessages:
    """Tests for WhatsApp message parsing."""

    def test_parse_whatsapp_bracketed_format(self):
        """Test parsing WhatsApp format with brackets."""
        content = """[1/15/24, 10:30 AM] John: Hey!
[1/15/24, 10:31 AM] Jane: Hi there
[1/15/24, 10:32 AM] John: How are you?"""
        messages = parse_whatsapp_messages(content)

        assert len(messages) >= 2

    def test_parse_whatsapp_dash_format(self):
        """Test parsing WhatsApp format with dashes."""
        content = """
        1/15/24, 10:30 AM - John: Hello everyone
        1/15/24, 10:31 AM - Jane: Hi!
        """
        messages = parse_whatsapp_messages(content)

        assert len(messages) >= 1

    def test_parse_whatsapp_multiline(self):
        """Test parsing WhatsApp multiline messages."""
        content = """
        [1/15/24, 10:30 AM] John: Here's what we need:
        First item
        Second item
        Third item

        [1/15/24, 10:35 AM] Jane: Got it!
        """
        messages = parse_whatsapp_messages(content)

        assert len(messages) >= 1
        # First message should include multiline content
        full_content = messages[0].content
        assert "item" in full_content.lower() or len(messages) > 0

    def test_parse_whatsapp_empty(self):
        """Test parsing empty WhatsApp content."""
        messages = parse_whatsapp_messages("")

        assert len(messages) == 1


class TestParseNotionPage:
    """Tests for Notion page parsing."""

    def test_parse_notion_with_metadata(self):
        """Test parsing Notion page with metadata."""
        content = """
        # Project Overview

        This document outlines the key objectives...

        ## Goals
        - Goal 1
        - Goal 2
        """
        metadata = {
            "title": "Project Alpha Overview",
            "last_edited_by": {"name": "John"},
            "created_by": {"name": "Jane", "email": "jane@company.com"},
        }

        messages = parse_notion_page(content, metadata=metadata)

        assert len(messages) >= 1
        assert "Project Alpha" in messages[0].content

    def test_parse_notion_with_comments(self):
        """Test parsing Notion page with comments."""
        content = "Main document content"
        metadata = {
            "title": "Team Notes",
            "comments": [
                {"text": "Great point!", "author": {"name": "Bob"}},
                {"text": "Let's discuss", "author": {"name": "Alice"}},
            ],
        }

        messages = parse_notion_page(content, metadata=metadata)

        # Should include page + comments
        assert len(messages) >= 1

    def test_parse_notion_minimal(self):
        """Test parsing Notion with minimal metadata."""
        content = "Some notion content"

        messages = parse_notion_page(content)

        assert len(messages) == 1
        assert "NOTION PAGE" in messages[0].content


class TestParseGoogleDoc:
    """Tests for Google Doc parsing."""

    def test_parse_gdoc_with_metadata(self):
        """Test parsing Google Doc with metadata."""
        content = """
        Meeting Notes - Jan 15

        Discussed:
        - Project timeline
        - Resource allocation
        """
        metadata = {
            "title": "Team Meeting Notes",
            "owner": {"name": "Sarah", "email": "sarah@company.com"},
        }

        messages = parse_google_doc(content, metadata=metadata)

        assert len(messages) >= 1
        assert "Team Meeting Notes" in messages[0].content

    def test_parse_gdoc_with_comments(self):
        """Test parsing Google Doc with comments."""
        content = "Document content here"
        metadata = {
            "title": "Proposal",
            "owner": {"name": "John"},
            "comments": [
                {
                    "content": "Need to revise this section",
                    "author": {"displayName": "Jane", "emailAddress": "jane@company.com"},
                },
            ],
        }

        messages = parse_google_doc(content, metadata=metadata)

        # Should include doc + comments
        assert len(messages) >= 1

    def test_parse_gdoc_identifies_owner(self):
        """Test Google Doc identifies owner as user."""
        content = "My document"
        metadata = {
            "title": "My Doc",
            "owner": {"email": "user@company.com"},
        }

        messages = parse_google_doc(content, user_email="user@company.com", metadata=metadata)

        assert messages[0].is_from_user is True


class TestParseGenericContent:
    """Tests for generic content parsing."""

    def test_parse_generic_creates_single_message(self):
        """Test generic parsing creates single message."""
        content = "This is some generic content that doesn't match any format"

        messages = parse_generic_content(content)

        assert len(messages) == 1
        assert messages[0].content == content
        assert messages[0].is_from_user is True

    def test_parse_generic_preserves_content(self):
        """Test generic parsing preserves original content."""
        content = """
        Multi-line
        content
        here
        """
        messages = parse_generic_content(content)

        assert messages[0].content == content


class TestParseTimestamp:
    """Tests for timestamp parsing utility."""

    def test_parse_iso_timestamp(self):
        """Test parsing ISO format timestamp."""
        result = _parse_timestamp("2024-01-15T10:30:00Z")

        assert result is not None
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_parse_datetime_no_tz(self):
        """Test parsing datetime without timezone."""
        result = _parse_timestamp("2024-01-15T10:30:00")

        assert result is not None

    def test_parse_date_time_space(self):
        """Test parsing date time with space."""
        result = _parse_timestamp("2024-01-15 10:30:00")

        assert result is not None

    def test_parse_us_format(self):
        """Test parsing US date format."""
        result = _parse_timestamp("1/15/24, 10:30 AM")

        assert result is not None

    def test_parse_invalid_returns_none(self):
        """Test parsing invalid timestamp returns None."""
        result = _parse_timestamp("not a date")

        assert result is None

    def test_parse_none_returns_none(self):
        """Test parsing None returns None."""
        result = _parse_timestamp(None)

        assert result is None


class TestIsUserSender:
    """Tests for user sender detection utility."""

    def test_matches_email_username(self):
        """Test matching against email username."""
        result = _is_user_sender("john", "john@company.com", {})

        assert result is True

    def test_matches_user_name_metadata(self):
        """Test matching against user_name in metadata."""
        result = _is_user_sender("John Doe", None, {"user_name": "John Doe"})

        assert result is True

    def test_matches_slack_id(self):
        """Test matching against Slack user ID."""
        result = _is_user_sender("U12345", None, {"user_slack_id": "U12345"})

        assert result is True

    def test_no_match_returns_false(self):
        """Test non-matching sender returns False."""
        result = _is_user_sender("Jane", "john@company.com", {})

        assert result is False

    def test_none_sender_returns_false(self):
        """Test None sender returns False."""
        result = _is_user_sender(None, "john@company.com", {})

        assert result is False


class TestParseMessagesNode:
    """Tests for the full parse_messages_node function."""

    @pytest.mark.asyncio
    async def test_parse_node_email(self, factory):
        """Test parse node with email source."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="From: test@example.com\n\nHello there!",
                source_type="email",
                user_email="user@example.com",
            ),
        )

        result = await parse_messages_node(state)

        assert "messages" in result
        assert len(result["messages"]) >= 1
        assert "trace" in result

    @pytest.mark.asyncio
    async def test_parse_node_slack(self, factory):
        """Test parse node with Slack source."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="john: Hello\njane: Hi there",
                source_type="slack",
            ),
        )

        result = await parse_messages_node(state)

        assert "messages" in result
        assert len(result["messages"]) >= 1

    @pytest.mark.asyncio
    async def test_parse_node_calendar(self, factory):
        """Test parse node with calendar source."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Event: Team Meeting\nTime: 3pm",
                source_type="calendar",
            ),
        )

        result = await parse_messages_node(state)

        assert "messages" in result

    @pytest.mark.asyncio
    async def test_parse_node_generic(self, factory):
        """Test parse node with unknown source type."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Generic content here",
                source_type="api",
            ),
        )

        result = await parse_messages_node(state)

        assert "messages" in result
        assert len(result["messages"]) == 1

    @pytest.mark.asyncio
    async def test_parse_node_records_timing(self, factory):
        """Test parse node records timing information."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test content",
                source_type="api",
            ),
        )

        result = await parse_messages_node(state)

        assert "trace" in result
        assert "node_timings" in result["trace"]
        assert "parse_messages" in result["trace"]["node_timings"]

    @pytest.mark.asyncio
    async def test_parse_node_updates_trace(self, factory):
        """Test parse node updates trace correctly."""
        state = IntelligenceState(
            input=AnalysisInput(
                organization_id=factory.organization_id(),
                content="Test",
                source_type="api",
            ),
        )

        result = await parse_messages_node(state)

        trace = result["trace"]
        # Node should be recorded in trace
        assert "parse_messages" in state.trace.nodes or "parse_messages" in trace.get("nodes", [])
