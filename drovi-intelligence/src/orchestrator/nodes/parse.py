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


def parse_slack_messages(content: str, user_email: str | None = None) -> list[ParsedMessage]:
    """Parse Slack-style messages."""
    messages = []

    # Slack message pattern: "username: message" or "@username message"
    lines = content.split("\n")
    current_message = []
    current_sender = None

    for line in lines:
        # Check for new message start
        sender_match = re.match(r"^(?:@)?(\w+):\s*(.*)$", line)

        if sender_match:
            # Save previous message if exists
            if current_message and current_sender:
                messages.append(ParsedMessage(
                    id=f"msg_{len(messages)}",
                    content="\n".join(current_message),
                    sender_name=current_sender,
                    is_from_user=False,  # Would need more context
                ))

            current_sender = sender_match.group(1)
            current_message = [sender_match.group(2)] if sender_match.group(2) else []
        else:
            current_message.append(line)

    # Don't forget the last message
    if current_message:
        messages.append(ParsedMessage(
            id=f"msg_{len(messages)}",
            content="\n".join(current_message),
            sender_name=current_sender,
            is_from_user=False,
        ))

    return messages if messages else [ParsedMessage(id="msg_0", content=content)]


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

    # Choose parser based on source type
    if source_type == "email":
        messages = parse_email_thread(content, user_email)
    elif source_type == "slack":
        messages = parse_slack_messages(content, user_email)
    elif source_type in ["notion", "google_docs"]:
        # Document content - treat as single message
        messages = parse_generic_content(content, user_email)
    else:
        # Generic parsing
        messages = parse_generic_content(content, user_email)

    logger.info(
        "Messages parsed",
        analysis_id=state.analysis_id,
        message_count=len(messages),
    )

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
