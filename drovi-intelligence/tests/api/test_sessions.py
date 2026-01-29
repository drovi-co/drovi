"""
API tests for Sessions endpoints.

Tests the agent session management and context accumulation APIs.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timedelta

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def make_mock_session(
    session_id: str = "session_123",
    organization_id: str = "org_test",
    agent_id: str | None = "claude_1",
    ttl_hours: int = 24,
    is_expired: bool = False,
) -> MagicMock:
    """Create a mock AgentSession object."""
    session = MagicMock()
    session.session_id = session_id
    session.organization_id = organization_id
    session.agent_id = agent_id
    session.created_at = datetime.utcnow()
    session.last_activity = datetime.utcnow()
    session.ttl_hours = ttl_hours
    session.is_expired = is_expired
    session.metadata = {}

    # Mock context with get_context_summary method
    mock_context = MagicMock()
    mock_context.get_context_summary.return_value = {
        "entry_count": 5,
        "recent_queries": ["test query"],
        "top_entities": ["contact_1"],
    }
    mock_context.to_dict.return_value = {
        "entries": [],
        "mentioned_entities": {},
        "viewed_threads": [],
    }
    session.context = mock_context

    # Mock add_interaction method
    query_entry = MagicMock()
    query_entry.entry_id = "entry_q_1"
    query_entry.context_type = MagicMock(value="query")
    query_entry.timestamp = datetime.utcnow()

    response_entry = MagicMock()
    response_entry.entry_id = "entry_r_1"
    response_entry.context_type = MagicMock(value="response")
    response_entry.timestamp = datetime.utcnow()

    session.add_interaction.return_value = (query_entry, response_entry)

    return session


class TestContextTypesEndpoint:
    """Tests for GET /sessions/context-types."""

    async def test_list_context_types(self, async_client):
        """Test listing all context types."""
        response = await async_client.get("/api/v1/sessions/context-types")

        assert response.status_code == 200
        data = response.json()

        assert "context_types" in data
        assert len(data["context_types"]) > 0

        # Check expected types exist
        type_names = [t["name"] for t in data["context_types"]]
        assert "query" in type_names

    async def test_context_types_have_descriptions(self, async_client):
        """Test context types include descriptions."""
        response = await async_client.get("/api/v1/sessions/context-types")
        data = response.json()

        for ctx_type in data["context_types"]:
            assert "name" in ctx_type
            assert "description" in ctx_type


class TestCreateSessionEndpoint:
    """Tests for POST /sessions."""

    async def test_create_session_success(self, async_client, factory):
        """Test creating a new session successfully."""
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id="session_123",
                organization_id=org_id,
                agent_id="claude_1",
            )
            mock_manager.create_session.return_value = mock_session
            mock_manager.update_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.post(
                "/api/v1/sessions",
                json={
                    "organization_id": org_id,
                    "agent_id": "claude_1",
                    "metadata": {"purpose": "test"},
                },
            )

            assert response.status_code == 201
            data = response.json()

            assert "session_id" in data
            assert data["session_id"] == "session_123"
            assert data["organization_id"] == org_id

    async def test_create_session_minimal(self, async_client, factory):
        """Test creating session with minimal fields."""
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id="session_456",
                organization_id=org_id,
                agent_id=None,
            )
            mock_manager.create_session.return_value = mock_session
            mock_get.return_value = mock_manager

            response = await async_client.post(
                "/api/v1/sessions",
                json={
                    "organization_id": org_id,
                },
            )

            assert response.status_code == 201

    async def test_create_session_requires_org_id(self, async_client):
        """Test session creation requires organization_id."""
        response = await async_client.post(
            "/api/v1/sessions",
            json={"agent_id": "claude_1"},
        )

        assert response.status_code == 422  # Validation error


class TestGetSessionEndpoint:
    """Tests for GET /sessions/{session_id}."""

    async def test_get_session_success(self, async_client, factory):
        """Test getting session details."""
        session_id = "session_test_123"
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id=session_id,
                organization_id=org_id,
                agent_id="claude_1",
            )
            mock_manager.get_session.return_value = mock_session
            mock_manager.update_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.get(f"/api/v1/sessions/{session_id}")

            assert response.status_code == 200
            data = response.json()

            assert data["session_id"] == session_id
            assert "created_at" in data

    async def test_get_session_not_found(self, async_client):
        """Test getting non-existent session."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.get_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.get("/api/v1/sessions/nonexistent")

            assert response.status_code == 404


class TestListSessionsEndpoint:
    """Tests for GET /sessions."""

    async def test_list_sessions(self, async_client, factory):
        """Test listing sessions for an organization."""
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.list_sessions.return_value = [
                make_mock_session(
                    session_id="session_1",
                    organization_id=org_id,
                    agent_id="claude",
                ),
                make_mock_session(
                    session_id="session_2",
                    organization_id=org_id,
                    agent_id="gpt",
                ),
            ]
            mock_get.return_value = mock_manager

            response = await async_client.get(
                "/api/v1/sessions",
                params={"organization_id": org_id},
            )

            assert response.status_code == 200
            data = response.json()

            assert "sessions" in data
            assert len(data["sessions"]) == 2
            assert data["total_count"] == 2

    async def test_list_sessions_include_expired(self, async_client, factory):
        """Test listing sessions including expired ones."""
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.list_sessions.return_value = [
                make_mock_session(
                    session_id="session_1",
                    organization_id=org_id,
                    is_expired=False,
                ),
                make_mock_session(
                    session_id="session_2",
                    organization_id=org_id,
                    is_expired=True,
                ),
            ]
            mock_get.return_value = mock_manager

            response = await async_client.get(
                "/api/v1/sessions",
                params={"organization_id": org_id, "include_expired": "true"},
            )

            assert response.status_code == 200
            data = response.json()

            assert len(data["sessions"]) == 2

    async def test_list_sessions_requires_org_id(self, async_client):
        """Test listing sessions requires organization_id."""
        response = await async_client.get("/api/v1/sessions")

        assert response.status_code == 422


class TestDeleteSessionEndpoint:
    """Tests for DELETE /sessions/{session_id}."""

    async def test_delete_session_success(self, async_client):
        """Test deleting a session."""
        session_id = "session_to_delete"

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.delete_session.return_value = True
            mock_get.return_value = mock_manager

            response = await async_client.delete(f"/api/v1/sessions/{session_id}")

            # DELETE returns 204 No Content
            assert response.status_code == 204

    async def test_delete_session_not_found(self, async_client):
        """Test deleting non-existent session."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.delete_session.return_value = False
            mock_get.return_value = mock_manager

            response = await async_client.delete("/api/v1/sessions/nonexistent")

            assert response.status_code == 404


class TestAddContextEndpoint:
    """Tests for POST /sessions/{session_id}/context."""

    async def test_add_context_success(self, async_client, factory):
        """Test adding context to a session."""
        session_id = "session_123"
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id=session_id,
                organization_id=org_id,
            )
            mock_manager.get_session.return_value = mock_session
            mock_manager.update_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.post(
                f"/api/v1/sessions/{session_id}/context",
                json={
                    "context_type": "query",
                    "content": {"query": "What commitments do I have?"},
                    "metadata": {},
                },
            )

            assert response.status_code == 201
            data = response.json()

            assert "entry_id" in data
            assert "context_type" in data
            assert "timestamp" in data

    async def test_add_entity_context(self, async_client, factory):
        """Test adding an entity_viewed context entry."""
        session_id = "session_456"
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id=session_id,
                organization_id=org_id,
            )
            mock_manager.get_session.return_value = mock_session
            mock_manager.update_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.post(
                f"/api/v1/sessions/{session_id}/context",
                json={
                    "context_type": "entity_viewed",
                    "content": {"entity_type": "contact", "entity_id": "contact_1"},
                },
            )

            assert response.status_code == 201

    async def test_add_context_missing_type(self, async_client):
        """Test adding context without type."""
        response = await async_client.post(
            "/api/v1/sessions/session_123/context",
            json={
                "content": {"data": "test"},
            },
        )

        assert response.status_code == 422

    async def test_add_context_session_not_found(self, async_client):
        """Test adding context to non-existent session."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.get_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.post(
                "/api/v1/sessions/nonexistent/context",
                json={
                    "context_type": "query",
                    "content": {"query": "test"},
                },
            )

            assert response.status_code == 404


class TestAddInteractionEndpoint:
    """Tests for POST /sessions/{session_id}/interaction."""

    async def test_add_interaction_success(self, async_client, factory):
        """Test adding an interaction (query + response pair)."""
        session_id = "session_789"
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id=session_id,
                organization_id=org_id,
            )
            mock_manager.get_session.return_value = mock_session
            mock_manager.update_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.post(
                f"/api/v1/sessions/{session_id}/interaction",
                json={
                    "query": "What commitments are due this week?",
                    "response": "You have 3 commitments due this week...",
                    "metadata": {"latency_ms": 150},
                },
            )

            assert response.status_code == 201
            data = response.json()

            # Returns both query and response entries
            assert "query" in data
            assert "response" in data
            assert "entry_id" in data["query"]
            assert "entry_id" in data["response"]

    async def test_add_interaction_session_not_found(self, async_client):
        """Test adding interaction to non-existent session."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.get_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.post(
                "/api/v1/sessions/nonexistent/interaction",
                json={
                    "query": "test query",
                    "response": "test response",
                },
            )

            assert response.status_code == 404

    async def test_add_interaction_missing_query(self, async_client):
        """Test interaction requires query field."""
        response = await async_client.post(
            "/api/v1/sessions/session_123/interaction",
            json={
                "response": "test response",
            },
        )

        assert response.status_code == 422

    async def test_add_interaction_missing_response(self, async_client):
        """Test interaction requires response field."""
        response = await async_client.post(
            "/api/v1/sessions/session_123/interaction",
            json={
                "query": "test query",
            },
        )

        assert response.status_code == 422


class TestGetContextEndpoint:
    """Tests for GET /sessions/{session_id}/context."""

    async def test_get_context_success(self, async_client, factory):
        """Test getting session context."""
        session_id = "session_ctx"
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id=session_id,
                organization_id=org_id,
            )
            mock_manager.get_session.return_value = mock_session
            mock_get.return_value = mock_manager

            response = await async_client.get(
                f"/api/v1/sessions/{session_id}/context"
            )

            assert response.status_code == 200
            data = response.json()

            assert "session_id" in data
            assert "context" in data
            assert "summary" in data

    async def test_get_context_session_not_found(self, async_client):
        """Test getting context for non-existent session."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.get_session.return_value = None
            mock_get.return_value = mock_manager

            response = await async_client.get(
                "/api/v1/sessions/nonexistent/context"
            )

            assert response.status_code == 404


class TestCleanupSessionsEndpoint:
    """Tests for POST /sessions/cleanup."""

    async def test_cleanup_expired_sessions(self, async_client):
        """Test cleaning up expired sessions."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.cleanup_expired.return_value = 5
            mock_get.return_value = mock_manager

            response = await async_client.post("/api/v1/sessions/cleanup")

            assert response.status_code == 200
            data = response.json()

            assert data["cleaned"] == 5

    async def test_cleanup_no_expired_sessions(self, async_client):
        """Test cleanup when no sessions expired."""
        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_manager.cleanup_expired.return_value = 0
            mock_get.return_value = mock_manager

            response = await async_client.post("/api/v1/sessions/cleanup")

            assert response.status_code == 200
            data = response.json()

            assert data["cleaned"] == 0


class TestSessionIntegration:
    """Integration tests for session workflows."""

    async def test_full_session_workflow(self, async_client, factory):
        """Test complete session workflow: create, add context, add interaction, get context, delete."""
        org_id = factory.organization_id()

        with patch("src.api.routes.sessions.get_session_manager") as mock_get:
            mock_manager = AsyncMock()
            mock_session = make_mock_session(
                session_id="session_workflow_123",
                organization_id=org_id,
                agent_id="test_agent",
            )
            mock_manager.create_session.return_value = mock_session
            mock_manager.get_session.return_value = mock_session
            mock_manager.update_session.return_value = None
            mock_manager.delete_session.return_value = True
            mock_get.return_value = mock_manager

            # 1. Create session
            create_response = await async_client.post(
                "/api/v1/sessions",
                json={"organization_id": org_id, "agent_id": "test_agent"},
            )
            assert create_response.status_code == 201
            session_id = create_response.json()["session_id"]

            # 2. Add context
            context_response = await async_client.post(
                f"/api/v1/sessions/{session_id}/context",
                json={
                    "context_type": "entity_viewed",
                    "content": {"entity_type": "contact", "entity_id": "contact_1"},
                },
            )
            assert context_response.status_code == 201

            # 3. Add interaction
            interaction_response = await async_client.post(
                f"/api/v1/sessions/{session_id}/interaction",
                json={
                    "query": "Tell me about contact_1",
                    "response": "Contact 1 is John Doe...",
                },
            )
            assert interaction_response.status_code == 201

            # 4. Get context
            get_response = await async_client.get(
                f"/api/v1/sessions/{session_id}/context"
            )
            assert get_response.status_code == 200
            assert "context" in get_response.json()

            # 5. Delete session
            delete_response = await async_client.delete(
                f"/api/v1/sessions/{session_id}"
            )
            assert delete_response.status_code == 204
