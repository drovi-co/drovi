"""
Identity Resolution Type Definitions

Types for cross-source identity linking and contact resolution.
"""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class IdentityType(str, Enum):
    """Types of identities that can be linked to a contact."""

    EMAIL = "email"
    EMAIL_ALIAS = "email_alias"
    SLACK_ID = "slack_id"
    SLACK_HANDLE = "slack_handle"
    PHONE = "phone"
    WHATSAPP_ID = "whatsapp_id"
    CRM_SALESFORCE = "crm_salesforce"
    CRM_HUBSPOT = "crm_hubspot"
    CRM_PIPEDRIVE = "crm_pipedrive"
    CRM_ZOHO = "crm_zoho"
    LINKEDIN_URL = "linkedin_url"
    TWITTER_HANDLE = "twitter_handle"
    GITHUB_USERNAME = "github_username"
    NOTION_USER_ID = "notion_user_id"
    GOOGLE_ID = "google_id"
    CALENDAR_ATTENDEE_ID = "calendar_attendee_id"
    EXTERNAL_ID = "external_id"


class IdentitySource(str, Enum):
    """How the identity link was discovered."""

    EMAIL_HEADER = "email_header"
    SLACK_PROFILE = "slack_profile"
    CRM_SYNC = "crm_sync"
    CALENDAR_INVITE = "calendar_invite"
    MANUAL = "manual"
    AI_INFERENCE = "ai_inference"
    OAUTH_PROFILE = "oauth_profile"
    API_ENRICHMENT = "api_enrichment"


class Identity(BaseModel):
    """Represents a single identity that can be linked to a contact."""

    id: str | None = None
    identity_type: IdentityType
    identity_value: str
    confidence: float = 1.0
    is_verified: bool = False
    source: IdentitySource | None = None
    source_account_id: str | None = None
    last_seen_at: datetime | None = None


class ResolvedContact(BaseModel):
    """
    Contact with all resolved identities and relationship context.
    Used as pre-resolution context for intelligence extraction.
    """

    id: str
    organization_id: str

    # Basic info
    primary_email: str | None = None
    display_name: str | None = None
    company: str | None = None
    title: str | None = None

    # All linked identities
    identities: list[Identity] = Field(default_factory=list)

    # Relationship metrics
    importance_score: float = 0.0
    health_score: float = 0.0
    engagement_score: float = 0.0
    sentiment_score: float = 0.0

    # Status flags
    is_vip: bool = False
    is_at_risk: bool = False

    # Intelligence
    lifecycle_stage: str = "unknown"
    role_type: str = "unknown"

    # Graph metrics
    pagerank_score: float = 0.0
    bridging_score: float = 0.0

    # Interaction history
    total_threads: int = 0
    total_messages: int = 0
    last_interaction_at: datetime | None = None


class ContactContext(BaseModel):
    """
    Pre-resolved contact context injected into intelligence extraction state.

    This provides relationship context that enriches commitment/decision extraction.
    For example, the prompt can include "This is from your VIP contact John (CEO of Acme)".
    """

    # Mapping of identifier (email, slack_id, etc.) to resolved contact
    resolved_contacts: dict[str, ResolvedContact] = Field(default_factory=dict)

    # Relationship strengths (contact_id -> strength score)
    relationship_strengths: dict[str, float] = Field(default_factory=dict)

    # Topic history (contact_id -> list of recent topics)
    topic_history: dict[str, list[str]] = Field(default_factory=dict)

    # Special contact lists
    vip_contacts: list[str] = Field(default_factory=list)  # VIP contact IDs
    at_risk_contacts: list[str] = Field(default_factory=list)  # At-risk contact IDs

    # Context generation timestamp
    generated_at: datetime = Field(default_factory=datetime.utcnow)

    def get_contact_by_email(self, email: str) -> ResolvedContact | None:
        """Get resolved contact by email."""
        return self.resolved_contacts.get(email.lower())

    def get_contact_by_slack_id(self, slack_id: str) -> ResolvedContact | None:
        """Get resolved contact by Slack ID."""
        return (
            self.resolved_contacts.get(f"slack_id:{slack_id}")
            or self.resolved_contacts.get(f"slack:{slack_id}")
        )

    def get_contact_by_phone(self, phone: str) -> ResolvedContact | None:
        """Get resolved contact by phone number."""
        # Normalize phone number
        normalized = "".join(c for c in phone if c.isdigit())
        return self.resolved_contacts.get(f"phone:{normalized}")

    def is_vip(self, contact_id: str) -> bool:
        """Check if a contact is VIP."""
        return contact_id in self.vip_contacts

    def is_at_risk(self, contact_id: str) -> bool:
        """Check if a contact is at risk."""
        return contact_id in self.at_risk_contacts

    def get_context_string(self, contact: ResolvedContact) -> str:
        """
        Generate a context string for use in prompts.

        Example: "John Doe (CEO at Acme Inc, VIP contact, 85% health score)"
        """
        parts = []

        # Name and title
        if contact.display_name:
            parts.append(contact.display_name)
        if contact.title and contact.company:
            parts.append(f"({contact.title} at {contact.company})")
        elif contact.company:
            parts.append(f"(at {contact.company})")
        elif contact.title:
            parts.append(f"({contact.title})")

        # Flags
        flags = []
        if contact.is_vip:
            flags.append("VIP contact")
        if contact.is_at_risk:
            flags.append("at-risk relationship")
        if contact.lifecycle_stage != "unknown":
            flags.append(contact.lifecycle_stage)
        if contact.role_type != "unknown":
            flags.append(contact.role_type.replace("_", " "))

        if flags:
            parts.append(f"[{', '.join(flags)}]")

        # Health score
        if contact.health_score > 0:
            parts.append(f"{int(contact.health_score * 100)}% health")

        return " ".join(parts)
