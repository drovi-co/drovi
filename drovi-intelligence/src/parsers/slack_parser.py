"""
Slack Parser

Extracts structured metadata from Slack messages including:
- Sender information
- Channel/DM context
- Thread information
- @mentions
- Reactions (emoji)
- Links and attachments
- Slack-specific formatting
"""

import re
from datetime import datetime
from typing import Literal

from pydantic import Field

from .base import SourceParser, ParsedContent


class SlackMention(ParsedContent):
    """A mention extracted from Slack content."""

    user_id: str
    display_name: str | None = None
    is_channel: bool = False
    is_everyone: bool = False


class SlackReaction(ParsedContent):
    """A reaction on a Slack message."""

    emoji: str
    count: int = 1
    users: list[str] = Field(default_factory=list)


class ParsedSlackMessage(ParsedContent):
    """Structured Slack message data."""

    source_type: str = "slack"

    # Sender
    sender_id: str | None = None
    sender_name: str | None = None
    sender_display_name: str | None = None
    sender_is_bot: bool = False

    # Channel/DM
    channel_id: str | None = None
    channel_name: str | None = None
    channel_type: Literal["channel", "dm", "group_dm", "private", "unknown"] = "unknown"
    is_dm: bool = False

    # Threading
    thread_ts: str | None = None
    parent_ts: str | None = None
    is_thread_reply: bool = False
    reply_count: int = 0

    # Mentions
    mentions: list[dict] = Field(default_factory=list)
    user_mentions: list[str] = Field(default_factory=list)  # User IDs
    channel_mentions: list[str] = Field(default_factory=list)  # Channel IDs
    has_everyone_mention: bool = False
    has_here_mention: bool = False

    # Reactions
    reactions: list[dict] = Field(default_factory=list)
    reaction_count: int = 0

    # Links and media
    links: list[str] = Field(default_factory=list)
    link_count: int = 0
    has_attachments: bool = False
    attachment_types: list[str] = Field(default_factory=list)

    # Formatting
    has_code_block: bool = False
    has_inline_code: bool = False
    has_quotes: bool = False

    # Clean text (without Slack formatting)
    plain_text: str = ""


class SlackParser(SourceParser[ParsedSlackMessage]):
    """
    Parser for Slack message content.

    Handles Slack-specific formatting and extracts structured metadata.
    """

    @property
    def source_type(self) -> str:
        return "slack"

    def parse(self, raw_content: str) -> ParsedSlackMessage:
        """Parse raw Slack message content."""
        # Extract mentions
        user_mentions = self._extract_user_mentions(raw_content)
        channel_mentions = self._extract_channel_mentions(raw_content)
        has_everyone = "@everyone" in raw_content or "<!everyone>" in raw_content
        has_here = "@here" in raw_content or "<!here>" in raw_content

        # Extract links
        links = self._extract_links(raw_content)

        # Extract reactions (if included in format)
        reactions = self._extract_reactions(raw_content)

        # Detect formatting
        has_code_block = "```" in raw_content
        has_inline_code = bool(re.search(r'`[^`]+`', raw_content))
        has_quotes = raw_content.strip().startswith(">") or "\n>" in raw_content

        # Clean text
        plain_text = self._clean_slack_formatting(raw_content)

        # Detect thread context (if in standard format)
        thread_ts, parent_ts, is_reply = self._detect_threading(raw_content)

        # Detect sender (if in standard format)
        sender_id, sender_name = self._detect_sender(raw_content)

        # Detect channel
        channel_id, channel_name, channel_type = self._detect_channel(raw_content)

        # Collect all participants
        all_participants = []
        if sender_name:
            all_participants.append(sender_name)

        return ParsedSlackMessage(
            raw_content=raw_content,
            source_type="slack",
            sender_id=sender_id,
            sender_name=sender_name,
            channel_id=channel_id,
            channel_name=channel_name,
            channel_type=channel_type,
            is_dm=channel_type == "dm",
            thread_ts=thread_ts,
            parent_ts=parent_ts,
            is_thread_reply=is_reply,
            is_reply=is_reply,
            user_mentions=user_mentions,
            channel_mentions=channel_mentions,
            has_everyone_mention=has_everyone,
            has_here_mention=has_here,
            mentions=[{"user_id": m} for m in user_mentions],
            reactions=reactions,
            reaction_count=len(reactions),
            links=links,
            link_count=len(links),
            has_code_block=has_code_block,
            has_inline_code=has_inline_code,
            has_quotes=has_quotes,
            plain_text=plain_text,
            body_text=plain_text,
            participants=all_participants,
            participant_emails=[],
        )

    def _extract_user_mentions(self, content: str) -> list[str]:
        """Extract @user mentions."""
        # Slack format: <@U123456> or @username
        slack_mentions = re.findall(r'<@(U[A-Z0-9]+)(?:\|[^>]*)?>', content)

        # Plain @mentions (less reliable)
        plain_mentions = re.findall(r'@([a-zA-Z0-9._-]+)', content)

        # Filter out special mentions
        plain_mentions = [
            m for m in plain_mentions
            if m.lower() not in ('everyone', 'here', 'channel')
        ]

        return list(set(slack_mentions + plain_mentions))

    def _extract_channel_mentions(self, content: str) -> list[str]:
        """Extract #channel mentions."""
        # Slack format: <#C123456|channel-name> or #channel
        slack_channels = re.findall(r'<#(C[A-Z0-9]+)(?:\|[^>]*)?>', content)
        plain_channels = re.findall(r'#([a-zA-Z0-9_-]+)', content)

        return list(set(slack_channels + plain_channels))

    def _extract_links(self, content: str) -> list[str]:
        """Extract URLs from content."""
        # Slack format: <http://example.com|text> or plain URLs
        slack_links = re.findall(r'<(https?://[^|>]+)(?:\|[^>]*)?>', content)
        plain_links = re.findall(r'(?<![<"])https?://[^\s<>"]+', content)

        return list(set(slack_links + plain_links))

    def _extract_reactions(self, content: str) -> list[dict]:
        """Extract emoji reactions if present."""
        # Look for reaction format: :emoji: (x N)
        reaction_pattern = r':([a-zA-Z0-9_+-]+):(?:\s*\((?:x\s*)?(\d+)\))?'
        matches = re.findall(reaction_pattern, content)

        reactions = []
        for emoji, count in matches:
            reactions.append({
                "emoji": emoji,
                "count": int(count) if count else 1,
            })

        return reactions

    def _clean_slack_formatting(self, content: str) -> str:
        """Remove Slack-specific formatting."""
        text = content

        # Remove user mentions: <@U123|name> -> @name or @U123
        text = re.sub(r'<@([A-Z0-9]+)\|([^>]+)>', r'@\2', text)
        text = re.sub(r'<@([A-Z0-9]+)>', r'@\1', text)

        # Remove channel mentions: <#C123|channel> -> #channel
        text = re.sub(r'<#[A-Z0-9]+\|([^>]+)>', r'#\1', text)
        text = re.sub(r'<#([A-Z0-9]+)>', r'#\1', text)

        # Remove links but keep text: <http://url|text> -> text
        text = re.sub(r'<https?://[^|>]+\|([^>]+)>', r'\1', text)
        text = re.sub(r'<(https?://[^>]+)>', r'\1', text)

        # Remove special mentions
        text = re.sub(r'<!everyone>', '@everyone', text)
        text = re.sub(r'<!here>', '@here', text)
        text = re.sub(r'<!channel>', '@channel', text)

        # Remove emoji shortcodes (optional, keep for context)
        # text = re.sub(r':[a-zA-Z0-9_+-]+:', '', text)

        return text.strip()

    def _detect_threading(self, content: str) -> tuple[str | None, str | None, bool]:
        """Detect thread context from content."""
        # Look for thread timestamp indicators
        thread_ts_match = re.search(r'thread_ts[=:]\s*"?([0-9.]+)"?', content)
        parent_ts_match = re.search(r'parent_ts[=:]\s*"?([0-9.]+)"?', content)

        thread_ts = thread_ts_match.group(1) if thread_ts_match else None
        parent_ts = parent_ts_match.group(1) if parent_ts_match else None

        is_reply = bool(parent_ts) or "Reply to thread" in content or "in thread" in content.lower()

        return thread_ts, parent_ts, is_reply

    def _detect_sender(self, content: str) -> tuple[str | None, str | None]:
        """Detect sender from content."""
        # Look for common sender patterns
        sender_patterns = [
            r'^([A-Za-z]+ [A-Za-z]+):',  # "John Doe:"
            r'^<@(U[A-Z0-9]+)\|([^>]+)>',  # "<@U123|John>"
            r'From:\s*(.+?)(?:\n|$)',  # "From: John"
        ]

        for pattern in sender_patterns:
            match = re.search(pattern, content, re.MULTILINE)
            if match:
                groups = match.groups()
                if len(groups) == 1:
                    return None, groups[0]
                elif len(groups) == 2:
                    return groups[0], groups[1]

        return None, None

    def _detect_channel(self, content: str) -> tuple[str | None, str | None, str]:
        """Detect channel from content."""
        # Look for channel patterns
        channel_patterns = [
            r'in #([a-zA-Z0-9_-]+)',
            r'Channel:\s*#?([a-zA-Z0-9_-]+)',
            r'<#(C[A-Z0-9]+)\|([^>]+)>',
        ]

        for pattern in channel_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                groups = match.groups()
                if len(groups) == 1:
                    return None, groups[0], "channel"
                elif len(groups) == 2:
                    return groups[0], groups[1], "channel"

        # Detect DM indicators
        if "DM" in content or "direct message" in content.lower():
            return None, None, "dm"

        return None, None, "unknown"

    def clean_body(self, content: str) -> str:
        """Clean Slack message text."""
        return self._clean_slack_formatting(content)
