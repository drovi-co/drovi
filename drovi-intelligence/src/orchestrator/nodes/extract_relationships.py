"""
Relationship Extraction Node

Extracts relationship signals from conversations to build relationship intelligence:
- Identifies relationship types (reports-to, works-with, client-of, etc.)
- Detects relationship strength signals
- Tracks relationship dynamics over time
"""

import re
import time
from datetime import datetime
from typing import Any

import structlog

from ..state import (
    IntelligenceState,
    ExtractedRelationship,
    NodeTiming,
)

logger = structlog.get_logger()


# Relationship signal patterns
RELATIONSHIP_PATTERNS = {
    # Hierarchy patterns
    "reports_to": [
        r"(?:my|our)\s+(?:manager|boss|supervisor)\s+(\w+)",
        r"(?:reporting|report)\s+to\s+(\w+)",
        r"(\w+)\s+is\s+(?:my|our)\s+(?:manager|boss|lead)",
    ],
    "manages": [
        r"(?:my|our)\s+(?:team|direct reports?|reports?)",
        r"(?:I|we)\s+manage\s+(\w+)",
        r"(\w+)\s+(?:works|reports)\s+(?:for|under)\s+me",
    ],

    # Collaboration patterns
    "works_with": [
        r"(?:working|work|worked)\s+(?:closely\s+)?with\s+(\w+)",
        r"(?:collaborate|collaborating)\s+with\s+(\w+)",
        r"(\w+)\s+and\s+I\s+(?:are|have been)\s+working",
    ],

    # Client patterns
    "client_of": [
        r"(?:our|my)\s+(?:client|customer)\s+(\w+)",
        r"(\w+)\s+is\s+(?:a|our)\s+(?:client|customer)",
        r"(?:providing|provide)\s+(?:services?|products?)\s+to\s+(\w+)",
    ],

    # Influence patterns
    "influences": [
        r"(?:key|important)\s+(?:stakeholder|decision\s*maker)",
        r"(?:has|have)\s+(?:influence|authority|power)\s+over",
        r"(\w+)\s+(?:decides|approves|signs off)",
    ],
}

# Strength indicators
STRENGTH_INDICATORS = {
    "very_strong": [
        "close", "closely", "tight", "strong", "excellent",
        "best", "great", "longtime", "trusted", "key",
    ],
    "strong": [
        "good", "regular", "frequent", "solid", "established",
    ],
    "moderate": [
        "occasional", "sometimes", "periodic", "fair",
    ],
    "weak": [
        "rarely", "infrequent", "limited", "minimal", "new",
    ],
}

# Sentiment indicators
POSITIVE_INDICATORS = [
    "great", "excellent", "love", "appreciate", "wonderful",
    "fantastic", "amazing", "helpful", "supportive", "valuable",
]

NEGATIVE_INDICATORS = [
    "difficult", "challenging", "frustrated", "disappointed",
    "concerned", "worried", "issue", "problem", "strained",
]


async def extract_relationships_node(state: IntelligenceState) -> dict:
    """
    Extract relationship signals from the content.

    This node:
    1. Analyzes message content for relationship signals
    2. Identifies relationship types between entities
    3. Assesses relationship strength and sentiment
    4. Creates relationship edges for the graph

    Args:
        state: Current intelligence state

    Returns:
        State update with extracted relationships
    """
    start_time = time.time()

    logger.info(
        "Starting relationship extraction",
        analysis_id=state.analysis_id,
        contacts_count=len(state.extracted.contacts),
    )

    # Update trace
    state.trace.current_node = "extract_relationships"
    state.trace.nodes.append("extract_relationships")

    content = state.input.content
    contacts = state.extracted.contacts
    messages = state.messages

    if not content and not messages:
        logger.info("No content for relationship extraction")
        return _build_response(state, [], start_time)

    # Build contact lookup
    contact_lookup = {c.id: c for c in contacts}
    contact_names = {
        c.name.lower(): c.id
        for c in contacts
        if c.name
    }
    # Also map by email
    for c in contacts:
        if c.email:
            contact_names[c.email.lower()] = c.id

    relationships: list[ExtractedRelationship] = []

    # Extract from content
    if content:
        content_relationships = _extract_from_content(
            content, contact_lookup, contact_names
        )
        relationships.extend(content_relationships)

    # Extract from messages
    for message in messages:
        msg_content = message.content
        sender_id = None

        # Try to find sender in contacts
        if message.sender_email:
            sender_id = contact_names.get(message.sender_email.lower())
        if not sender_id and message.sender_name:
            sender_id = contact_names.get(message.sender_name.lower())

        if msg_content:
            msg_relationships = _extract_from_content(
                msg_content, contact_lookup, contact_names, sender_id
            )
            for rel in msg_relationships:
                rel.source_message_id = message.id
            relationships.extend(msg_relationships)

    # Use LLM for deeper analysis if available
    if content and len(contacts) >= 2:
        try:
            llm_relationships = await _extract_with_llm(content, contacts)
            relationships.extend(llm_relationships)
        except Exception as e:
            logger.warning("LLM relationship extraction failed", error=str(e))

    # Deduplicate relationships
    relationships = _deduplicate_relationships(relationships)

    logger.info(
        "Relationship extraction completed",
        analysis_id=state.analysis_id,
        relationships_found=len(relationships),
    )

    return _build_response(state, relationships, start_time)


def _build_response(
    state: IntelligenceState,
    relationships: list[ExtractedRelationship],
    start_time: float,
) -> dict:
    """Build the state update response."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    # Combine with existing relationships
    existing = [r for r in state.extracted.relationships]
    all_relationships = existing + relationships

    return {
        "extracted": {
            **state.extracted.model_dump(),
            "relationships": [r.model_dump() for r in all_relationships],
        },
        "trace": {
            **state.trace.model_dump(),
            "current_node": "extract_relationships",
            "node_timings": {
                **state.trace.node_timings,
                "extract_relationships": node_timing,
            },
        },
    }


def _extract_from_content(
    content: str,
    contact_lookup: dict[str, Any],
    contact_names: dict[str, str],
    sender_id: str | None = None,
) -> list[ExtractedRelationship]:
    """Extract relationships using pattern matching."""
    relationships = []
    content_lower = content.lower()

    for rel_type, patterns in RELATIONSHIP_PATTERNS.items():
        for pattern in patterns:
            matches = re.finditer(pattern, content_lower, re.IGNORECASE)
            for match in matches:
                # Try to identify the target entity
                target_name = match.group(1) if match.lastindex else None

                if target_name and target_name.lower() in contact_names:
                    target_id = contact_names[target_name.lower()]

                    # Determine source (sender or unknown)
                    source_id = sender_id or "unknown"

                    # Skip self-relationships
                    if source_id == target_id:
                        continue

                    # Assess strength
                    strength = _assess_strength(content_lower)

                    # Assess sentiment
                    sentiment = _assess_sentiment(content_lower)

                    # Extract evidence
                    start = max(0, match.start() - 50)
                    end = min(len(content), match.end() + 50)
                    evidence = content[start:end].strip()

                    relationships.append(
                        ExtractedRelationship(
                            source_contact_id=source_id,
                            target_contact_id=target_id,
                            relationship_type=rel_type,
                            strength=strength,
                            evidence_text=evidence,
                            sentiment=sentiment,
                            confidence=0.7,
                        )
                    )

    return relationships


async def _extract_with_llm(
    content: str,
    contacts: list[Any],
) -> list[ExtractedRelationship]:
    """Extract relationships using LLM analysis."""
    from src.llm.client import get_llm_client

    try:
        llm = await get_llm_client()

        contact_names = [c.name for c in contacts if c.name]
        contact_list = ", ".join(contact_names[:10])  # Limit to 10 contacts

        prompt = f"""Analyze this content for relationship signals between these people: {contact_list}

Content:
{content[:2000]}

For each relationship found, provide:
1. Source person (who is describing/has the relationship)
2. Target person (the other party)
3. Relationship type (reports_to, manages, works_with, collaborates_with, client_of, influences, knows)
4. Strength (very_strong, strong, moderate, weak)
5. Sentiment (positive, negative, neutral)
6. Evidence quote from the text

Return as JSON array of objects with keys: source, target, type, strength, sentiment, evidence

If no clear relationships are found, return an empty array [].
"""

        response = await llm.generate(prompt, max_tokens=1000)

        # Parse response
        import json
        try:
            # Find JSON in response
            json_start = response.find("[")
            json_end = response.rfind("]") + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
                parsed = json.loads(json_str)

                # Build contact name to ID mapping
                name_to_id = {
                    c.name.lower(): c.id
                    for c in contacts
                    if c.name
                }

                relationships = []
                for item in parsed:
                    source_name = item.get("source", "").lower()
                    target_name = item.get("target", "").lower()

                    source_id = name_to_id.get(source_name)
                    target_id = name_to_id.get(target_name)

                    if source_id and target_id and source_id != target_id:
                        rel_type_str = item.get("type", "knows").lower()
                        valid_types = [
                            "reports_to", "manages", "works_with", "collaborates_with",
                            "partners_with", "client_of", "vendor_to", "stakeholder_of",
                            "influences", "advises", "mentors", "knows", "introduced_by",
                            "referred_by"
                        ]
                        if rel_type_str not in valid_types:
                            rel_type_str = "knows"

                        strength_str = item.get("strength", "moderate").lower()
                        valid_strengths = ["very_strong", "strong", "moderate", "weak", "unknown"]
                        if strength_str not in valid_strengths:
                            strength_str = "moderate"

                        sentiment_str = item.get("sentiment", "neutral").lower()
                        if sentiment_str not in ["positive", "negative", "neutral"]:
                            sentiment_str = "neutral"

                        relationships.append(
                            ExtractedRelationship(
                                source_contact_id=source_id,
                                target_contact_id=target_id,
                                relationship_type=rel_type_str,
                                strength=strength_str,
                                evidence_text=item.get("evidence", ""),
                                sentiment=sentiment_str,
                                confidence=0.85,
                            )
                        )

                return relationships

        except json.JSONDecodeError:
            logger.debug("Could not parse LLM response as JSON")

    except Exception as e:
        logger.warning("LLM relationship extraction failed", error=str(e))

    return []


def _assess_strength(content: str) -> str:
    """Assess relationship strength from content."""
    content_lower = content.lower()

    for strength, indicators in STRENGTH_INDICATORS.items():
        for indicator in indicators:
            if indicator in content_lower:
                return strength

    return "moderate"


def _assess_sentiment(content: str) -> str:
    """Assess relationship sentiment from content."""
    content_lower = content.lower()

    positive_count = sum(1 for ind in POSITIVE_INDICATORS if ind in content_lower)
    negative_count = sum(1 for ind in NEGATIVE_INDICATORS if ind in content_lower)

    if positive_count > negative_count:
        return "positive"
    elif negative_count > positive_count:
        return "negative"
    return "neutral"


def _deduplicate_relationships(
    relationships: list[ExtractedRelationship],
) -> list[ExtractedRelationship]:
    """Remove duplicate relationships, keeping highest confidence."""
    seen: dict[tuple[str, str, str], ExtractedRelationship] = {}

    for rel in relationships:
        key = (rel.source_contact_id, rel.target_contact_id, rel.relationship_type)

        if key not in seen or rel.confidence > seen[key].confidence:
            seen[key] = rel

    return list(seen.values())
