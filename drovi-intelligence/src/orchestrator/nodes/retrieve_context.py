"""
Retrieve Context Node

Fetch recent and conversation-linked UIOs for memory-grounded extraction.
"""

import hashlib
import re
from collections import Counter

import structlog

from src.memory import get_memory_service
from src.orchestrator.state import IntelligenceState
from src.orchestrator.context_cache import get_context_cache
from src.search import get_hybrid_search
from src.memory.service import utc_now, MemoryService

logger = structlog.get_logger()

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "they", "them", "their",
    "are", "was", "were", "will", "would", "should", "could", "have", "has", "had",
    "about", "into", "over", "under", "your", "you", "our", "but", "not", "all",
    "can", "any", "may", "might", "also", "just", "than", "then", "there", "here",
}


def _build_query_text(state: IntelligenceState) -> str:
    parts: list[str] = []
    metadata = state.input.metadata or {}
    if isinstance(metadata, dict):
        subject = metadata.get("subject") or metadata.get("title")
        if subject:
            parts.append(str(subject))

    if state.messages:
        parts.append(" ".join(m.content for m in state.messages[:3] if m.content))
    elif state.input.content:
        parts.append(state.input.content)

    text = " ".join(part for part in parts if part).strip()
    if len(text) > 1200:
        text = text[:1200]
    return text


def _extract_topic_terms(text: str, limit: int = 8) -> list[str]:
    if not text:
        return []
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text.lower())
    counts = Counter(token for token in tokens if token not in STOPWORDS)
    return [term for term, _ in counts.most_common(limit)]


def _extract_participants(state: IntelligenceState) -> set[str]:
    participants: set[str] = set()
    if state.input.user_email:
        participants.add(state.input.user_email.lower())
    for msg in state.messages or []:
        if msg.sender_email:
            participants.add(msg.sender_email.lower())

    metadata = state.input.metadata or {}
    attendees = metadata.get("attendees") or metadata.get("participants") or []
    if isinstance(attendees, list):
        for attendee in attendees:
            if isinstance(attendee, str):
                participants.add(attendee.lower())
            elif isinstance(attendee, dict):
                email = attendee.get("email") or attendee.get("address")
                if email:
                    participants.add(str(email).lower())

    return participants


def _make_cache_key(state: IntelligenceState, query_text: str) -> str | None:
    if not state.input.conversation_id:
        return None
    seed_parts = [state.input.conversation_id]
    if state.input.message_ids:
        seed_parts.extend(state.input.message_ids)
    elif state.input.source_id:
        seed_parts.append(state.input.source_id)
    else:
        seed_parts.append(query_text[:200])
    digest = hashlib.sha256("|".join(seed_parts).encode("utf-8")).hexdigest()
    return f"drovi:context:{state.input.organization_id}:{digest}"


def _normalize_properties(raw: dict) -> dict:
    if "properties" in raw and isinstance(raw["properties"], dict):
        return raw["properties"]
    return raw


def _build_uio_item(
    properties: dict,
    uio_id: str | None,
    uio_type: str | None,
    base_score: float,
) -> dict:
    updated_at = properties.get("updatedAt") or properties.get("lastUpdatedAt") or properties.get("last_updated_at")
    title = (
        properties.get("title")
        or properties.get("canonical_title")
        or properties.get("canonicalTitle")
        or properties.get("name")
    )
    description = (
        properties.get("description")
        or properties.get("canonical_description")
        or properties.get("canonicalDescription")
        or properties.get("summary")
        or properties.get("statement")
        or properties.get("rationale")
    )
    return {
        "id": uio_id,
        "type": uio_type,
        "status": properties.get("status"),
        "title": title,
        "description": description,
        "owner": properties.get("owner") or properties.get("debtorEmail") or properties.get("assigneeEmail"),
        "last_updated_at": updated_at,
        "updated_at": updated_at,
        "created_at": properties.get("createdAt") or properties.get("created_at"),
        "valid_from": properties.get("validFrom") or properties.get("valid_from"),
        "valid_to": properties.get("validTo") or properties.get("valid_to"),
        "system_from": properties.get("systemFrom") or properties.get("system_from"),
        "system_to": properties.get("systemTo") or properties.get("system_to"),
        "base_score": base_score,
    }


def _score_item(item: dict, topic_terms: list[str], participants: set[str]) -> float:
    bonus = 0.0
    text = f"{item.get('title') or ''} {item.get('description') or ''}".lower()
    if topic_terms and any(term in text for term in topic_terms):
        bonus += 0.15

    owner = item.get("owner")
    if owner and isinstance(owner, str):
        if owner.lower() in participants:
            bonus += 0.2

    base = item.get("base_score") or 0.2
    decay = item.get("decay_score", 1.0)
    return (base + bonus) * decay


async def retrieve_context_node(state: IntelligenceState) -> dict:
    """
    Retrieve recent UIOs and conversation-linked UIOs for context grounding.
    """
    logger.info(
        "Retrieving memory context",
        analysis_id=state.analysis_id,
        organization_id=state.input.organization_id,
    )

    state.trace.current_node = "retrieve_context"
    state.trace.nodes.append("retrieve_context")

    memory = await get_memory_service(state.input.organization_id)
    query_text = _build_query_text(state)
    cache_key = _make_cache_key(state, query_text)
    cache = await get_context_cache()

    if cache_key:
        cached = await cache.get(cache_key)
        if cached:
            logger.info("Memory context cache hit", cache_key=cache_key)
            return {"memory_context": cached}

    topic_terms = _extract_topic_terms(query_text)
    participants = _extract_participants(state)
    search_query = " ".join(topic_terms) if topic_terms else query_text

    hybrid_search = await get_hybrid_search()
    hybrid_results = await hybrid_search.search(
        query=search_query,
        organization_id=state.input.organization_id,
        types=["Commitment", "Decision", "Task", "Risk", "Claim"],
        limit=25,
    )

    temporal_results = await memory.search_uios_as_of(
        query=search_query,
        as_of_date=utc_now(),
        uio_types=["commitment", "decision", "task", "risk", "claim"],
        limit=25,
    )

    items: dict[str, dict] = {}

    for result in hybrid_results:
        properties = _normalize_properties(result.get("properties", result))
        uio_id = result.get("id") or properties.get("id")
        if not uio_id:
            continue
        item = _build_uio_item(properties, uio_id, result.get("type"), result.get("score", 0.2))
        items[uio_id] = item

    for result in temporal_results or []:
        node = result.get("u") if isinstance(result, dict) else result
        properties = _normalize_properties(node if isinstance(node, dict) else {})
        uio_id = properties.get("id") or result.get("id")
        if not uio_id:
            continue
        uio_type = properties.get("type")
        item = _build_uio_item(properties, uio_id, uio_type, 0.25)
        if uio_id in items:
            items[uio_id]["base_score"] = max(items[uio_id]["base_score"], item["base_score"])
            continue
        items[uio_id] = item

    combined = list(items.values())
    combined = MemoryService.apply_temporal_decay(combined, half_life_days=45)
    for item in combined:
        item["relevance_score"] = _score_item(item, topic_terms, participants)

    combined.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
    relevant_uios = [item for item in combined if item.get("id")][:10]

    conversation_uios = []
    if state.input.conversation_id:
        conversation_uios = await memory.get_conversation_uios(
            conversation_id=state.input.conversation_id,
            limit=10,
        )

    memory_context = {
        "recent_uios": relevant_uios,
        "conversation_uios": conversation_uios,
        "context_terms": topic_terms,
        "context_query": search_query[:200],
    }

    if cache_key:
        await cache.set(cache_key, memory_context)

    return {"memory_context": memory_context}
