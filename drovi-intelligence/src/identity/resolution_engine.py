"""
Unified Identity Graph Resolution Engine

Manages cross-source identity linking and contact resolution.
Uses the contact_identity table for linking and probabilistic matching
when exact matches fail.

The resolution engine provides:
1. Exact identity resolution (email, Slack ID, phone, CRM ID)
2. Probabilistic matching using weighted signals
3. Merge suggestions for potential duplicates
4. Pre-resolution context for intelligence extraction
"""

from datetime import datetime
from typing import Literal
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field

from src.graph.client import DroviGraph, get_graph_client
from .types import (
    IdentityType,
    IdentitySource,
    Identity,
    ContactContext,
    ResolvedContact,
)

logger = structlog.get_logger()

# Global instance
_identity_graph: "UnifiedIdentityGraph | None" = None


class ResolvedIdentity(BaseModel):
    """Result of identity resolution."""

    contact_id: str
    contact: ResolvedContact
    match_type: Literal["exact", "probabilistic", "new"]
    confidence: float
    matched_identities: list[Identity] = Field(default_factory=list)


class IdentityMatch(BaseModel):
    """A potential identity match during resolution."""

    contact_id: str
    identity_type: IdentityType
    identity_value: str
    confidence: float
    match_source: str  # Which matching strategy found this


class MergeSuggestion(BaseModel):
    """Suggested merge between two contacts."""

    contact_a_id: str
    contact_a_name: str | None
    contact_a_email: str | None

    contact_b_id: str
    contact_b_name: str | None
    contact_b_email: str | None

    confidence: float
    match_reasons: list[str] = Field(default_factory=list)
    shared_identities: list[Identity] = Field(default_factory=list)


class UnifiedIdentityGraph:
    """
    Manages identity linking across sources.

    The Unified Identity Graph enables contact resolution before intelligence
    extraction, providing rich context about who is communicating.

    Resolution priority:
    1. Exact match in contact_identity table
    2. Graph node lookup (Contact:email, Contact:slackId, etc.)
    3. Probabilistic matching using weighted signals
    """

    # Matching signal weights for probabilistic matching
    SIGNAL_WEIGHTS = {
        "name_similarity": 0.25,  # Levenshtein + phonetic
        "email_domain": 0.20,  # Same email domain
        "company": 0.20,  # Same company
        "network_overlap": 0.25,  # Share communication partners
        "temporal_alignment": 0.10,  # Similar first/last interaction times
    }

    def __init__(self, graph: DroviGraph):
        """Initialize with graph client."""
        self.graph = graph

    async def resolve_identifier(
        self,
        identifier_type: IdentityType | str,
        identifier_value: str,
        organization_id: str,
        create_if_missing: bool = False,
        source: IdentitySource | None = None,
        source_account_id: str | None = None,
    ) -> ResolvedIdentity | None:
        """
        Resolve any identifier to a unified contact.

        Args:
            identifier_type: Type of identifier (email, slack_id, phone, etc.)
            identifier_value: The actual identifier value
            organization_id: Organization scope
            create_if_missing: Whether to create new contact if not found
            source: How this identifier was discovered
            source_account_id: Which source account provided this

        Returns:
            ResolvedIdentity with contact and match details, or None
        """
        if isinstance(identifier_type, str):
            identifier_type = IdentityType(identifier_type)

        logger.debug(
            "Resolving identifier",
            type=identifier_type.value,
            value=identifier_value[:20] + "..." if len(identifier_value) > 20 else identifier_value,
            org=organization_id,
        )

        # 1. Try exact match in identity table (via graph)
        contact_id = await self._find_identity_in_graph(
            organization_id, identifier_type, identifier_value
        )

        if contact_id:
            contact = await self._load_contact(contact_id, organization_id)
            if contact:
                logger.debug("Found exact identity match", contact_id=contact_id)
                return ResolvedIdentity(
                    contact_id=contact_id,
                    contact=contact,
                    match_type="exact",
                    confidence=1.0,
                    matched_identities=[
                        Identity(
                            identity_type=identifier_type,
                            identity_value=identifier_value,
                            confidence=1.0,
                        )
                    ],
                )

        # 2. Try direct contact field match
        contact_id = await self._find_contact_by_field(
            organization_id, identifier_type, identifier_value
        )

        if contact_id:
            # Link this identity to the contact
            await self.link_identity(
                contact_id=contact_id,
                identity=Identity(
                    identity_type=identifier_type,
                    identity_value=identifier_value,
                    confidence=0.95,
                    source=source,
                    source_account_id=source_account_id,
                ),
                organization_id=organization_id,
            )

            contact = await self._load_contact(contact_id, organization_id)
            if contact:
                logger.debug("Found contact by field match", contact_id=contact_id)
                return ResolvedIdentity(
                    contact_id=contact_id,
                    contact=contact,
                    match_type="exact",
                    confidence=0.95,
                    matched_identities=[
                        Identity(
                            identity_type=identifier_type,
                            identity_value=identifier_value,
                            confidence=0.95,
                        )
                    ],
                )

        # 3. Try probabilistic matching for emails (can infer from name/domain)
        if identifier_type == IdentityType.EMAIL:
            probabilistic_match = await self._probabilistic_match(
                organization_id, identifier_type, identifier_value
            )
            if probabilistic_match and probabilistic_match.confidence >= 0.7:
                contact = await self._load_contact(
                    probabilistic_match.contact_id, organization_id
                )
                if contact:
                    logger.debug(
                        "Found probabilistic match",
                        contact_id=probabilistic_match.contact_id,
                        confidence=probabilistic_match.confidence,
                    )
                    return ResolvedIdentity(
                        contact_id=probabilistic_match.contact_id,
                        contact=contact,
                        match_type="probabilistic",
                        confidence=probabilistic_match.confidence,
                        matched_identities=[
                            Identity(
                                identity_type=identifier_type,
                                identity_value=identifier_value,
                                confidence=probabilistic_match.confidence,
                            )
                        ],
                    )

        # 4. Create new contact if requested
        if create_if_missing:
            new_contact = await self._create_contact_from_identity(
                organization_id=organization_id,
                identifier_type=identifier_type,
                identifier_value=identifier_value,
                source=source,
                source_account_id=source_account_id,
            )
            if new_contact:
                logger.debug("Created new contact", contact_id=new_contact.id)
                return ResolvedIdentity(
                    contact_id=new_contact.id,
                    contact=new_contact,
                    match_type="new",
                    confidence=1.0,
                    matched_identities=[
                        Identity(
                            identity_type=identifier_type,
                            identity_value=identifier_value,
                            confidence=1.0,
                            source=source,
                            source_account_id=source_account_id,
                        )
                    ],
                )

        return None

    async def link_identity(
        self,
        contact_id: str,
        identity: Identity,
        organization_id: str,
    ) -> bool:
        """
        Link a new identity to an existing contact.

        Creates Identity node in graph with HAS_IDENTITY relationship.

        Args:
            contact_id: Contact to link to
            identity: Identity to link
            organization_id: Organization scope

        Returns:
            True if linked successfully
        """
        try:
            identity_id = str(uuid4())
            now = datetime.utcnow().isoformat()

            # Create Identity node and relationship
            await self.graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                CREATE (i:Identity {
                    id: $identityId,
                    organizationId: $orgId,
                    contactId: $contactId,
                    identityType: $identityType,
                    identityValue: $identityValue,
                    confidence: $confidence,
                    isVerified: $isVerified,
                    source: $source,
                    sourceAccountId: $sourceAccountId,
                    lastSeenAt: $lastSeenAt,
                    createdAt: $createdAt,
                    updatedAt: $updatedAt
                })
                CREATE (c)-[:HAS_IDENTITY {createdAt: $createdAt}]->(i)
                """,
                {
                    "contactId": contact_id,
                    "orgId": organization_id,
                    "identityId": identity_id,
                    "identityType": identity.identity_type.value,
                    "identityValue": identity.identity_value,
                    "confidence": identity.confidence,
                    "isVerified": identity.is_verified,
                    "source": identity.source.value if identity.source else None,
                    "sourceAccountId": identity.source_account_id,
                    "lastSeenAt": identity.last_seen_at.isoformat() if identity.last_seen_at else now,
                    "createdAt": now,
                    "updatedAt": now,
                },
            )

            logger.debug(
                "Identity linked",
                contact_id=contact_id,
                identity_type=identity.identity_type.value,
            )
            return True

        except Exception as e:
            # May fail if identity already exists
            if "already exists" not in str(e).lower() and "unique" not in str(e).lower():
                logger.error(
                    "Failed to link identity",
                    contact_id=contact_id,
                    error=str(e),
                )
            return False

    async def suggest_merges(
        self,
        organization_id: str,
        min_confidence: float = 0.7,
        limit: int = 50,
    ) -> list[MergeSuggestion]:
        """
        Find contacts that should potentially be merged.

        Uses multiple signals:
        - Shared email domain + similar name
        - Same company + similar name
        - Network overlap (communicate with same people)
        - Temporal alignment (similar activity patterns)

        Args:
            organization_id: Organization scope
            min_confidence: Minimum confidence for suggestions
            limit: Maximum suggestions to return

        Returns:
            List of merge suggestions sorted by confidence
        """
        suggestions = []

        try:
            # Find contacts with similar names at same company
            same_company = await self.graph.query(
                """
                MATCH (a:Contact {organizationId: $orgId}), (b:Contact {organizationId: $orgId})
                WHERE a.id < b.id
                  AND a.company IS NOT NULL AND b.company IS NOT NULL
                  AND toLower(a.company) = toLower(b.company)
                  AND a.name IS NOT NULL AND b.name IS NOT NULL
                WITH a, b,
                     CASE
                         WHEN toLower(a.name) = toLower(b.name) THEN 1.0
                         WHEN a.name CONTAINS ' ' AND b.name CONTAINS ' '
                              AND split(toLower(a.name), ' ')[0] = split(toLower(b.name), ' ')[0]
                         THEN 0.8
                         ELSE 0.0
                     END as nameSimilarity
                WHERE nameSimilarity > 0.5
                RETURN a.id as aId, a.name as aName, a.email as aEmail,
                       b.id as bId, b.name as bName, b.email as bEmail,
                       nameSimilarity, a.company as company
                LIMIT $limit
                """,
                {"orgId": organization_id, "limit": limit},
            )

            for match in same_company:
                confidence = 0.6 + (match.get("nameSimilarity", 0) * 0.3)
                if confidence >= min_confidence:
                    suggestions.append(
                        MergeSuggestion(
                            contact_a_id=match["aId"],
                            contact_a_name=match.get("aName"),
                            contact_a_email=match.get("aEmail"),
                            contact_b_id=match["bId"],
                            contact_b_name=match.get("bName"),
                            contact_b_email=match.get("bEmail"),
                            confidence=confidence,
                            match_reasons=[
                                f"Same company: {match.get('company')}",
                                f"Name similarity: {match.get('nameSimilarity', 0):.0%}",
                            ],
                        )
                    )

            # Find contacts with same email domain and high network overlap
            same_domain = await self.graph.query(
                """
                MATCH (a:Contact {organizationId: $orgId}), (b:Contact {organizationId: $orgId})
                WHERE a.id < b.id
                  AND a.email IS NOT NULL AND b.email IS NOT NULL
                  AND a.email <> b.email
                  AND split(a.email, '@')[1] = split(b.email, '@')[1]
                  AND NOT split(a.email, '@')[1] IN ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com']
                OPTIONAL MATCH (a)-[:COMMUNICATES_WITH]-(shared:Contact)-[:COMMUNICATES_WITH]-(b)
                WITH a, b, count(DISTINCT shared) as sharedContacts
                WHERE sharedContacts >= 3
                RETURN a.id as aId, a.name as aName, a.email as aEmail,
                       b.id as bId, b.name as bName, b.email as bEmail,
                       sharedContacts, split(a.email, '@')[1] as domain
                LIMIT $limit
                """,
                {"orgId": organization_id, "limit": limit},
            )

            for match in same_domain:
                # More shared contacts = higher confidence
                shared_count = match.get("sharedContacts", 0)
                network_score = min(1.0, shared_count / 10)
                confidence = 0.5 + (network_score * 0.4)

                if confidence >= min_confidence:
                    suggestions.append(
                        MergeSuggestion(
                            contact_a_id=match["aId"],
                            contact_a_name=match.get("aName"),
                            contact_a_email=match.get("aEmail"),
                            contact_b_id=match["bId"],
                            contact_b_name=match.get("bName"),
                            contact_b_email=match.get("bEmail"),
                            confidence=confidence,
                            match_reasons=[
                                f"Same email domain: {match.get('domain')}",
                                f"Network overlap: {shared_count} shared contacts",
                            ],
                        )
                    )

            # Deduplicate and sort by confidence
            seen = set()
            unique_suggestions = []
            for s in sorted(suggestions, key=lambda x: x.confidence, reverse=True):
                key = tuple(sorted([s.contact_a_id, s.contact_b_id]))
                if key not in seen:
                    seen.add(key)
                    unique_suggestions.append(s)

            return unique_suggestions[:limit]

        except Exception as e:
            logger.error("Failed to find merge suggestions", error=str(e))
            return []

    async def build_contact_context(
        self,
        participant_identifiers: list[tuple[IdentityType | str, str]],
        organization_id: str,
    ) -> ContactContext:
        """
        Build pre-resolution contact context for all participants.

        This is called before intelligence extraction to provide rich
        context about who is involved in the conversation.

        Args:
            participant_identifiers: List of (type, value) tuples
            organization_id: Organization scope

        Returns:
            ContactContext with all resolved contacts
        """
        context = ContactContext()

        for id_type, id_value in participant_identifiers:
            if isinstance(id_type, str):
                try:
                    id_type = IdentityType(id_type)
                except ValueError:
                    continue

            resolution = await self.resolve_identifier(
                identifier_type=id_type,
                identifier_value=id_value,
                organization_id=organization_id,
                create_if_missing=True,
                source=IdentitySource.EMAIL_HEADER,
            )

            if resolution and resolution.contact:
                # Index by identifier
                key = id_value.lower() if id_type == IdentityType.EMAIL else f"{id_type.value}:{id_value}"
                context.resolved_contacts[key] = resolution.contact

                # Track VIP and at-risk
                if resolution.contact.is_vip:
                    context.vip_contacts.append(resolution.contact_id)
                if resolution.contact.is_at_risk:
                    context.at_risk_contacts.append(resolution.contact_id)

                # Get relationship strength
                try:
                    strength_result = await self.graph.query(
                        """
                        MATCH (c:Contact {id: $contactId})-[r:COMMUNICATES_WITH]-()
                        RETURN avg(r.strength) as avgStrength
                        """,
                        {"contactId": resolution.contact_id},
                    )
                    if strength_result:
                        context.relationship_strengths[resolution.contact_id] = (
                            strength_result[0].get("avgStrength", 0.5) or 0.5
                        )
                except Exception:
                    context.relationship_strengths[resolution.contact_id] = 0.5

        return context

    # =========================================================================
    # Private Methods
    # =========================================================================

    async def _find_identity_in_graph(
        self,
        organization_id: str,
        identity_type: IdentityType,
        identity_value: str,
    ) -> str | None:
        """Find contact ID via identity node in graph."""
        try:
            result = await self.graph.query(
                """
                MATCH (i:Identity {
                    organizationId: $orgId,
                    identityType: $type,
                    identityValue: $value
                })
                RETURN i.contactId as contactId
                LIMIT 1
                """,
                {
                    "orgId": organization_id,
                    "type": identity_type.value,
                    "value": identity_value,
                },
            )
            return result[0]["contactId"] if result else None
        except Exception as e:
            logger.debug("Identity graph lookup failed", error=str(e))
            return None

    async def _find_contact_by_field(
        self,
        organization_id: str,
        identity_type: IdentityType,
        identity_value: str,
    ) -> str | None:
        """Find contact by direct field match."""
        try:
            # Map identity type to contact field
            field_mapping = {
                IdentityType.EMAIL: "email",
                IdentityType.EMAIL_ALIAS: "email",
                IdentityType.SLACK_ID: "slackId",
                IdentityType.SLACK_HANDLE: "slackHandle",
                IdentityType.PHONE: "phone",
                IdentityType.WHATSAPP_ID: "waId",
            }

            field = field_mapping.get(identity_type)
            if not field:
                return None

            result = await self.graph.query(
                f"""
                MATCH (c:Contact {{organizationId: $orgId}})
                WHERE c.{field} = $value
                RETURN c.id as id
                LIMIT 1
                """,
                {"orgId": organization_id, "value": identity_value},
            )
            return result[0]["id"] if result else None
        except Exception as e:
            logger.debug("Contact field lookup failed", error=str(e))
            return None

    async def _probabilistic_match(
        self,
        organization_id: str,
        identity_type: IdentityType,
        identifier_value: str,
    ) -> IdentityMatch | None:
        """
        Attempt probabilistic matching using weighted signals.

        Only used for email-type identifiers where we can extract
        name and domain information.
        """
        if identity_type != IdentityType.EMAIL:
            return None

        try:
            # Extract parts from email
            local_part, domain = identifier_value.split("@")

            # Try to infer name from local part
            # john.doe@example.com -> "John Doe"
            # johndoe@example.com -> "Johndoe"
            name_parts = local_part.replace("_", ".").replace("-", ".").split(".")
            inferred_name = " ".join(p.capitalize() for p in name_parts if p)

            if not inferred_name or len(inferred_name) < 3:
                return None

            # Search for contacts with similar name and same domain
            result = await self.graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                WHERE c.email IS NOT NULL
                  AND split(c.email, '@')[1] = $domain
                  AND c.name IS NOT NULL
                WITH c,
                     CASE
                         WHEN toLower(c.name) = toLower($inferredName) THEN 1.0
                         WHEN toLower(c.name) CONTAINS toLower($inferredName) THEN 0.8
                         WHEN toLower($inferredName) CONTAINS toLower(c.name) THEN 0.7
                         ELSE 0.0
                     END as nameScore
                WHERE nameScore > 0.5
                RETURN c.id as contactId, c.name as name, c.email as email, nameScore
                ORDER BY nameScore DESC
                LIMIT 1
                """,
                {
                    "orgId": organization_id,
                    "domain": domain,
                    "inferredName": inferred_name,
                },
            )

            if result:
                # Calculate confidence based on match quality
                name_score = result[0].get("nameScore", 0)
                # Domain match + name match = high confidence
                confidence = 0.5 + (name_score * 0.4)

                return IdentityMatch(
                    contact_id=result[0]["contactId"],
                    identity_type=identity_type,
                    identity_value=identifier_value,
                    confidence=confidence,
                    match_source=f"probabilistic:domain+name({name_score:.0%})",
                )

            return None

        except Exception as e:
            logger.debug("Probabilistic matching failed", error=str(e))
            return None

    async def _load_contact(
        self,
        contact_id: str,
        organization_id: str,
    ) -> ResolvedContact | None:
        """Load full contact details from graph."""
        try:
            result = await self.graph.query(
                """
                MATCH (c:Contact {id: $contactId, organizationId: $orgId})
                OPTIONAL MATCH (c)-[:HAS_IDENTITY]->(i:Identity)
                RETURN c, collect(i) as identities
                """,
                {"contactId": contact_id, "orgId": organization_id},
            )

            if not result:
                return None

            contact_data = result[0]["c"]
            identities_data = result[0].get("identities", [])

            # Parse identities
            identities = []
            for i_data in identities_data:
                if i_data:
                    identities.append(
                        Identity(
                            id=i_data.get("id"),
                            identity_type=IdentityType(i_data.get("identityType", "email")),
                            identity_value=i_data.get("identityValue", ""),
                            confidence=i_data.get("confidence", 1.0),
                            is_verified=i_data.get("isVerified", False),
                        )
                    )

            return ResolvedContact(
                id=contact_id,
                organization_id=organization_id,
                primary_email=contact_data.get("email"),
                display_name=contact_data.get("name"),
                company=contact_data.get("company"),
                title=contact_data.get("title"),
                identities=identities,
                importance_score=contact_data.get("importanceScore", 0),
                health_score=contact_data.get("healthScore", 0),
                engagement_score=contact_data.get("engagementScore", 0),
                sentiment_score=contact_data.get("sentimentScore", 0),
                is_vip=contact_data.get("isVip", False),
                is_at_risk=contact_data.get("isAtRisk", False),
                lifecycle_stage=contact_data.get("lifecycleStage", "unknown"),
                role_type=contact_data.get("roleType", "unknown"),
                pagerank_score=contact_data.get("pagerankScore", 0),
                bridging_score=contact_data.get("betweennessScore", 0),
                total_threads=contact_data.get("totalThreads", 0),
                total_messages=contact_data.get("totalMessages", 0),
            )

        except Exception as e:
            logger.error("Failed to load contact", contact_id=contact_id, error=str(e))
            return None

    async def _create_contact_from_identity(
        self,
        organization_id: str,
        identifier_type: IdentityType,
        identifier_value: str,
        source: IdentitySource | None,
        source_account_id: str | None,
    ) -> ResolvedContact | None:
        """Create new contact from an identifier."""
        try:
            contact_id = str(uuid4())
            now = datetime.utcnow().isoformat()

            # Build contact properties based on identifier type
            email = identifier_value if identifier_type == IdentityType.EMAIL else None
            phone = identifier_value if identifier_type == IdentityType.PHONE else None
            slack_id = identifier_value if identifier_type == IdentityType.SLACK_ID else None
            slack_handle = identifier_value if identifier_type == IdentityType.SLACK_HANDLE else None

            # Infer name from email if possible
            name = None
            if email and "@" in email:
                local_part = email.split("@")[0]
                name_parts = local_part.replace("_", ".").replace("-", ".").split(".")
                name = " ".join(p.capitalize() for p in name_parts if p)

            # Create contact node
            await self.graph.query(
                """
                CREATE (c:Contact {
                    id: $id,
                    organizationId: $orgId,
                    name: $name,
                    email: $email,
                    phone: $phone,
                    slackId: $slackId,
                    slackHandle: $slackHandle,
                    sources: $sources,
                    firstSeenAt: $firstSeenAt,
                    lastSeenAt: $lastSeenAt,
                    createdAt: $createdAt,
                    updatedAt: $updatedAt,
                    lifecycleStage: 'unknown',
                    roleType: 'unknown',
                    importanceScore: 0.0,
                    healthScore: 0.5,
                    engagementScore: 0.0
                })
                """,
                {
                    "id": contact_id,
                    "orgId": organization_id,
                    "name": name or "",
                    "email": email or "",
                    "phone": phone or "",
                    "slackId": slack_id or "",
                    "slackHandle": slack_handle or "",
                    "sources": [source.value] if source else [],
                    "firstSeenAt": now,
                    "lastSeenAt": now,
                    "createdAt": now,
                    "updatedAt": now,
                },
            )

            # Link identity
            await self.link_identity(
                contact_id=contact_id,
                identity=Identity(
                    identity_type=identifier_type,
                    identity_value=identifier_value,
                    confidence=1.0,
                    source=source,
                    source_account_id=source_account_id,
                ),
                organization_id=organization_id,
            )

            return ResolvedContact(
                id=contact_id,
                organization_id=organization_id,
                primary_email=email,
                display_name=name,
                identities=[
                    Identity(
                        identity_type=identifier_type,
                        identity_value=identifier_value,
                        confidence=1.0,
                    )
                ],
            )

        except Exception as e:
            logger.error(
                "Failed to create contact from identity",
                error=str(e),
                identifier_type=identifier_type.value,
            )
            return None


# =============================================================================
# Factory Functions
# =============================================================================


async def get_identity_graph() -> UnifiedIdentityGraph:
    """Get or create the global identity graph instance."""
    global _identity_graph

    if _identity_graph is None:
        graph = await get_graph_client()
        _identity_graph = UnifiedIdentityGraph(graph)

    return _identity_graph
