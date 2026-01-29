"""
Agent Context

Defines context types and structures for agent sessions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import json
import uuid


class ContextType(str, Enum):
    """Types of context entries."""

    # Query context
    QUERY = "query"                  # User/agent query
    RESPONSE = "response"            # System response
    SEARCH_RESULTS = "search_results"  # Search results returned

    # Entity context
    ENTITY_VIEWED = "entity_viewed"  # Entity was viewed
    ENTITY_MENTIONED = "entity_mentioned"  # Entity was mentioned

    # UIO context
    UIO_VIEWED = "uio_viewed"        # UIO was viewed
    UIO_MENTIONED = "uio_mentioned"  # UIO was mentioned

    # Thread/conversation context
    THREAD_VIEWED = "thread_viewed"  # Email thread was viewed
    THREAD_MENTIONED = "thread_mentioned"

    # Action context
    ACTION_TAKEN = "action_taken"    # Agent took an action
    ACTION_SUGGESTED = "action_suggested"  # Action was suggested

    # Preference context
    PREFERENCE_EXPRESSED = "preference_expressed"  # User expressed preference
    FEEDBACK_GIVEN = "feedback_given"  # User gave feedback

    # System context
    SYSTEM_NOTE = "system_note"      # System-generated note


@dataclass
class ContextEntry:
    """A single entry in the agent's context."""

    entry_id: str
    context_type: ContextType
    content: dict[str, Any]
    timestamp: datetime
    relevance_score: float = 1.0  # Decays over time/turns
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "entry_id": self.entry_id,
            "context_type": self.context_type.value,
            "content": self.content,
            "timestamp": self.timestamp.isoformat(),
            "relevance_score": self.relevance_score,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ContextEntry":
        """Create from dictionary."""
        return cls(
            entry_id=data["entry_id"],
            context_type=ContextType(data["context_type"]),
            content=data["content"],
            timestamp=datetime.fromisoformat(data["timestamp"]),
            relevance_score=data.get("relevance_score", 1.0),
            metadata=data.get("metadata", {}),
        )

    @classmethod
    def create(
        cls,
        context_type: ContextType,
        content: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> "ContextEntry":
        """Create a new context entry."""
        return cls(
            entry_id=str(uuid.uuid4()),
            context_type=context_type,
            content=content,
            timestamp=datetime.utcnow(),
            metadata=metadata or {},
        )


@dataclass
class AgentContext:
    """
    Accumulated context for an agent session.

    Maintains a sliding window of context entries with relevance decay.
    """

    entries: list[ContextEntry] = field(default_factory=list)
    max_entries: int = 100
    relevance_threshold: float = 0.1

    # Tracked entities and UIOs for quick reference
    mentioned_entities: dict[str, int] = field(default_factory=dict)  # entity_id -> mention count
    mentioned_uios: dict[str, int] = field(default_factory=dict)  # uio_id -> mention count
    viewed_threads: list[str] = field(default_factory=list)  # thread_ids in order viewed

    def add_entry(self, entry: ContextEntry) -> None:
        """Add a new context entry."""
        self.entries.append(entry)

        # Update tracking
        self._update_tracking(entry)

        # Decay older entries
        self._apply_decay()

        # Prune if over limit
        self._prune_entries()

    def add_query(self, query: str, metadata: dict[str, Any] | None = None) -> ContextEntry:
        """Add a query to context."""
        entry = ContextEntry.create(
            context_type=ContextType.QUERY,
            content={"query": query},
            metadata=metadata,
        )
        self.add_entry(entry)
        return entry

    def add_response(
        self,
        response: str,
        query_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ContextEntry:
        """Add a response to context."""
        entry = ContextEntry.create(
            context_type=ContextType.RESPONSE,
            content={"response": response, "query_id": query_id},
            metadata=metadata,
        )
        self.add_entry(entry)
        return entry

    def add_search_results(
        self,
        results: list[dict[str, Any]],
        query: str,
    ) -> ContextEntry:
        """Add search results to context."""
        entry = ContextEntry.create(
            context_type=ContextType.SEARCH_RESULTS,
            content={
                "query": query,
                "result_count": len(results),
                "result_ids": [r.get("id") for r in results[:10]],  # Store top 10 IDs
            },
        )
        self.add_entry(entry)
        return entry

    def add_entity_view(
        self,
        entity_id: str,
        entity_type: str,
        entity_name: str | None = None,
    ) -> ContextEntry:
        """Record that an entity was viewed."""
        entry = ContextEntry.create(
            context_type=ContextType.ENTITY_VIEWED,
            content={
                "entity_id": entity_id,
                "entity_type": entity_type,
                "entity_name": entity_name,
            },
        )
        self.add_entry(entry)
        return entry

    def add_uio_view(
        self,
        uio_id: str,
        uio_type: str,
        summary: str | None = None,
    ) -> ContextEntry:
        """Record that a UIO was viewed."""
        entry = ContextEntry.create(
            context_type=ContextType.UIO_VIEWED,
            content={
                "uio_id": uio_id,
                "uio_type": uio_type,
                "summary": summary,
            },
        )
        self.add_entry(entry)
        return entry

    def add_thread_view(self, thread_id: str, subject: str | None = None) -> ContextEntry:
        """Record that a thread was viewed."""
        entry = ContextEntry.create(
            context_type=ContextType.THREAD_VIEWED,
            content={"thread_id": thread_id, "subject": subject},
        )
        self.add_entry(entry)
        return entry

    def add_action(
        self,
        action_type: str,
        action_details: dict[str, Any],
        suggested: bool = False,
    ) -> ContextEntry:
        """Record an action taken or suggested."""
        context_type = ContextType.ACTION_SUGGESTED if suggested else ContextType.ACTION_TAKEN
        entry = ContextEntry.create(
            context_type=context_type,
            content={"action_type": action_type, "details": action_details},
        )
        self.add_entry(entry)
        return entry

    def add_feedback(
        self,
        feedback_type: str,
        feedback_value: Any,
        target_id: str | None = None,
    ) -> ContextEntry:
        """Record user feedback."""
        entry = ContextEntry.create(
            context_type=ContextType.FEEDBACK_GIVEN,
            content={
                "feedback_type": feedback_type,
                "value": feedback_value,
                "target_id": target_id,
            },
        )
        self.add_entry(entry)
        return entry

    def _update_tracking(self, entry: ContextEntry) -> None:
        """Update entity/UIO tracking based on entry."""
        content = entry.content

        if entry.context_type in (ContextType.ENTITY_VIEWED, ContextType.ENTITY_MENTIONED):
            entity_id = content.get("entity_id")
            if entity_id:
                self.mentioned_entities[entity_id] = self.mentioned_entities.get(entity_id, 0) + 1

        if entry.context_type in (ContextType.UIO_VIEWED, ContextType.UIO_MENTIONED):
            uio_id = content.get("uio_id")
            if uio_id:
                self.mentioned_uios[uio_id] = self.mentioned_uios.get(uio_id, 0) + 1

        if entry.context_type == ContextType.THREAD_VIEWED:
            thread_id = content.get("thread_id")
            if thread_id and thread_id not in self.viewed_threads:
                self.viewed_threads.append(thread_id)

    def _apply_decay(self, decay_rate: float = 0.95) -> None:
        """Apply relevance decay to older entries."""
        for entry in self.entries[:-1]:  # All but the newest
            entry.relevance_score *= decay_rate

    def _prune_entries(self) -> None:
        """Remove entries below relevance threshold or over limit."""
        # Remove low relevance
        self.entries = [
            e for e in self.entries
            if e.relevance_score >= self.relevance_threshold
        ]

        # Remove oldest if over limit
        if len(self.entries) > self.max_entries:
            self.entries = self.entries[-self.max_entries:]

    def get_recent_queries(self, limit: int = 5) -> list[str]:
        """Get recent queries."""
        queries = [
            e.content.get("query", "")
            for e in reversed(self.entries)
            if e.context_type == ContextType.QUERY
        ]
        return queries[:limit]

    def get_recent_entities(self, limit: int = 10) -> list[str]:
        """Get recently mentioned/viewed entity IDs."""
        # Sort by mention count
        sorted_entities = sorted(
            self.mentioned_entities.items(),
            key=lambda x: x[1],
            reverse=True,
        )
        return [eid for eid, _ in sorted_entities[:limit]]

    def get_recent_uios(self, limit: int = 10) -> list[str]:
        """Get recently mentioned/viewed UIO IDs."""
        sorted_uios = sorted(
            self.mentioned_uios.items(),
            key=lambda x: x[1],
            reverse=True,
        )
        return [uid for uid, _ in sorted_uios[:limit]]

    def get_context_summary(self) -> dict[str, Any]:
        """Get a summary of the current context."""
        return {
            "entry_count": len(self.entries),
            "recent_queries": self.get_recent_queries(3),
            "top_entities": self.get_recent_entities(5),
            "top_uios": self.get_recent_uios(5),
            "viewed_threads": self.viewed_threads[-5:],
            "oldest_entry": self.entries[0].timestamp.isoformat() if self.entries else None,
            "newest_entry": self.entries[-1].timestamp.isoformat() if self.entries else None,
        }

    def to_dict(self) -> dict[str, Any]:
        """Serialize context to dictionary."""
        return {
            "entries": [e.to_dict() for e in self.entries],
            "mentioned_entities": self.mentioned_entities,
            "mentioned_uios": self.mentioned_uios,
            "viewed_threads": self.viewed_threads,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentContext":
        """Deserialize context from dictionary."""
        context = cls()
        context.entries = [ContextEntry.from_dict(e) for e in data.get("entries", [])]
        context.mentioned_entities = data.get("mentioned_entities", {})
        context.mentioned_uios = data.get("mentioned_uios", {})
        context.viewed_threads = data.get("viewed_threads", [])
        return context

    def to_json(self) -> str:
        """Serialize to JSON."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> "AgentContext":
        """Deserialize from JSON."""
        return cls.from_dict(json.loads(json_str))
