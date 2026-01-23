"""
Base Parser Classes

Provides the base interface for all source-specific parsers.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field


class ParsedContent(BaseModel):
    """Base class for all parsed content."""

    raw_content: str
    source_type: str
    parsed_at: datetime = Field(default_factory=datetime.utcnow)

    # Extracted participants
    participants: list[str] = Field(default_factory=list)
    participant_emails: list[str] = Field(default_factory=list)

    # Timestamps
    sent_at: datetime | None = None
    received_at: datetime | None = None

    # Threading
    thread_id: str | None = None
    reply_to_id: str | None = None
    is_reply: bool = False

    # Clean body text (stripped of signatures, quotes, etc.)
    body_text: str = ""

    # Metadata
    metadata: dict = Field(default_factory=dict)


T = TypeVar("T", bound=ParsedContent)


class SourceParser(ABC, Generic[T]):
    """
    Abstract base class for source-specific parsers.

    Each parser extracts structured data from raw content,
    enabling more accurate intelligence extraction.
    """

    @property
    @abstractmethod
    def source_type(self) -> str:
        """The source type this parser handles."""
        pass

    @abstractmethod
    def parse(self, raw_content: str) -> T:
        """
        Parse raw content into structured format.

        Args:
            raw_content: Raw text content from the source

        Returns:
            Parsed content with extracted metadata
        """
        pass

    def extract_participants(self, content: str) -> list[str]:
        """
        Extract participant names/identifiers from content.

        Override in subclasses for source-specific extraction.
        """
        return []

    def extract_emails(self, content: str) -> list[str]:
        """Extract email addresses from content."""
        import re
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        return list(set(re.findall(email_pattern, content)))

    def clean_body(self, content: str) -> str:
        """
        Clean body text by removing signatures, quotes, etc.

        Override in subclasses for source-specific cleaning.
        """
        return content.strip()
