"""
Parse Messages Node

Parses raw content into structured messages for analysis.
"""

import re
from datetime import datetime

import structlog

from ..state import IntelligenceState, ParsedMessage, NodeTiming

logger = structlog.get_logger()


def parse_email_thread(content: str, user_email: str | None = None) -> list[ParsedMessage]:
    """Parse an email thread into individual messages."""
    messages = []

    # Common email separator patterns
    separators = [
        r"(?:^|\n)(?:From|De|Von):\s*(.+?)(?:\n|$)",
        r"(?:^|\n)On\s+.+?wrote:",
        r"(?:^|\n)-+\s*(?:Original|Forwarded)\s+Message\s*-+",
        r"(?:^|\n)>{3,}",
    ]

    # Try to split by common patterns
    parts = [content]
    for sep in separators:
        new_parts = []
        for part in parts:
            split = re.split(sep, part, flags=re.IGNORECASE | re.MULTILINE)
            new_parts.extend([p.strip() for p in split if p.strip()])
        if len(new_parts) > len(parts):
            parts = new_parts
            break

    # Create messages from parts
    for i, part in enumerate(parts):
        # Try to extract sender info
        sender_email = None
        sender_name = None

        # Look for email patterns
        email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", part)
        if email_match:
            sender_email = email_match.group()

        # Look for name patterns like "From: John Doe <email>"
        name_match = re.search(r"(?:From|De):\s*([^<\n]+?)(?:<|$)", part)
        if name_match:
            sender_name = name_match.group(1).strip()

        is_from_user = bool(user_email and sender_email and sender_email.lower() == user_email.lower())

        messages.append(ParsedMessage(
            id=f"msg_{i}",
            content=part,
            sender_email=sender_email,
            sender_name=sender_name,
            is_from_user=is_from_user,
        ))

    return messages if messages else [ParsedMessage(id="msg_0", content=content, is_from_user=False)]


def parse_slack_messages(content: str, user_email: str | None = None, metadata: dict | None = None) -> list[ParsedMessage]:
    """Parse Slack-style messages with timestamp support."""
    messages = []
    metadata = metadata or {}

    # Enhanced Slack patterns
    # Pattern 1: [timestamp] username: message
    # Pattern 2: username: message
    # Pattern 3: @username message
    # Pattern 4: Structured JSON from API (name, text, ts)

    lines = content.split("\n")
    current_message = []
    current_sender = None
    current_timestamp = None

    for line in lines:
        # Pattern with timestamp: [2024-01-15 10:30] john: Hello
        ts_sender_match = re.match(r"^\[([^\]]+)\]\s*(?:@)?(\w+[\w\s]*):\s*(.*)$", line)
        # Pattern without timestamp: john: Hello
        sender_match = re.match(r"^(?:@)?(\w+[\w\s]*):\s*(.*)$", line)

        if ts_sender_match:
            # Save previous message
            if current_message and current_sender:
                messages.append(ParsedMessage(
                    id=f"msg_{len(messages)}",
                    content="\n".join(current_message),
                    sender_name=current_sender,
                    sent_at=current_timestamp,
                    is_from_user=_is_user_sender(current_sender, user_email, metadata),
                ))

            current_timestamp = _parse_timestamp(ts_sender_match.group(1))
            current_sender = ts_sender_match.group(2).strip()
            current_message = [ts_sender_match.group(3)] if ts_sender_match.group(3) else []

        elif sender_match:  # New sender detected
            if current_message and current_sender:
                messages.append(ParsedMessage(
                    id=f"msg_{len(messages)}",
                    content="\n".join(current_message),
                    sender_name=current_sender,
                    sent_at=current_timestamp,
                    is_from_user=_is_user_sender(current_sender, user_email, metadata),
                ))

            current_sender = sender_match.group(1).strip()
            current_message = [sender_match.group(2)] if sender_match.group(2) else []
            current_timestamp = None
        else:
            if line.strip():  # Skip empty lines
                current_message.append(line)

    # Don't forget the last message
    if current_message:
        messages.append(ParsedMessage(
            id=f"msg_{len(messages)}",
            content="\n".join(current_message),
            sender_name=current_sender,
            sent_at=current_timestamp,
            is_from_user=_is_user_sender(current_sender, user_email, metadata),
        ))

    return messages if messages else [ParsedMessage(id="msg_0", content=content)]


def parse_meeting_transcript(content: str) -> list[ParsedMessage]:
    """
    Parse meeting/call transcripts in the form:
    Speaker: sentence...
    """
    messages: list[ParsedMessage] = []
    current_speaker = None
    current_lines: list[str] = []

    for line in content.splitlines():
        if ":" in line:
            parts = line.split(":", 1)
            speaker = parts[0].strip()
            text = parts[1].strip()
            if speaker and text:
                if current_speaker and current_lines:
                    messages.append(
                        ParsedMessage(
                            id=f"msg_{len(messages)}",
                            content="\n".join(current_lines),
                            sender_name=current_speaker,
                        )
                    )
                current_speaker = speaker
                current_lines = [text]
                continue
        if line.strip():
            current_lines.append(line.strip())

    if current_speaker and current_lines:
        messages.append(
            ParsedMessage(
                id=f"msg_{len(messages)}",
                content="\n".join(current_lines),
                sender_name=current_speaker,
            )
        )

    if not messages:
        messages = [ParsedMessage(id="msg_0", content=content)]

    return messages


def _parse_calendar_from_text(content: str) -> dict:
    """Extract calendar event details from plain text content.

    Handles formats like:
    - "Event: Title"
    - "Time: Start - End"
    - "Location: Place"
    - "Organizer: Name"
    - "Attendees: Name1, Name2"
    """
    result = {}

    # Extract title
    title_patterns = [
        r"^Event:\s*(.+?)(?:\.|$)",
        r"^Title:\s*(.+?)(?:\.|$)",
        r"^Subject:\s*(.+?)(?:\.|$)",
        r"^CALENDAR EVENT:\s*(.+?)(?:\.|$)",
    ]
    for pattern in title_patterns:
        match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
        if match:
            result["title"] = match.group(1).strip()
            break

    # If no title found, use first sentence as title
    if not result.get("title"):
        first_sentence = content.split(".")[0].strip()
        if len(first_sentence) < 200:
            result["title"] = first_sentence

    # Extract time
    time_patterns = [
        r"Time:\s*(.+?)(?:\.|$|(?=\s*Location))",
        r"When:\s*(.+?)(?:\.|$|(?=\s*Location))",
        r"Date:\s*(.+?)(?:\.|$|(?=\s*Location))",
    ]
    for pattern in time_patterns:
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            time_text = match.group(1).strip()
            # Try to split start/end times
            if " to " in time_text.lower():
                parts = re.split(r"\s+to\s+", time_text, flags=re.IGNORECASE)
                if len(parts) == 2:
                    result["start_time"] = parts[0].strip()
                    result["end_time"] = parts[1].strip()
            elif " - " in time_text:
                parts = time_text.split(" - ")
                if len(parts) == 2:
                    result["start_time"] = parts[0].strip()
                    result["end_time"] = parts[1].strip()
            else:
                result["start_time"] = time_text
            break

    # Extract location
    location_match = re.search(r"Location:\s*(.+?)(?:\.|$|(?=\s*(?:Organizer|Attendees)))", content, re.IGNORECASE)
    if location_match:
        result["location"] = location_match.group(1).strip()

    # Extract organizer
    organizer_match = re.search(r"Organizer:\s*(.+?)(?:\.|$|(?=\s*Attendees))", content, re.IGNORECASE)
    if organizer_match:
        organizer_text = organizer_match.group(1).strip()
        email_match = re.search(r"([^\s<]+@[^\s>]+)", organizer_text)
        result["organizer"] = {
            "name": organizer_text.split("<")[0].strip() if "<" in organizer_text else organizer_text,
            "email": email_match.group(1) if email_match else None,
        }

    # Extract attendees
    attendees_match = re.search(r"Attendees?:\s*(.+?)(?:\.|$|(?=\s*(?:Agenda|Description|Action)))", content, re.IGNORECASE | re.DOTALL)
    if attendees_match:
        attendees_text = attendees_match.group(1).strip()
        attendees = []
        # Split by comma, newline, or semicolon
        for part in re.split(r"[,;\n]+", attendees_text):
            part = part.strip()
            if part:
                email_match = re.search(r"([^\s<]+@[^\s>]+)", part)
                attendees.append({
                    "name": part.split("<")[0].strip() if "<" in part else part.split("(")[0].strip(),
                    "email": email_match.group(1) if email_match else None,
                    "status": "unknown",
                })
        result["attendees"] = attendees

    # Extract description/agenda
    desc_patterns = [
        r"Description:\s*(.+?)(?=$|(?=\s*Action items))",
        r"Agenda:\s*(.+?)(?=$|(?=\s*Action items))",
    ]
    for pattern in desc_patterns:
        match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
        if match:
            result["description"] = match.group(1).strip()
            break

    # If no description found, try to extract everything after attendees
    if not result.get("description"):
        # Find where the main content starts (after headers)
        header_end = 0
        for marker in ["Attendees:", "Agenda:", "Description:"]:
            idx = content.lower().find(marker.lower())
            if idx > header_end:
                header_end = idx
        if header_end > 0:
            # Get content after headers
            remaining = content[header_end:]
            colon_idx = remaining.find(":")
            if colon_idx > 0:
                result["description"] = remaining[colon_idx + 1:].strip()

    return result


def parse_calendar_event(content: str, user_email: str | None = None, metadata: dict | None = None) -> list[ParsedMessage]:
    """Parse calendar event into structured content for intelligence extraction.

    Calendar events are special - they have structured metadata that should be
    formatted for optimal extraction of commitments and tasks.

    If no metadata is provided, attempts to parse structured info from plain text.
    """
    metadata = metadata or {}

    # If no metadata, try to extract from plain text content
    if not metadata.get("title"):
        parsed_from_text = _parse_calendar_from_text(content)
        metadata = {**parsed_from_text, **metadata}  # metadata overrides parsed

    # Extract event details from metadata
    title = metadata.get("title", "")
    description = metadata.get("description", content)  # Use full content if no description
    organizer = metadata.get("organizer", {})
    attendees = metadata.get("attendees", [])
    start_time = metadata.get("start_time", "")
    end_time = metadata.get("end_time", "")
    location = metadata.get("location", "")
    recurrence = metadata.get("recurrence", "")
    is_organizer = metadata.get("is_organizer", False)

    # Format attendees list
    attendee_lines = []
    for a in attendees:
        status = a.get("status", "unknown")
        name = a.get("name", a.get("email", "Unknown"))
        status_emoji = {"accepted": "✓", "declined": "✗", "tentative": "?", "needs_action": "○"}.get(status, "○")
        attendee_lines.append(f"  {status_emoji} {name}")

    # Build structured content for intelligence extraction
    content_parts = []

    # Header with event title
    if title:
        content_parts.append(f"CALENDAR EVENT: {title}")

    # Time information
    if start_time and end_time:
        content_parts.append(f"Time: {start_time} - {end_time}")
    elif start_time:
        content_parts.append(f"Time: {start_time}")

    # Location
    if location:
        content_parts.append(f"Location: {location}")

    # Recurrence
    if recurrence:
        content_parts.append(f"Recurrence: {recurrence}")

    # Organizer
    organizer_name = organizer.get("name", organizer.get("email", "Unknown"))
    content_parts.append(f"Organizer: {organizer_name}")

    # Attendees
    if attendee_lines:
        content_parts.append("Attendees:")
        content_parts.extend(attendee_lines)

    # Description/agenda
    if description:
        content_parts.append("")
        content_parts.append("Event Description/Agenda:")
        content_parts.append(description)

    # Add hints for extraction
    content_parts.append("")
    content_parts.append("--- EXTRACTION HINTS ---")
    content_parts.append("This is a calendar event. Look for:")
    content_parts.append("- Implicit commitments from attendees to attend")
    content_parts.append("- Action items or deliverables mentioned in the description")
    content_parts.append("- Decisions that need to be made during this meeting")
    content_parts.append("- Follow-up tasks from previous meetings")

    formatted_content = "\n".join(content_parts)

    # Determine if user is organizer or attendee
    organizer_email = organizer.get("email") if isinstance(organizer, dict) else None
    is_from_user = bool(is_organizer) or bool(
        user_email and organizer_email and
        organizer_email.lower() == user_email.lower()
    )

    return [ParsedMessage(
        id="event_0",
        content=formatted_content,
        sender_name=organizer_name,
        sender_email=organizer_email,
        sent_at=_parse_timestamp(start_time) if start_time else None,
        is_from_user=is_from_user,
    )]


def parse_whatsapp_messages(content: str, user_email: str | None = None, metadata: dict | None = None) -> list[ParsedMessage]:
    """Parse WhatsApp-style messages with timestamp support.

    WhatsApp message formats:
    - [1/15/24, 10:30 AM] John: Hello
    - 1/15/24, 10:30 AM - John: Hello
    - John (10:30): Hello
    """
    metadata = metadata or {}
    messages = []

    lines = content.split("\n")
    current_message = []
    current_sender = None
    current_timestamp = None

    # WhatsApp patterns
    # Pattern 1: [1/15/24, 10:30 AM] John: message
    wa_pattern1 = re.compile(r"^\[(\d{1,2}/\d{1,2}/\d{2,4},?\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)\]\s*([^:]+):\s*(.*)$", re.IGNORECASE)
    # Pattern 2: 1/15/24, 10:30 AM - John: message
    wa_pattern2 = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2,4},?\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*-\s*([^:]+):\s*(.*)$", re.IGNORECASE)
    # Pattern 3: John (10:30): message
    wa_pattern3 = re.compile(r"^([^(]+)\s*\((\d{1,2}:\d{2})\):\s*(.*)$")

    for line in lines:
        match = wa_pattern1.match(line) or wa_pattern2.match(line) or wa_pattern3.match(line)

        if match:
            # Save previous message
            if current_message and current_sender:
                messages.append(ParsedMessage(
                    id=f"msg_{len(messages)}",
                    content="\n".join(current_message),
                    sender_name=current_sender,
                    sent_at=current_timestamp,
                    is_from_user=_is_user_sender(current_sender, user_email, metadata),
                ))

            if len(match.groups()) == 3:
                current_timestamp = _parse_timestamp(match.group(1))
                current_sender = match.group(2).strip()
                current_message = [match.group(3)] if match.group(3) else []
        else:
            if line.strip():
                current_message.append(line)

    # Last message
    if current_message:
        messages.append(ParsedMessage(
            id=f"msg_{len(messages)}",
            content="\n".join(current_message),
            sender_name=current_sender,
            sent_at=current_timestamp,
            is_from_user=_is_user_sender(current_sender, user_email, metadata),
        ))

    return messages if messages else [ParsedMessage(id="msg_0", content=content)]


def parse_notion_page(content: str, user_email: str | None = None, metadata: dict | None = None) -> list[ParsedMessage]:
    """Parse Notion page content with metadata context."""
    metadata = metadata or {}

    page_title = metadata.get("title", "Untitled Page")
    last_edited_by = metadata.get("last_edited_by", {})
    created_by = metadata.get("created_by", {})
    comments = metadata.get("comments", [])

    # Build structured content
    content_parts = [f"NOTION PAGE: {page_title}", ""]

    if last_edited_by:
        content_parts.append(f"Last edited by: {last_edited_by.get('name', 'Unknown')}")

    content_parts.append("")
    content_parts.append("Page Content:")
    content_parts.append(content)

    # Include comments as separate messages for context
    messages = [ParsedMessage(
        id="page_0",
        content="\n".join(content_parts),
        sender_name=created_by.get("name"),
        sender_email=created_by.get("email"),
        is_from_user=False,
    )]

    for i, comment in enumerate(comments):
        messages.append(ParsedMessage(
            id=f"comment_{i}",
            content=f"[Comment] {comment.get('text', '')}",
            sender_name=comment.get("author", {}).get("name"),
            sender_email=comment.get("author", {}).get("email"),
            sent_at=_parse_timestamp(comment.get("created_at")),
            is_from_user=False,
        ))

    return messages


def parse_google_doc(content: str, user_email: str | None = None, metadata: dict | None = None) -> list[ParsedMessage]:
    """Parse Google Doc content with comments."""
    metadata = metadata or {}

    doc_title = metadata.get("title", "Untitled Document")
    owner = metadata.get("owner", {})
    comments = metadata.get("comments", [])

    content_parts = [f"GOOGLE DOC: {doc_title}", ""]

    if owner:
        content_parts.append(f"Owner: {owner.get('name', owner.get('email', 'Unknown'))}")

    content_parts.append("")
    content_parts.append("Document Content:")
    content_parts.append(content)

    messages = [ParsedMessage(
        id="doc_0",
        content="\n".join(content_parts),
        sender_name=owner.get("name"),
        sender_email=owner.get("email"),
        is_from_user=bool(user_email and owner.get("email", "").lower() == user_email.lower()),
    )]

    for i, comment in enumerate(comments):
        messages.append(ParsedMessage(
            id=f"comment_{i}",
            content=f"[Comment] {comment.get('content', '')}",
            sender_name=comment.get("author", {}).get("displayName"),
            sender_email=comment.get("author", {}).get("emailAddress"),
            sent_at=_parse_timestamp(comment.get("createdTime")),
            is_from_user=False,
        ))

    return messages


def _parse_timestamp(ts_str: str | None) -> datetime | None:
    """Try to parse various timestamp formats."""
    if not ts_str:
        return None

    formats = [
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%m/%d/%y, %I:%M %p",
        "%m/%d/%Y, %I:%M %p",
        "%d/%m/%Y %H:%M",
        "%H:%M",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(ts_str.strip(), fmt)
        except ValueError:
            continue

    return None


def _is_user_sender(sender_name: str | None, user_email: str | None, metadata: dict) -> bool:
    """Determine if sender is the user based on various signals."""
    if not sender_name:
        return False

    # Check against user email username
    if user_email:
        username = user_email.split("@")[0].lower()
        if sender_name.lower() == username:
            return True

    # Check against metadata user info
    user_name = metadata.get("user_name", "")
    if user_name and sender_name.lower() == user_name.lower():
        return True

    user_slack_id = metadata.get("user_slack_id", "")
    if user_slack_id and sender_name.lower() == user_slack_id.lower():
        return True

    return False


def parse_generic_content(content: str, user_email: str | None = None) -> list[ParsedMessage]:
    """Parse generic content as a single message."""
    return [ParsedMessage(
        id="msg_0",
        content=content,
        is_from_user=True,  # Assume API input is from user
    )]


async def parse_messages_node(state: IntelligenceState) -> dict:
    """
    Parse raw content into structured messages.

    This node:
    1. Detects the content format (email thread, Slack, etc.)
    2. Splits content into individual messages
    3. Extracts sender information where possible
    4. Identifies which messages are from the user

    Returns:
        State update with parsed messages
    """
    import time
    start_time = time.time()

    logger.info(
        "Parsing messages",
        analysis_id=state.analysis_id,
        source_type=state.input.source_type,
        content_length=len(state.input.content),
    )

    # Update trace
    state.trace.current_node = "parse_messages"
    state.trace.nodes.append("parse_messages")

    content = state.input.content
    source_type = state.input.source_type
    user_email = state.input.user_email
    metadata = state.input.metadata or {}

    # Choose parser based on source type
    if source_type == "email":
        messages = parse_email_thread(content, user_email)
    elif source_type == "slack":
        messages = parse_slack_messages(content, user_email, metadata)
    elif source_type == "calendar":
        messages = parse_calendar_event(content, user_email, metadata)
    elif source_type == "whatsapp":
        messages = parse_whatsapp_messages(content, user_email, metadata)
    elif source_type == "notion":
        messages = parse_notion_page(content, user_email, metadata)
    elif source_type == "google_docs":
        messages = parse_google_doc(content, user_email, metadata)
    elif source_type in ("meeting", "call", "recording"):
        messages = parse_meeting_transcript(content)
    else:
        # Generic parsing
        messages = parse_generic_content(content, user_email)

    logger.info(
        "Messages parsed",
        analysis_id=state.analysis_id,
        message_count=len(messages),
    )

    # Prefer upstream message IDs when provided (preserve source linkage)
    if state.input.message_ids:
        provided_ids = list(state.input.message_ids)
        if len(provided_ids) == len(messages):
            for message, message_id in zip(messages, provided_ids):
                message.id = message_id
        elif len(provided_ids) == 1:
            base_id = provided_ids[0]
            for idx, message in enumerate(messages):
                message.id = base_id if idx == 0 else f"{base_id}_{idx}"

    # Record timing
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "messages": messages,
        "trace": {
            **state.trace.model_dump(),
            "node_timings": {
                **state.trace.node_timings,
                "parse_messages": node_timing,
            },
        },
    }
