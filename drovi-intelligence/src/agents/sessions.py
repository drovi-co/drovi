"""
Agent Session Manager

Manages agent sessions with context persistence using Redis.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
import json
import uuid

import structlog

from src.agents.context import AgentContext, ContextEntry, ContextType

logger = structlog.get_logger()

# Singleton instance
_session_manager: "SessionManager | None" = None


@dataclass
class AgentSession:
    """
    An agent session with accumulated context.

    Sessions maintain context across multiple interactions,
    enabling agents to have continuity in conversations.
    """

    session_id: str
    organization_id: str
    agent_id: str | None  # Identifier for the agent (e.g., MCP client ID)
    context: AgentContext
    created_at: datetime
    last_activity: datetime
    metadata: dict[str, Any] = field(default_factory=dict)

    # Session configuration
    ttl_hours: int = 24  # Session expires after this many hours of inactivity

    @property
    def is_expired(self) -> bool:
        """Check if session has expired."""
        expiry = self.last_activity + timedelta(hours=self.ttl_hours)
        return datetime.utcnow() > expiry

    def touch(self) -> None:
        """Update last activity timestamp."""
        self.last_activity = datetime.utcnow()

    def add_interaction(
        self,
        query: str,
        response: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[ContextEntry, ContextEntry]:
        """Add a query/response interaction to the session."""
        self.touch()
        query_entry = self.context.add_query(query, metadata)
        response_entry = self.context.add_response(response, query_entry.entry_id)
        return query_entry, response_entry

    def to_dict(self) -> dict[str, Any]:
        """Serialize session to dictionary."""
        return {
            "session_id": self.session_id,
            "organization_id": self.organization_id,
            "agent_id": self.agent_id,
            "context": self.context.to_dict(),
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "metadata": self.metadata,
            "ttl_hours": self.ttl_hours,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentSession":
        """Deserialize session from dictionary."""
        return cls(
            session_id=data["session_id"],
            organization_id=data["organization_id"],
            agent_id=data.get("agent_id"),
            context=AgentContext.from_dict(data.get("context", {})),
            created_at=datetime.fromisoformat(data["created_at"]),
            last_activity=datetime.fromisoformat(data["last_activity"]),
            metadata=data.get("metadata", {}),
            ttl_hours=data.get("ttl_hours", 24),
        )

    @classmethod
    def create(
        cls,
        organization_id: str,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "AgentSession":
        """Create a new session."""
        now = datetime.utcnow()
        return cls(
            session_id=str(uuid.uuid4()),
            organization_id=organization_id,
            agent_id=agent_id,
            context=AgentContext(),
            created_at=now,
            last_activity=now,
            metadata=metadata or {},
        )


class SessionManager:
    """
    Manages agent sessions with Redis persistence.

    Supports:
    - Session creation and retrieval
    - Context persistence across requests
    - Automatic session expiration
    - Session resumption
    """

    def __init__(self, redis_url: str | None = None):
        """Initialize session manager."""
        self._redis_url = redis_url
        self._redis = None
        self._connected = False
        self._prefix = "drovi:sessions:"

    async def connect(self) -> None:
        """Connect to Redis."""
        if self._connected:
            return

        try:
            import redis.asyncio as redis

            if not self._redis_url:
                from src.config import get_settings
                settings = get_settings()
                self._redis_url = getattr(settings, 'redis_url', 'redis://localhost:6379/0')

            self._redis = redis.from_url(self._redis_url)
            await self._redis.ping()
            self._connected = True
            logger.info("Session manager connected to Redis")

        except ImportError:
            logger.warning("redis package not installed, using in-memory sessions")
            self._sessions: dict[str, AgentSession] = {}
        except Exception as e:
            logger.error("Failed to connect to Redis", error=str(e))
            self._sessions: dict[str, AgentSession] = {}

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self._redis:
            await self._redis.close()
            self._redis = None
            self._connected = False

    def _get_key(self, session_id: str) -> str:
        """Get Redis key for a session."""
        return f"{self._prefix}{session_id}"

    def _get_org_key(self, organization_id: str) -> str:
        """Get Redis key for organization's session index."""
        return f"{self._prefix}org:{organization_id}"

    async def create_session(
        self,
        organization_id: str,
        agent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentSession:
        """
        Create a new agent session.

        Args:
            organization_id: Organization ID
            agent_id: Optional agent identifier
            metadata: Optional session metadata

        Returns:
            New AgentSession instance
        """
        await self.connect()

        session = AgentSession.create(
            organization_id=organization_id,
            agent_id=agent_id,
            metadata=metadata,
        )

        await self._save_session(session)

        logger.info(
            "Created agent session",
            session_id=session.session_id,
            organization_id=organization_id,
            agent_id=agent_id,
        )

        return session

    async def get_session(self, session_id: str) -> AgentSession | None:
        """
        Get a session by ID.

        Args:
            session_id: Session ID

        Returns:
            AgentSession if found and not expired, None otherwise
        """
        await self.connect()

        if self._redis:
            key = self._get_key(session_id)
            data = await self._redis.get(key)
            if data:
                session = AgentSession.from_dict(json.loads(data))
                if session.is_expired:
                    await self.delete_session(session_id)
                    return None
                return session
        else:
            session = self._sessions.get(session_id)
            if session and session.is_expired:
                del self._sessions[session_id]
                return None
            return session

        return None

    async def get_or_create_session(
        self,
        session_id: str | None,
        organization_id: str,
        agent_id: str | None = None,
    ) -> AgentSession:
        """
        Get an existing session or create a new one.

        Args:
            session_id: Optional existing session ID
            organization_id: Organization ID (required for new sessions)
            agent_id: Optional agent identifier

        Returns:
            AgentSession instance
        """
        if session_id:
            session = await self.get_session(session_id)
            if session:
                session.touch()
                await self._save_session(session)
                return session

        return await self.create_session(organization_id, agent_id)

    async def update_session(self, session: AgentSession) -> None:
        """
        Update a session.

        Args:
            session: Session to update
        """
        session.touch()
        await self._save_session(session)

    async def delete_session(self, session_id: str) -> bool:
        """
        Delete a session.

        Args:
            session_id: Session ID to delete

        Returns:
            True if deleted, False if not found
        """
        await self.connect()

        if self._redis:
            key = self._get_key(session_id)
            deleted = await self._redis.delete(key)
            return deleted > 0
        else:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    async def list_sessions(
        self,
        organization_id: str,
        include_expired: bool = False,
    ) -> list[AgentSession]:
        """
        List sessions for an organization.

        Args:
            organization_id: Organization ID
            include_expired: Include expired sessions

        Returns:
            List of sessions
        """
        await self.connect()

        sessions = []

        if self._redis:
            # Use pattern matching (less efficient but simpler)
            pattern = f"{self._prefix}*"
            cursor = 0
            while True:
                cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                for key in keys:
                    data = await self._redis.get(key)
                    if data:
                        session = AgentSession.from_dict(json.loads(data))
                        if session.organization_id == organization_id:
                            if include_expired or not session.is_expired:
                                sessions.append(session)
                if cursor == 0:
                    break
        else:
            for session in self._sessions.values():
                if session.organization_id == organization_id:
                    if include_expired or not session.is_expired:
                        sessions.append(session)

        return sessions

    async def cleanup_expired(self) -> int:
        """
        Clean up expired sessions.

        Returns:
            Number of sessions cleaned up
        """
        await self.connect()

        cleaned = 0

        if self._redis:
            pattern = f"{self._prefix}*"
            cursor = 0
            while True:
                cursor, keys = await self._redis.scan(cursor, match=pattern, count=100)
                for key in keys:
                    data = await self._redis.get(key)
                    if data:
                        session = AgentSession.from_dict(json.loads(data))
                        if session.is_expired:
                            await self._redis.delete(key)
                            cleaned += 1
                if cursor == 0:
                    break
        else:
            expired_ids = [
                sid for sid, session in self._sessions.items()
                if session.is_expired
            ]
            for sid in expired_ids:
                del self._sessions[sid]
            cleaned = len(expired_ids)

        if cleaned > 0:
            logger.info("Cleaned up expired sessions", count=cleaned)

        return cleaned

    async def _save_session(self, session: AgentSession) -> None:
        """Save session to storage."""
        if self._redis:
            key = self._get_key(session.session_id)
            ttl_seconds = session.ttl_hours * 3600
            await self._redis.setex(
                key,
                ttl_seconds,
                json.dumps(session.to_dict()),
            )
        else:
            self._sessions[session.session_id] = session

    async def add_query_to_session(
        self,
        session_id: str,
        query: str,
        metadata: dict[str, Any] | None = None,
    ) -> ContextEntry | None:
        """
        Add a query to a session's context.

        Args:
            session_id: Session ID
            query: Query text
            metadata: Optional metadata

        Returns:
            ContextEntry if successful
        """
        session = await self.get_session(session_id)
        if not session:
            return None

        entry = session.context.add_query(query, metadata)
        await self.update_session(session)
        return entry

    async def add_response_to_session(
        self,
        session_id: str,
        response: str,
        query_id: str | None = None,
    ) -> ContextEntry | None:
        """
        Add a response to a session's context.

        Args:
            session_id: Session ID
            response: Response text
            query_id: Optional query ID this responds to

        Returns:
            ContextEntry if successful
        """
        session = await self.get_session(session_id)
        if not session:
            return None

        entry = session.context.add_response(response, query_id)
        await self.update_session(session)
        return entry

    async def get_session_context_summary(
        self,
        session_id: str,
    ) -> dict[str, Any] | None:
        """
        Get a summary of a session's context.

        Args:
            session_id: Session ID

        Returns:
            Context summary dict or None
        """
        session = await self.get_session(session_id)
        if not session:
            return None

        return {
            "session_id": session.session_id,
            "organization_id": session.organization_id,
            "agent_id": session.agent_id,
            "created_at": session.created_at.isoformat(),
            "last_activity": session.last_activity.isoformat(),
            "context": session.context.get_context_summary(),
        }


async def get_session_manager() -> SessionManager:
    """Get or create the singleton session manager."""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
        await _session_manager.connect()
    return _session_manager
