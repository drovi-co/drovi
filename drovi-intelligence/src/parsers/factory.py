"""
Parser Factory

Provides a unified interface to get the appropriate parser
for any source type.
"""

from typing import Literal

from .base import SourceParser, ParsedContent
from .email_parser import EmailParser
from .slack_parser import SlackParser
from .calendar_parser import CalendarParser

SourceType = Literal[
    "email", "slack", "notion", "google_docs",
    "whatsapp", "calendar", "api", "manual"
]

# Singleton instances
_parsers: dict[str, SourceParser] = {}


def get_parser(source_type: SourceType) -> SourceParser:
    """
    Get the appropriate parser for a source type.

    Args:
        source_type: Type of source content

    Returns:
        Parser instance for the source type
    """
    global _parsers

    if source_type not in _parsers:
        parser_map = {
            "email": EmailParser,
            "slack": SlackParser,
            "calendar": CalendarParser,
            # More parsers can be added here
            # "notion": NotionParser,
            # "google_docs": GoogleDocsParser,
            # "whatsapp": WhatsAppParser,
        }

        parser_class = parser_map.get(source_type)

        if parser_class:
            _parsers[source_type] = parser_class()
        else:
            # Return a generic parser for unsupported types
            _parsers[source_type] = GenericParser(source_type)

    return _parsers[source_type]


class GenericParser(SourceParser[ParsedContent]):
    """
    Generic parser for unsupported source types.

    Provides basic parsing without source-specific extraction.
    """

    def __init__(self, source_type: str):
        self._source_type = source_type

    @property
    def source_type(self) -> str:
        return self._source_type

    def parse(self, raw_content: str) -> ParsedContent:
        """Basic parsing without source-specific extraction."""
        return ParsedContent(
            raw_content=raw_content,
            source_type=self._source_type,
            body_text=self.clean_body(raw_content),
            participants=self.extract_participants(raw_content),
            participant_emails=self.extract_emails(raw_content),
        )

    def extract_participants(self, content: str) -> list[str]:
        """Extract names that look like participants."""
        import re

        # Look for common patterns
        names = []

        # Pattern: "Name:" at start of line
        for match in re.finditer(r'^([A-Z][a-z]+ [A-Z][a-z]+):', content, re.MULTILINE):
            names.append(match.group(1))

        # Pattern: "From: Name" or "To: Name"
        for match in re.finditer(r'(?:From|To|Cc):\s*([A-Z][a-z]+ [A-Z][a-z]+)', content, re.IGNORECASE):
            names.append(match.group(1))

        return list(set(names))

    def clean_body(self, content: str) -> str:
        """Basic body cleaning."""
        return content.strip()
