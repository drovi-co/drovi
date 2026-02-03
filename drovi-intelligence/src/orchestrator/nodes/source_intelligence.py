"""
Source Intelligence Node

Rule-based source/channel classification to eliminate garbage BEFORE extraction.
Applies to ALL data sources: email, Slack, Notion, Calendar, CRM, etc.

This node runs FIRST in the pipeline to:
1. Classify content category (human vs system vs marketing)
2. Determine extraction level (full, minimal, skip)
3. Save LLM costs by skipping obvious noise

No LLM calls - pure rule-based classification.
"""

import re
import time
from dataclasses import dataclass
from enum import Enum
from typing import Literal

import structlog

from ..state import (
    IntelligenceState,
    NodeTiming,
)

logger = structlog.get_logger()


# =============================================================================
# Content Category Classification
# =============================================================================


class ContentCategory(str, Enum):
    """Content category for pipeline routing."""

    HUMAN = "human"  # Real person → Full extraction
    SYSTEM = "system"  # Bot/automated → Skip or minimal
    TRANSACTIONAL = "transactional"  # Receipts/confirmations → Dates only
    MARKETING = "marketing"  # Promotional content → Skip


@dataclass
class SourceIntelligence:
    """Result of source analysis."""

    source_type: str  # gmail, slack, notion, calendar, hubspot, etc.
    category: ContentCategory
    should_extract: bool
    extraction_level: Literal["full", "minimal", "structured", "skip"]
    reasoning: str

    # Additional context
    sender_type: str | None = None  # noreply, bot, human, etc.
    is_newsletter: bool = False
    is_automated: bool = False


# =============================================================================
# EMAIL RULES
# =============================================================================

EMAIL_NOREPLY_PATTERNS = [
    r"^no[-_]?reply@",
    r"^notifications?@",
    r"^bounce@",
    r"^mailer[-_]?daemon@",
    r"^postmaster@",
    r"^do[-_]?not[-_]?reply@",
    r"^automated@",
    r"^system@",
    r"^robot@",
    r"^auto@",
]

EMAIL_SYSTEM_DOMAINS = {
    # DevOps & CI/CD
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "sentry.io",
    "vercel.com",
    "netlify.com",
    "circleci.com",
    "travis-ci.com",
    "jenkins.io",
    "datadog.com",
    "pagerduty.com",
    "opsgenie.com",
    "atlassian.com",
    "jira.com",
    # Cloud services
    "aws.amazon.com",
    "amazonses.com",
    "cloud.google.com",
    "azure.microsoft.com",
    # Monitoring & Analytics
    "mixpanel.com",
    "segment.com",
    "amplitude.com",
    "newrelic.com",
    "rollbar.com",
    "bugsnag.com",
    "logrocket.com",
}

EMAIL_NEWSLETTER_DOMAINS = {
    "substack.com",
    "beehiiv.com",
    "mailchimp.com",
    "sendgrid.net",
    "constantcontact.com",
    "campaignmonitor.com",
    "mailerlite.com",
    "convertkit.com",
    "buttondown.email",
    "revue.email",
    "ghost.io",
    "medium.com",
    # Community platforms
    "skool.com",
    "circle.so",
    "discord.com",
    "slack.com",
    # More newsletter services
    "getrevue.co",
    "sendinblue.com",
    "klaviyo.com",
    "drip.com",
    "aweber.com",
    "customer.io",
    "postmarkapp.com",
    "sparkpost.com",
    "mailgun.org",
}

EMAIL_TRANSACTIONAL_PATTERNS = [
    r"(?i)order\s*confirmation",
    r"(?i)receipt\s*for",
    r"(?i)invoice\s*#",
    r"(?i)payment\s*received",
    r"(?i)shipping\s*notification",
    r"(?i)delivery\s*update",
    r"(?i)your\s*order\s*has\s*shipped",
    r"(?i)password\s*reset",
    r"(?i)verify\s*your\s*email",
    r"(?i)confirm\s*your\s*account",
    r"(?i)two[-_]?factor\s*authentication",
    r"(?i)login\s*alert",
    r"(?i)security\s*alert",
    # Legal/Policy updates
    r"(?i)privacy\s*policy.*updated",
    r"(?i)terms\s*of\s*service.*updated",
    r"(?i)updating.*subprocessors?",
    r"(?i)legal\s*update",
    r"(?i)policy\s*change",
]

EMAIL_MARKETING_PATTERNS = [
    r"(?i)unsubscribe",
    r"(?i)email\s*preferences",
    r"(?i)manage\s*subscriptions?",
    r"(?i)view\s*in\s*browser",
    r"(?i)update\s*profile",
    r"(?i)opt[-_]?out",
    r"(?i)special\s*offer",
    r"(?i)limited\s*time",
    r"(?i)don't\s*miss\s*out",
    r"(?i)exclusive\s*deal",
    r"(?i)sale\s*ends",
    r"(?i)discount\s*code",
]

# =============================================================================
# SLACK/MESSAGING RULES
# =============================================================================

SLACK_BOT_PATTERNS = [
    "slackbot",
    "workflow_bot",
    "apps/",
    "B0",  # Bot user IDs start with B0
    "integration",
]

SLACK_SYSTEM_SUBTYPES = {
    "channel_join",
    "channel_leave",
    "channel_topic",
    "channel_purpose",
    "channel_name",
    "channel_archive",
    "channel_unarchive",
    "pinned_item",
    "unpinned_item",
    "file_share",
    "file_comment",
    "file_mention",
    "bot_message",
    "me_message",
    "reminder_add",
    "reminder_delete",
}

SLACK_NOISE_PATTERNS = [
    r"^<!here>$",
    r"^<!channel>$",
    r"^<!everyone>$",
    r"^:[\w+-]+:$",  # Emoji-only messages
    r"^\+1$",
    r"^👍$",
    r"^thanks!?$",
    r"^ty!?$",
    r"^thx!?$",
    r"^ok!?$",
    r"^sure!?$",
    r"^yes!?$",
    r"^no!?$",
]

# =============================================================================
# NOTION/DOCUMENT RULES
# =============================================================================

NOTION_TEMPLATE_PATTERNS = [
    r"(?i)^template",
    r"(?i)\[template\]",
    r"(?i)^untitled$",
    r"(?i)\[duplicate\]",
    r"(?i)\[copy\]",
    r"(?i)^new\s*page$",
    r"(?i)^getting\s*started",
]

NOTION_SYSTEM_TYPES = {
    "collection_view",
    "collection_view_page",
    "synced_block",
    "link_to_page",
    "breadcrumb",
    "table_of_contents",
    "divider",
}

# =============================================================================
# CALENDAR RULES
# =============================================================================

CALENDAR_SKIP_STATUSES = {"declined", "cancelled", "tentative"}

CALENDAR_TEMPLATE_PATTERNS = [
    r"(?i)^placeholder",
    r"(?i)^block",
    r"(?i)^focus\s*time",
    r"(?i)^lunch",
    r"(?i)^busy$",
    r"(?i)^hold$",
    r"(?i)^no\s*meeting",
    r"(?i)^personal",
    r"(?i)^private",
]

CALENDAR_RECURRING_NOISE_PATTERNS = [
    r"(?i)daily\s*standup",
    r"(?i)weekly\s*sync",
    r"(?i)team\s*meeting$",
    r"(?i)^\d+:\d+\s*sync$",
    r"(?i)^1:1\s*with",
    r"(?i)^one\s*on\s*one",
]

# =============================================================================
# CRM RULES
# =============================================================================

CRM_MARKETING_STAGES = {
    "subscriber",
    "lead",
    "marketing_qualified_lead",
    "marketingqualifiedlead",
    "mql",
    "other",
}

CRM_SYSTEM_SOURCES = {
    "import",
    "csv_import",
    "form",
    "landing_page",
    "integration",
    "api",
    "migration",
    "bulk_import",
}

CRM_BOT_EMAILS = [
    r"(?i)^noreply@",
    r"(?i)^marketing@",
    r"(?i)^sales@",
    r"(?i)^info@",
    r"(?i)^contact@",
    r"(?i)^hello@",
    r"(?i)^support@",
    r"(?i)^team@",
]


# =============================================================================
# SOURCE ANALYSIS FUNCTIONS
# =============================================================================


def analyze_source(source_type: str, metadata: dict | None = None) -> SourceIntelligence:
    """
    Classify content BEFORE extraction to save LLM costs.

    Args:
        source_type: Type of source (email, slack, notion, calendar, etc.)
        metadata: Source-specific metadata containing sender, headers, etc.

    Returns:
        SourceIntelligence with category and extraction level
    """
    metadata = metadata or {}

    if source_type in ("email", "gmail", "outlook"):
        return _analyze_email(metadata)
    if source_type in ("slack", "teams", "whatsapp"):
        return _analyze_messaging(metadata, source_type)
    if source_type in ("notion", "google_docs"):
        return _analyze_document(metadata, source_type)
    if source_type in ("calendar", "google_calendar"):
        return _analyze_calendar(metadata)
    if source_type in ("meeting", "call", "recording", "transcript"):
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.HUMAN,
            should_extract=True,
            extraction_level="full",
            reasoning="live session content",
        )
    if source_type in ("hubspot", "salesforce", "crm"):
        return _analyze_crm(metadata, source_type)
    if source_type in ("s3", "bigquery", "postgresql", "mysql", "mongodb"):
        return _analyze_storage(metadata, source_type)

    # Unknown source - default to full extraction
    return SourceIntelligence(
        source_type=source_type,
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="full",
        reasoning="unknown source type, defaulting to full extraction",
    )


def _analyze_email(data: dict) -> SourceIntelligence:
    """Analyze email for content category."""
    sender = data.get("from", "").lower()
    subject = data.get("subject", "").lower()
    headers = data.get("headers", {})

    # Check for noreply patterns
    for pattern in EMAIL_NOREPLY_PATTERNS:
        if re.search(pattern, sender):
            return SourceIntelligence(
                source_type="email",
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"noreply sender pattern: {pattern}",
                sender_type="noreply",
                is_automated=True,
            )

    # Check for system domains
    sender_domain = sender.split("@")[-1] if "@" in sender else ""
    if sender_domain in EMAIL_SYSTEM_DOMAINS:
        return SourceIntelligence(
            source_type="email",
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"system domain: {sender_domain}",
            sender_type="system",
            is_automated=True,
        )

    # Check for newsletter domains
    if sender_domain in EMAIL_NEWSLETTER_DOMAINS:
        return SourceIntelligence(
            source_type="email",
            category=ContentCategory.MARKETING,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"newsletter domain: {sender_domain}",
            is_newsletter=True,
            is_automated=True,
        )

    # Check for transactional patterns in subject
    for pattern in EMAIL_TRANSACTIONAL_PATTERNS:
        if re.search(pattern, subject):
            return SourceIntelligence(
                source_type="email",
                category=ContentCategory.TRANSACTIONAL,
                should_extract=True,
                extraction_level="minimal",
                reasoning=f"transactional subject: {pattern}",
                is_automated=True,
            )

    # Check List-Unsubscribe header (strong newsletter signal)
    if headers.get("List-Unsubscribe") or headers.get("list-unsubscribe"):
        return SourceIntelligence(
            source_type="email",
            category=ContentCategory.MARKETING,
            should_extract=False,
            extraction_level="skip",
            reasoning="has List-Unsubscribe header",
            is_newsletter=True,
            is_automated=True,
        )

    # Check for marketing patterns in body (if available)
    body = data.get("body", "").lower()
    marketing_score = 0
    for pattern in EMAIL_MARKETING_PATTERNS:
        if re.search(pattern, body):
            marketing_score += 1

    if marketing_score >= 3:
        return SourceIntelligence(
            source_type="email",
            category=ContentCategory.MARKETING,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"marketing patterns found: {marketing_score}",
            is_newsletter=True,
            is_automated=True,
        )

    # Default: human email
    return SourceIntelligence(
        source_type="email",
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="full",
        reasoning="appears to be human email",
        sender_type="human",
    )


def _analyze_messaging(data: dict, source_type: str) -> SourceIntelligence:
    """Analyze Slack/Teams/WhatsApp message for content category."""
    subtype = data.get("subtype", "")
    user_id = data.get("user", "")
    text = data.get("text", "").strip()
    bot_id = data.get("bot_id")

    # Check for bot message
    if bot_id:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning="bot message (has bot_id)",
            sender_type="bot",
            is_automated=True,
        )

    # Check for system subtype
    if subtype in SLACK_SYSTEM_SUBTYPES:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"system subtype: {subtype}",
            is_automated=True,
        )

    # Check for bot patterns in user ID
    for pattern in SLACK_BOT_PATTERNS:
        if pattern.lower() in user_id.lower():
            return SourceIntelligence(
                source_type=source_type,
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"bot user pattern: {pattern}",
                sender_type="bot",
                is_automated=True,
            )

    # Check for noise patterns (emoji-only, reactions, etc.)
    for pattern in SLACK_NOISE_PATTERNS:
        if re.match(pattern, text, re.IGNORECASE):
            return SourceIntelligence(
                source_type=source_type,
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"noise pattern: {pattern}",
            )

    # Check for very short messages (likely reactions/acknowledgments)
    if len(text) < 5:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning="message too short (likely acknowledgment)",
        )

    # Default: human message
    return SourceIntelligence(
        source_type=source_type,
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="full",
        reasoning="appears to be human message",
        sender_type="human",
    )


def _analyze_document(data: dict, source_type: str) -> SourceIntelligence:
    """Analyze Notion/Google Docs for content category."""
    title = data.get("title", "").lower()
    page_type = data.get("type", "")
    is_template = data.get("is_template", False)

    # Check for template flag
    if is_template:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning="marked as template",
            is_automated=True,
        )

    # Check for template patterns in title
    for pattern in NOTION_TEMPLATE_PATTERNS:
        if re.search(pattern, title):
            return SourceIntelligence(
                source_type=source_type,
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"template title pattern: {pattern}",
            )

    # Check for system page types
    if page_type in NOTION_SYSTEM_TYPES:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"system page type: {page_type}",
        )

    # Check for empty content
    content = data.get("content", "")
    if not content or len(content.strip()) < 10:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning="empty or near-empty page",
        )

    # Default: real document
    return SourceIntelligence(
        source_type=source_type,
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="full",
        reasoning="appears to be real document",
    )


def _analyze_calendar(data: dict) -> SourceIntelligence:
    """Analyze calendar event for content category."""
    status = data.get("status", "").lower()
    summary = data.get("summary", "").lower()
    attendees = data.get("attendees", [])
    is_recurring = data.get("recurring", False)
    organizer_self = data.get("organizer_is_self", False)

    # Check for declined/cancelled
    if status in CALENDAR_SKIP_STATUSES:
        return SourceIntelligence(
            source_type="calendar",
            category=ContentCategory.SYSTEM,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"event status: {status}",
        )

    # Check for placeholder patterns
    for pattern in CALENDAR_TEMPLATE_PATTERNS:
        if re.search(pattern, summary):
            return SourceIntelligence(
                source_type="calendar",
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"placeholder event: {pattern}",
            )

    # Check for recurring noise patterns (daily standups without content)
    if is_recurring:
        for pattern in CALENDAR_RECURRING_NOISE_PATTERNS:
            if re.search(pattern, summary):
                # Only skip if no description
                description = data.get("description", "")
                if not description or len(description.strip()) < 20:
                    return SourceIntelligence(
                        source_type="calendar",
                        category=ContentCategory.SYSTEM,
                        should_extract=False,
                        extraction_level="skip",
                        reasoning=f"recurring noise event: {pattern}",
                    )

    # Events with external attendees are more valuable
    has_external_attendees = any(
        not a.get("self", False) for a in attendees
    )

    # Real calendar event - use structured extraction
    return SourceIntelligence(
        source_type="calendar",
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="structured",  # Calendar events get structured extraction
        reasoning="real calendar event" + (
            " with external attendees" if has_external_attendees else ""
        ),
    )


def _analyze_crm(data: dict, source_type: str) -> SourceIntelligence:
    """Analyze CRM contact/deal for content category."""
    lifecycle_stage = data.get("lifecyclestage", "").lower()
    lead_source = data.get("hs_analytics_source", "").lower()
    email = data.get("email", "").lower()
    contact_type = data.get("contact_type", "")

    # Check for marketing lifecycle stages
    if lifecycle_stage in CRM_MARKETING_STAGES:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.MARKETING,
            should_extract=False,
            extraction_level="skip",
            reasoning=f"marketing lifecycle stage: {lifecycle_stage}",
        )

    # Check for system/import sources
    if lead_source in CRM_SYSTEM_SOURCES:
        return SourceIntelligence(
            source_type=source_type,
            category=ContentCategory.SYSTEM,
            should_extract=True,
            extraction_level="minimal",
            reasoning=f"imported contact: {lead_source}",
        )

    # Check for generic/bot emails
    for pattern in CRM_BOT_EMAILS:
        if re.search(pattern, email):
            return SourceIntelligence(
                source_type=source_type,
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"generic email pattern: {pattern}",
            )

    # Default: real contact/deal
    return SourceIntelligence(
        source_type=source_type,
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="full",
        reasoning="appears to be real contact/deal",
    )


def _analyze_storage(data: dict, source_type: str) -> SourceIntelligence:
    """Analyze storage/database records for content category."""
    file_path = data.get("path", "").lower()
    file_type = data.get("type", "").lower()

    # Skip system files
    system_patterns = [
        r"\.log$",
        r"\.tmp$",
        r"\.bak$",
        r"/_metadata/",
        r"/\.git/",
        r"/node_modules/",
        r"/__pycache__/",
        r"/\.cache/",
        r"thumbs\.db$",
        r"\.ds_store$",
    ]

    for pattern in system_patterns:
        if re.search(pattern, file_path):
            return SourceIntelligence(
                source_type=source_type,
                category=ContentCategory.SYSTEM,
                should_extract=False,
                extraction_level="skip",
                reasoning=f"system file pattern: {pattern}",
            )

    # Default: analyze content
    return SourceIntelligence(
        source_type=source_type,
        category=ContentCategory.HUMAN,
        should_extract=True,
        extraction_level="full",
        reasoning="appears to be data file",
    )


# =============================================================================
# NODE FUNCTION
# =============================================================================


async def source_intelligence_node(state: IntelligenceState) -> dict:
    """
    Analyze source to determine content category and extraction level.

    This is the FIRST node in the pipeline. It runs before any LLM calls
    to save costs by skipping obvious noise.

    Pipeline position: FIRST (before parse_messages)

    Args:
        state: Current intelligence state

    Returns:
        Dict with source_intelligence field and updated routing
    """
    start_time = time.time()

    logger.info(
        "Starting source intelligence analysis",
        analysis_id=state.analysis_id,
        organization_id=state.input.organization_id,
        source_type=state.input.source_type,
    )

    # Analyze the source
    intelligence = analyze_source(
        source_type=state.input.source_type,
        metadata=state.input.metadata,
    )

    # Update routing based on analysis
    updated_routing = state.routing.model_copy()

    if not intelligence.should_extract:
        # Skip all extraction nodes
        updated_routing.should_extract_commitments = False
        updated_routing.should_extract_decisions = False
        updated_routing.should_analyze_risk = False
        updated_routing.should_deduplicate = False
        updated_routing.skip_remaining_nodes = True

    elif intelligence.extraction_level == "minimal":
        # Only extract basic info
        updated_routing.should_extract_commitments = False
        updated_routing.should_extract_decisions = False
        updated_routing.should_analyze_risk = False

    elif intelligence.extraction_level == "structured":
        # Calendar events - structured extraction
        # Keep all extraction but use structured prompts
        pass

    logger.info(
        "Source intelligence complete",
        analysis_id=state.analysis_id,
        category=intelligence.category.value,
        should_extract=intelligence.should_extract,
        extraction_level=intelligence.extraction_level,
        reasoning=intelligence.reasoning,
    )

    # Update trace
    elapsed = time.time() - start_time
    updated_trace = state.trace.model_copy()
    updated_trace.nodes = [*state.trace.nodes, "source_intelligence"]
    updated_trace.current_node = "source_intelligence"
    updated_trace.node_timings["source_intelligence"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "trace": updated_trace,
        "routing": updated_routing,
        "source_intelligence": {
            "category": intelligence.category.value,
            "should_extract": intelligence.should_extract,
            "extraction_level": intelligence.extraction_level,
            "reasoning": intelligence.reasoning,
            "sender_type": intelligence.sender_type,
            "is_newsletter": intelligence.is_newsletter,
            "is_automated": intelligence.is_automated,
        },
    }
