"""
Retrieve Context Node

Fetch recent and conversation-linked UIOs for memory-grounded extraction.
"""

import hashlib
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime

import structlog

from src.config import get_settings
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


@dataclass
class ContextBudget:
    max_recent_uios: int
    max_conversation_uios: int
    max_total_uios: int
    hybrid_limit: int
    temporal_limit: int
    evidence_limit: int
    half_life_days: int
    min_relevance: float
    stale_days: int
    decay_threshold: float
    cache_ttl_seconds: int

    def to_dict(self) -> dict:
        return {
            "max_recent_uios": self.max_recent_uios,
            "max_conversation_uios": self.max_conversation_uios,
            "max_total_uios": self.max_total_uios,
            "hybrid_limit": self.hybrid_limit,
            "temporal_limit": self.temporal_limit,
            "evidence_limit": self.evidence_limit,
            "half_life_days": self.half_life_days,
            "min_relevance": self.min_relevance,
            "stale_days": self.stale_days,
            "decay_threshold": self.decay_threshold,
            "cache_ttl_seconds": self.cache_ttl_seconds,
        }


def _resolve_budget(metadata: dict | None, context_budget: dict | None) -> ContextBudget:
    settings = get_settings()
    overrides = {}
    if isinstance(context_budget, dict):
        overrides.update(context_budget)
    if isinstance(metadata, dict):
        overrides.update(metadata.get("context_budget") or metadata.get("contextBudget") or {})

    def _pick(key: str, default):
        return overrides.get(key, default)

    max_recent = int(_pick("max_recent_uios", settings.context_budget_recent_limit))
    max_conversation = int(_pick("max_conversation_uios", settings.context_budget_conversation_limit))
    max_total = _pick("max_total_uios", settings.context_budget_total_limit)
    max_total = int(max_total) if max_total is not None else max_recent + max_conversation

    return ContextBudget(
        max_recent_uios=max_recent,
        max_conversation_uios=max_conversation,
        max_total_uios=max_total,
        hybrid_limit=int(_pick("hybrid_limit", settings.context_budget_hybrid_limit)),
        temporal_limit=int(_pick("temporal_limit", settings.context_budget_temporal_limit)),
        evidence_limit=int(_pick("evidence_limit", settings.context_budget_evidence_limit)),
        half_life_days=int(_pick("half_life_days", settings.context_budget_half_life_days)),
        min_relevance=float(_pick("min_relevance", settings.context_budget_min_relevance)),
        stale_days=int(_pick("stale_days", settings.context_budget_stale_days)),
        decay_threshold=float(_pick("decay_threshold", settings.context_budget_decay_threshold)),
        cache_ttl_seconds=int(_pick("cache_ttl_seconds", settings.context_budget_cache_ttl_seconds)),
    )


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


def _make_cache_key(
    state: IntelligenceState,
    query_text: str,
    context_version: str | None,
    budget: ContextBudget,
) -> str | None:
    org_id = state.input.organization_id
    conversation_id = state.input.conversation_id
    if not conversation_id:
        conversation_id = "org"
    seed_parts = [conversation_id]
    if state.input.message_ids:
        seed_parts.extend(state.input.message_ids)
    elif state.input.source_id:
        seed_parts.append(state.input.source_id)
    else:
        seed_parts.append(query_text[:200])
    seed_parts.append(context_version or "noversion")
    seed_parts.append(str(budget.max_recent_uios))
    seed_parts.append(str(budget.max_conversation_uios))
    seed_parts.append(str(budget.max_total_uios))
    seed_parts.append(str(budget.half_life_days))
    digest = hashlib.sha256("|".join(seed_parts).encode("utf-8")).hexdigest()
    return f"drovi:context:{org_id}:{conversation_id}:{digest}"


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


def _parse_datetime(value: str | datetime | None) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def _is_drifted(item: dict, now: datetime, stale_days: int, decay_threshold: float) -> bool:
    valid_to = _parse_datetime(item.get("valid_to") or item.get("validTo"))
    system_to = _parse_datetime(item.get("system_to") or item.get("systemTo"))
    if valid_to and valid_to <= now:
        return True
    if system_to and system_to <= now:
        return True

    last_updated = _parse_datetime(item.get("last_updated_at") or item.get("updated_at"))
    if last_updated:
        age_days = max((now - last_updated).days, 0)
        if age_days >= stale_days:
            return True

    status = (item.get("status") or "").lower()
    if status in {"completed", "cancelled", "superseded", "archived"} and last_updated:
        age_days = max((now - last_updated).days, 0)
        if age_days >= max(30, stale_days // 2):
            return True

    decay_score = item.get("decay_score", 1.0)
    return decay_score < decay_threshold


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
    return (base * decay) + bonus


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
    budget = _resolve_budget(state.input.metadata, state.input.context_budget)
    query_text = _build_query_text(state)
    context_version = await memory.get_context_version(state.input.conversation_id)
    cache_key = _make_cache_key(state, query_text, context_version, budget)
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
        limit=budget.hybrid_limit,
    )

    temporal_results = await memory.search_uios_as_of(
        query=search_query,
        as_of_date=utc_now(),
        uio_types=["commitment", "decision", "task", "risk", "claim"],
        limit=budget.temporal_limit,
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
    now = utc_now()
    combined = MemoryService.apply_temporal_decay(combined, half_life_days=budget.half_life_days)
    for item in combined:
        item["relevance_score"] = _score_item(item, topic_terms, participants)

    combined = [
        item
        for item in combined
        if item.get("id")
        and item.get("relevance_score", 0) >= budget.min_relevance
        and not _is_drifted(item, now, budget.stale_days, budget.decay_threshold)
    ]
    combined.sort(key=lambda x: x.get("relevance_score", 0), reverse=True)
    relevant_uios = combined[:budget.max_recent_uios]

    conversation_uios = []
    if state.input.conversation_id:
        conversation_uios = await memory.get_conversation_uios(
            conversation_id=state.input.conversation_id,
            limit=budget.max_conversation_uios,
        )

    if budget.max_total_uios:
        remaining = max(budget.max_total_uios - len(conversation_uios), 0)
        if remaining < len(relevant_uios):
            relevant_uios = relevant_uios[:remaining]

    selected_ids = [item["id"] for item in relevant_uios if item.get("id")]
    evidence_map = {}
    if budget.evidence_limit > 0 and selected_ids:
        evidence_map = await memory.get_uio_evidence(
            selected_ids,
            limit_per_uio=budget.evidence_limit,
        )
    evidence_summaries = [
        {
            "uio_id": item["id"],
            "title": item.get("title"),
            "evidence": evidence_map.get(item["id"], []),
        }
        for item in relevant_uios
    ]

    memory_context = {
        "recent_uios": relevant_uios,
        "conversation_uios": conversation_uios,
        "context_terms": topic_terms,
        "context_query": search_query[:200],
        "context_version": context_version,
        "context_budget": budget.to_dict(),
        "evidence_summaries": evidence_summaries,
    }

    if cache_key:
        await cache.set(cache_key, memory_context, ttl_seconds=budget.cache_ttl_seconds)

    return {"memory_context": memory_context}
