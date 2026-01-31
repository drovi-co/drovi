"""
Content Zone Detection Node

Source-specific content cleaning to remove noise zones before extraction.

Zones removed by source type:
- EMAIL: Signatures, footers, quoted replies, disclaimers
- SLACK: @here/@channel mentions, emoji-only, formatting artifacts
- NOTION: Metadata blocks, TOC, synced block indicators
- CALENDAR: Recurring boilerplate, declined attendees
- CRM: System fields, analytics properties
"""

import re
import time
from dataclasses import dataclass, field

import structlog

from ..state import (
    IntelligenceState,
    NodeTiming,
)

logger = structlog.get_logger()


@dataclass
class CleanedContent:
    """Result of content zone cleaning."""

    primary_content: str
    removed_zones: list[str] = field(default_factory=list)
    source_type: str = ""
    original_length: int = 0
    cleaned_length: int = 0

    @property
    def reduction_ratio(self) -> float:
        """Calculate how much content was removed."""
        if self.original_length == 0:
            return 0.0
        return 1.0 - (self.cleaned_length / self.original_length)


# =============================================================================
# EMAIL CLEANING
# =============================================================================

# Signature delimiters
EMAIL_SIGNATURE_PATTERNS = [
    r"\n--\s*\n",  # Standard signature delimiter
    r"\n_{3,}\s*\n",  # Underscores
    r"\n-{3,}\s*\n",  # Dashes
    r"\nBest,?\s*\n",
    r"\nBest regards,?\s*\n",
    r"\nRegards,?\s*\n",
    r"\nKind regards,?\s*\n",
    r"\nThanks,?\s*\n",
    r"\nThank you,?\s*\n",
    r"\nCheers,?\s*\n",
    r"\nSincerely,?\s*\n",
    r"\nWarm regards,?\s*\n",
]

# Footer patterns to remove
EMAIL_FOOTER_PATTERNS = [
    r"(?i)unsubscribe\s+from\s+this\s+list",
    r"(?i)click\s+here\s+to\s+unsubscribe",
    r"(?i)manage\s+your\s+preferences",
    r"(?i)email\s+preferences",
    r"(?i)privacy\s+policy",
    r"(?i)terms\s+of\s+service",
    r"(?i)all\s+rights\s+reserved",
    r"(?i)confidential\s+and\s+proprietary",
    r"(?i)this\s+email\s+(and\s+any\s+attachments?\s+)?is\s+(intended\s+)?for",
    r"(?i)if\s+you\s+received\s+this\s+in\s+error",
    r"(?i)sent\s+from\s+my\s+iphone",
    r"(?i)sent\s+from\s+my\s+android",
    r"(?i)sent\s+from\s+mail\s+for\s+windows",
    r"(?i)get\s+outlook\s+for\s+ios",
    r"(?i)view\s+this\s+email\s+in\s+your\s+browser",
    r"(?i)forward\s+this\s+email",
    r"(?i)share\s+on\s+(twitter|facebook|linkedin)",
    r"(?i)follow\s+us\s+on",
    r"(?i)\d+\s+\w+\s+(street|st|avenue|ave|road|rd|blvd|boulevard),?\s+",  # Addresses
]

# Quote patterns
EMAIL_QUOTE_PATTERNS = [
    r"\n>.*(?:\n>.*)*",  # Lines starting with >
    r"(?i)\non\s+.+wrote:\s*\n",  # "On [date] [person] wrote:"
    r"(?i)\nfrom:\s+.+\nsent:\s+.+\n",  # Outlook-style quote header
    r"(?i)-----original\s+message-----",  # Forwarded message
    r"(?i)begin\s+forwarded\s+message:",
]


def _clean_email(body: str) -> CleanedContent:
    """Remove email signatures, footers, and quoted replies."""
    if not body:
        return CleanedContent("", [], "email", 0, 0)

    original_length = len(body)
    removed = []
    cleaned = body

    # Remove quoted content first (usually at the bottom)
    for pattern in EMAIL_QUOTE_PATTERNS:
        match = re.search(pattern, cleaned, re.IGNORECASE | re.DOTALL)
        if match:
            # Remove from match to end
            quote_start = match.start()
            if quote_start > 100:  # Keep if there's meaningful content before
                cleaned = cleaned[:quote_start]
                removed.append("quoted_reply")
                break

    # Find and remove signature
    earliest_sig_pos = len(cleaned)
    for pattern in EMAIL_SIGNATURE_PATTERNS:
        match = re.search(pattern, cleaned, re.IGNORECASE)
        if match and match.start() < earliest_sig_pos:
            # Only treat as signature if it's in the last 40% of the email
            if match.start() > len(cleaned) * 0.6:
                earliest_sig_pos = match.start()

    if earliest_sig_pos < len(cleaned):
        cleaned = cleaned[:earliest_sig_pos]
        removed.append("signature")

    # Remove footer patterns line by line from the end
    lines = cleaned.split("\n")
    footer_start = len(lines)
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        is_footer = False
        for pattern in EMAIL_FOOTER_PATTERNS:
            if re.search(pattern, line):
                is_footer = True
                break
        if is_footer:
            footer_start = i
        elif line and len(line) > 50:
            # Stop if we hit substantial content
            break

    if footer_start < len(lines):
        lines = lines[:footer_start]
        removed.append("footer")

    cleaned = "\n".join(lines).strip()

    return CleanedContent(
        primary_content=cleaned,
        removed_zones=removed,
        source_type="email",
        original_length=original_length,
        cleaned_length=len(cleaned),
    )


# =============================================================================
# MESSAGING CLEANING
# =============================================================================

# Slack formatting to clean
SLACK_FORMAT_PATTERNS = [
    (r"<@U[\w]+>", "[mention]"),  # User mentions
    (r"<#C[\w]+\|[\w-]+>", "[channel]"),  # Channel mentions
    (r"<!subteam\^[\w]+\|@[\w]+>", "[group]"),  # Group mentions
    (r"<(https?://[^|>]+)\|([^>]+)>", r"\2"),  # Links with alt text
    (r"<(https?://[^>]+)>", r"\1"),  # Plain links
    (r"```[\s\S]*?```", "[code block]"),  # Code blocks
    (r"`[^`]+`", "[code]"),  # Inline code
]

# Noise messages to filter
SLACK_NOISE_EXACT = {
    "<!here>",
    "<!channel>",
    "<!everyone>",
    "+1",
    "👍",
    "👎",
    "✅",
    "❌",
    "🎉",
    "thanks",
    "thanks!",
    "ty",
    "thx",
    "ok",
    "okay",
    "sure",
    "sure!",
    "yes",
    "no",
    "yep",
    "nope",
    "sounds good",
    "lgtm",
    "sgtm",
}


def _is_emoji_only(text: str) -> bool:
    """Check if text contains only emoji."""
    # Remove whitespace
    text = text.strip()
    if not text:
        return True

    # Common emoji pattern (simplified)
    emoji_pattern = re.compile(
        r"^[\U0001F300-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF"
        r"\U00002600-\U000026FF\U00002700-\U000027BF\s:+-]+$"
    )
    return bool(emoji_pattern.match(text))


def _clean_slack_formatting(text: str) -> str:
    """Clean Slack-specific formatting."""
    for pattern, replacement in SLACK_FORMAT_PATTERNS:
        text = re.sub(pattern, replacement, text)
    return text


def _clean_messaging(data: dict) -> CleanedContent:
    """Clean Slack/Teams/WhatsApp messages."""
    text = data.get("text", "")
    if not text:
        return CleanedContent("", [], "messaging", 0, 0)

    original_length = len(text)
    removed = []
    text = text.strip()

    # Check for noise messages
    if text.lower() in SLACK_NOISE_EXACT:
        return CleanedContent(
            "",
            ["noise_message"],
            "messaging",
            original_length,
            0,
        )

    # Check for emoji-only
    if _is_emoji_only(text):
        return CleanedContent(
            "",
            ["emoji_only"],
            "messaging",
            original_length,
            0,
        )

    # Clean formatting
    cleaned = _clean_slack_formatting(text)
    if cleaned != text:
        removed.append("formatting")

    return CleanedContent(
        primary_content=cleaned.strip(),
        removed_zones=removed,
        source_type="messaging",
        original_length=original_length,
        cleaned_length=len(cleaned),
    )


# =============================================================================
# DOCUMENT CLEANING
# =============================================================================

# Notion metadata patterns
NOTION_METADATA_PATTERNS = [
    r"(?i)created\s+(by|on|at):\s*.+",
    r"(?i)last\s+edited\s+(by|on|at):\s*.+",
    r"(?i)last\s+modified:\s*.+",
    r"(?i)owner:\s*.+",
    r"(?i)status:\s*(draft|review|published|archived)",
    r"(?i)tags?:\s*.+",
    r"(?i)category:\s*.+",
]

# Empty/placeholder content
NOTION_PLACEHOLDER_PATTERNS = [
    r"^#\s*$",  # Empty heading
    r"^\s*\[\s*\]\s*$",  # Empty checkbox
    r"^-\s*$",  # Empty bullet
    r"^\d+\.\s*$",  # Empty numbered item
    r"^>\s*$",  # Empty quote
    r"^⬜\s*$",  # Empty checkbox emoji
    r"^Type\s+here\.{3}$",
    r"^Add\s+content\.{3}$",
    r"^Click\s+to\s+edit\.{3}$",
]


def _clean_document(data: dict) -> CleanedContent:
    """Clean Notion/Google Docs content."""
    content = data.get("content", "")
    if not content:
        return CleanedContent("", [], "document", 0, 0)

    original_length = len(content)
    removed = []
    lines = content.split("\n")
    cleaned_lines = []

    for line in lines:
        stripped = line.strip()

        # Skip metadata lines
        is_metadata = False
        for pattern in NOTION_METADATA_PATTERNS:
            if re.match(pattern, stripped):
                is_metadata = True
                removed.append("metadata")
                break

        if is_metadata:
            continue

        # Skip placeholder lines
        is_placeholder = False
        for pattern in NOTION_PLACEHOLDER_PATTERNS:
            if re.match(pattern, stripped):
                is_placeholder = True
                removed.append("placeholder")
                break

        if is_placeholder:
            continue

        cleaned_lines.append(line)

    # Remove consecutive empty lines (keep max 1)
    final_lines = []
    prev_empty = False
    for line in cleaned_lines:
        is_empty = not line.strip()
        if is_empty:
            if not prev_empty:
                final_lines.append("")
            prev_empty = True
        else:
            final_lines.append(line)
            prev_empty = False

    cleaned = "\n".join(final_lines).strip()

    return CleanedContent(
        primary_content=cleaned,
        removed_zones=list(set(removed)),  # Deduplicate
        source_type="document",
        original_length=original_length,
        cleaned_length=len(cleaned),
    )


# =============================================================================
# CALENDAR CLEANING
# =============================================================================

# Calendar boilerplate patterns
CALENDAR_BOILERPLATE_PATTERNS = [
    r"(?i)^-{3,}$",
    r"(?i)join\s+(zoom|google\s+meet|teams|webex)",
    r"(?i)meeting\s+id:\s*\d+",
    r"(?i)password:\s*\S+",
    r"(?i)passcode:\s*\S+",
    r"(?i)dial\s+in:\s*[\d\s\-\+\(\)]+",
    r"(?i)one\s+tap\s+mobile",
    r"(?i)^https?://\S+zoom\S*$",
    r"(?i)^https?://\S+meet\.google\S*$",
    r"(?i)^https?://\S+teams\S*$",
]


def _clean_calendar(event: dict) -> CleanedContent:
    """Extract meaningful calendar event content."""
    summary = event.get("summary", "")
    description = event.get("description", "")
    location = event.get("location", "")
    attendees = event.get("attendees", [])

    parts = []
    removed = []

    # Add summary
    if summary:
        parts.append(f"Event: {summary}")

    # Clean description
    if description:
        desc_lines = description.split("\n")
        clean_desc_lines = []

        for line in desc_lines:
            stripped = line.strip()
            is_boilerplate = False

            for pattern in CALENDAR_BOILERPLATE_PATTERNS:
                if re.match(pattern, stripped):
                    is_boilerplate = True
                    removed.append("meeting_link_boilerplate")
                    break

            if not is_boilerplate and stripped:
                clean_desc_lines.append(stripped)

        if clean_desc_lines:
            parts.append("Description: " + " ".join(clean_desc_lines))

    # Add location if not a meeting link
    if location and not re.match(r"https?://", location):
        parts.append(f"Location: {location}")

    # Add attendees (only accepted/confirmed)
    attendee_names = []
    for attendee in attendees:
        status = attendee.get("responseStatus", "")
        if status in ("accepted", "confirmed", "needsAction"):
            name = attendee.get("displayName") or attendee.get("email", "")
            if name and not attendee.get("self"):
                attendee_names.append(name)

    if attendee_names:
        parts.append(f"Attendees: {', '.join(attendee_names[:10])}")  # Limit to 10

    meaningful = "\n".join(parts)
    original_length = len(summary) + len(description or "")

    return CleanedContent(
        primary_content=meaningful.strip(),
        removed_zones=list(set(removed)),
        source_type="calendar",
        original_length=original_length,
        cleaned_length=len(meaningful),
    )


# =============================================================================
# CRM CLEANING
# =============================================================================

# CRM fields to skip
CRM_SYSTEM_FIELDS = {
    "id",
    "hs_object_id",
    "createdate",
    "lastmodifieddate",
    "hs_analytics_source",
    "hs_analytics_first_url",
    "hs_analytics_last_url",
    "hs_analytics_num_page_views",
    "hs_analytics_num_visits",
    "hs_analytics_average_page_views",
    "hs_analytics_revenue",
    "hs_email_sends_since_last_engagement",
    "hs_sequences_enrolled_count",
    "num_conversion_events",
    "num_unique_conversion_events",
    "hs_calculated_merged_vids",
    "hs_marketable_status",
}

# CRM fields with meaningful content
CRM_CONTENT_FIELDS = {
    "notes",
    "description",
    "content",
    "body",
    "message",
    "hs_content",
    "engagement_notes",
    "bio",
    "about",
    "summary",
}


def _clean_crm(record: dict) -> CleanedContent:
    """Clean CRM record content."""
    content_parts = []
    removed = []
    original_length = 0

    for field_name, value in record.items():
        if not value or not isinstance(value, str):
            continue

        original_length += len(value)

        # Skip system fields
        if field_name.lower() in CRM_SYSTEM_FIELDS:
            removed.append(f"system_field:{field_name}")
            continue

        # Include content fields
        if field_name.lower() in CRM_CONTENT_FIELDS:
            content_parts.append(f"{field_name}: {value}")

    content = "\n".join(content_parts)

    return CleanedContent(
        primary_content=content.strip(),
        removed_zones=removed[:5],  # Limit removed zones logged
        source_type="crm",
        original_length=original_length,
        cleaned_length=len(content),
    )


# =============================================================================
# MAIN FUNCTION
# =============================================================================


def get_primary_content(source_type: str, raw_content: str | dict) -> CleanedContent:
    """
    Source-specific content cleaning.

    Args:
        source_type: Type of source (email, slack, notion, etc.)
        raw_content: Raw content (string for email, dict for structured sources)

    Returns:
        CleanedContent with noise removed
    """
    if source_type in ("email", "gmail", "outlook"):
        if isinstance(raw_content, dict):
            body = raw_content.get("body", raw_content.get("content", ""))
        else:
            body = raw_content
        return _clean_email(body)

    if source_type in ("slack", "teams", "whatsapp"):
        if isinstance(raw_content, str):
            raw_content = {"text": raw_content}
        return _clean_messaging(raw_content)

    if source_type in ("notion", "google_docs"):
        if isinstance(raw_content, str):
            raw_content = {"content": raw_content}
        return _clean_document(raw_content)

    if source_type in ("calendar", "google_calendar"):
        if isinstance(raw_content, str):
            raw_content = {"description": raw_content}
        return _clean_calendar(raw_content)

    if source_type in ("hubspot", "salesforce", "crm"):
        if isinstance(raw_content, str):
            raw_content = {"notes": raw_content}
        return _clean_crm(raw_content)

    # Unknown source - return as-is
    content = raw_content if isinstance(raw_content, str) else str(raw_content)
    return CleanedContent(
        primary_content=content,
        removed_zones=[],
        source_type=source_type,
        original_length=len(content),
        cleaned_length=len(content),
    )


# =============================================================================
# NODE FUNCTION
# =============================================================================


async def content_zones_node(state: IntelligenceState) -> dict:
    """
    Clean content by removing noise zones before extraction.

    This node runs after pipeline_router for FULL extraction path.
    It removes signatures, footers, boilerplate, etc.

    Pipeline position: After pipeline_router (full path), before parse_messages

    Args:
        state: Current intelligence state

    Returns:
        Dict with cleaned_content field
    """
    start_time = time.time()

    logger.info(
        "Starting content zone detection",
        analysis_id=state.analysis_id,
        source_type=state.input.source_type,
        original_length=len(state.input.content),
    )

    # Clean the content
    cleaned = get_primary_content(
        source_type=state.input.source_type,
        raw_content=state.input.content if not state.input.metadata else {
            "body": state.input.content,
            "content": state.input.content,
            "text": state.input.content,
            **state.input.metadata,
        },
    )

    logger.info(
        "Content zone detection complete",
        analysis_id=state.analysis_id,
        original_length=cleaned.original_length,
        cleaned_length=cleaned.cleaned_length,
        reduction_ratio=f"{cleaned.reduction_ratio:.1%}",
        removed_zones=cleaned.removed_zones,
    )

    # Update trace
    updated_trace = state.trace.model_copy()
    updated_trace.nodes = [*state.trace.nodes, "content_zones"]
    updated_trace.current_node = "content_zones"
    updated_trace.node_timings["content_zones"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    # Create updated input with cleaned content
    updated_input = state.input.model_copy()
    # Store original and set cleaned
    original_content = state.input.content

    return {
        "trace": updated_trace,
        "cleaned_content": {
            "content": cleaned.primary_content,
            "original_content": original_content,
            "removed_zones": cleaned.removed_zones,
            "reduction_ratio": cleaned.reduction_ratio,
        },
    }
