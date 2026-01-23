"""
Source-Specific Parsers

Extracts structured metadata from different communication sources:
- Email: Headers, threading, recipients
- Slack: Channels, threads, mentions, reactions
- Calendar: Events, attendees, recurrence
- Notion: Pages, blocks, properties
- WhatsApp: Contacts, groups, media
- Google Docs: Comments, suggestions, collaborators
"""

from .base import SourceParser, ParsedContent
from .email_parser import EmailParser, ParsedEmail
from .slack_parser import SlackParser, ParsedSlackMessage
from .calendar_parser import CalendarParser, ParsedCalendarEvent
from .factory import get_parser

__all__ = [
    # Base
    "SourceParser",
    "ParsedContent",
    # Parsers
    "EmailParser",
    "ParsedEmail",
    "SlackParser",
    "ParsedSlackMessage",
    "CalendarParser",
    "ParsedCalendarEvent",
    # Factory
    "get_parser",
]
