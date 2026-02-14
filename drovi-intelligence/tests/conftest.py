"""
Test Configuration and Fixtures

Provides shared fixtures, mocks, and test utilities for the entire test suite.
This is the foundation for Meta/Google-level testing coverage.
"""

import asyncio
import os
from datetime import datetime, timedelta
from typing import Any, AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

# Set test environment variables before importing app.
#
# Use setdefault so CI/Docker can override these to point at real services when
# running integration-style suites (e.g. compose postgres on the service network).
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_drovi")
os.environ.setdefault("FALKORDB_HOST", "localhost")
os.environ.setdefault("FALKORDB_PORT", "6379")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("OPENAI_API_KEY", "test-key")


# =============================================================================
# PYTEST CONFIGURATION
# =============================================================================


def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line("markers", "unit: Unit tests (fast, isolated)")
    config.addinivalue_line("markers", "integration: Integration tests (may use real services)")
    config.addinivalue_line("markers", "api: API endpoint tests")
    config.addinivalue_line("markers", "e2e: End-to-end tests")
    config.addinivalue_line("markers", "slow: Slow tests (>1s)")
    config.addinivalue_line("markers", "mcp: MCP server/tool tests")


def pytest_collection_modifyitems(config, items):
    """
    Auto-assign tier markers so we can run:
    - pytest -m unit
    - pytest -m integration
    - pytest -m e2e

    Convention:
    - tests/integration/** => integration
    - tests/e2e/**         => e2e
    - tests/chaos/**       => integration (failure-mode / reliability suite)
    - everything else      => unit
    """
    for item in items:
        path = str(getattr(item, "fspath", ""))
        # If the test is already explicitly tiered, do not override.
        if item.get_closest_marker("integration") or item.get_closest_marker("e2e") or item.get_closest_marker("unit"):
            continue
        if "/tests/integration/" in path or path.endswith("\\tests\\integration\\"):
            item.add_marker(pytest.mark.integration)
        elif "/tests/e2e/" in path or path.endswith("\\tests\\e2e\\"):
            item.add_marker(pytest.mark.e2e)
        elif "/tests/chaos/" in path or path.endswith("\\tests\\chaos\\"):
            item.add_marker(pytest.mark.integration)
        else:
            item.add_marker(pytest.mark.unit)


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def fake_clock():
    """Deterministic clock for tests (Phase 1 will wire this into kernel time)."""
    from tests.support.clock import FakeClock

    return FakeClock.fixed()


# =============================================================================
# AUTHENTICATION FIXTURES
# =============================================================================


@pytest.fixture
def mock_auth_context():
    """
    Create a mock API key context for testing.

    Uses "internal" as org_id to bypass org validation checks,
    allowing tests to use any organization_id in their requests.
    """
    from src.auth.context import AuthMetadata, AuthType
    from src.auth.middleware import APIKeyContext

    return APIKeyContext(
        organization_id="internal",  # Special value that bypasses org validation
        auth_subject_id="service_test",
        scopes=["read", "write", "read:graph", "read:analytics", "write:connections", "admin", "*"],
        metadata=AuthMetadata(
            auth_type=AuthType.INTERNAL_SERVICE,
            key_id="internal:test",
            key_name="Internal: test",
            service_name="tests",
        ),
        is_internal=True,  # Mark as internal to get all permissions
        rate_limit_per_minute=10000,
    )


@pytest.fixture
def internal_auth_context():
    """Create an internal auth context for testing."""
    from src.auth.context import AuthMetadata, AuthType
    from src.auth.middleware import APIKeyContext

    return APIKeyContext(
        organization_id="internal",
        auth_subject_id="service_internal",
        scopes=["*"],
        metadata=AuthMetadata(
            auth_type=AuthType.INTERNAL_SERVICE,
            key_id="internal",
            key_name="Internal",
            service_name="tests",
        ),
        is_internal=True,
        rate_limit_per_minute=10000,
    )


@pytest.fixture(autouse=True)
def mock_rate_limit():
    """
    Automatically mock rate limiting for all tests.

    This patches the rate limit check to always allow requests.
    """
    from src.auth.rate_limit import RateLimitResult

    async def mock_check_rate_limit(*args, **kwargs):
        return RateLimitResult(
            allowed=True,
            remaining=100,
            reset_at=0,
            limit=100,
        )

    with patch("src.auth.middleware.check_rate_limit_for_context", side_effect=mock_check_rate_limit):
        with patch("src.auth.rate_limit.check_rate_limit", side_effect=mock_check_rate_limit):
            yield


# =============================================================================
# APPLICATION FIXTURES
# =============================================================================


@pytest.fixture
def app(mock_auth_context):
    """Create FastAPI application for testing with auth overrides."""
    from src.api.main import app as fastapi_app
    from src.auth.middleware import get_api_key_context, get_auth_context

    # Override the auth dependency - must match signature or use no params
    async def get_mock_context():
        return mock_auth_context

    fastapi_app.dependency_overrides[get_api_key_context] = get_mock_context
    fastapi_app.dependency_overrides[get_auth_context] = get_mock_context

    yield fastapi_app

    # Clean up
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def app_no_auth():
    """Create FastAPI application without auth mocking (for auth-specific tests)."""
    from src.api.main import app as fastapi_app
    return fastapi_app


@pytest.fixture
def client(app) -> TestClient:
    """Create synchronous test client with auth overridden."""
    return TestClient(app)


@pytest.fixture
def client_no_auth(app_no_auth) -> TestClient:
    """Create test client without auth mocking."""
    return TestClient(app_no_auth)


@pytest_asyncio.fixture
async def async_client(app) -> AsyncGenerator[AsyncClient, None]:
    """Create async test client with auth overridden."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def async_client_no_auth(app_no_auth) -> AsyncGenerator[AsyncClient, None]:
    """Create async test client without auth mocking."""
    transport = ASGITransport(app=app_no_auth)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# =============================================================================
# DATABASE FIXTURES
# =============================================================================


@pytest_asyncio.fixture
async def mock_db_pool():
    """Mock database pool."""
    # asyncpg's pool.acquire() returns an async context manager, not an awaitable.
    # Use MagicMock for the pool so `async with pool.acquire()` works.
    pool = MagicMock()
    conn = AsyncMock()

    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=None)
    pool.acquire.return_value = acquire_cm

    conn.fetch.return_value = []
    conn.fetchrow.return_value = None
    conn.fetchval.return_value = 1
    conn.execute.return_value = "DELETE 0"

    with patch("src.db.client.get_db_pool", return_value=pool):
        yield pool


@pytest_asyncio.fixture
async def mock_graph_client():
    """Mock FalkorDB graph client."""
    client = AsyncMock()
    client.query.return_value = []
    client.ping.return_value = True
    client.initialize_indexes.return_value = None

    with patch("src.graph.client.get_graph_client", return_value=client):
        yield client


@pytest_asyncio.fixture
async def mock_redis():
    """Mock Redis client."""
    redis = AsyncMock()
    redis.ping.return_value = True
    redis.get.return_value = None
    redis.set.return_value = True
    redis.setex.return_value = True
    redis.delete.return_value = 1
    redis.publish.return_value = 1

    with patch("redis.asyncio.from_url", return_value=redis):
        yield redis


# =============================================================================
# LLM FIXTURES
# =============================================================================


@pytest_asyncio.fixture
async def mock_llm_service():
    """Mock LLM service for testing."""
    from src.llm.service import LLMCall

    service = AsyncMock()

    # Default response for structured output
    service.complete_structured.return_value = (
        MagicMock(),  # Output model
        LLMCall(
            model="test-model",
            prompt_tokens=100,
            completion_tokens=50,
            duration_ms=500,
        ),
    )

    # Default response for plain generation
    service.generate.return_value = "Test LLM response"

    with patch("src.llm.get_llm_service", return_value=service):
        yield service


# =============================================================================
# FACTORY FUNCTIONS
# =============================================================================


class TestDataFactory:
    """Factory for creating test data."""

    @staticmethod
    def organization_id() -> str:
        """Generate test organization ID."""
        return f"org_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def user_id() -> str:
        """Generate test user ID."""
        return f"user_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def entity_id(entity_type: str = "contact") -> str:
        """Generate test entity ID."""
        return f"{entity_type}_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def uio_id(uio_type: str = "commitment") -> str:
        """Generate test UIO ID."""
        return f"{uio_type}_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def session_id() -> str:
        """Generate test session ID."""
        return f"sess_{uuid.uuid4().hex[:12]}"

    @staticmethod
    def analysis_input(
        organization_id: str | None = None,
        content: str = "Test content for analysis",
        source_type: str = "api",
    ) -> dict[str, Any]:
        """Create test analysis input."""
        return {
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "content": content,
            "source_type": source_type,
            "source_id": f"source_{uuid.uuid4().hex[:8]}",
        }

    @staticmethod
    def commitment(
        organization_id: str | None = None,
        status: str = "active",
        due_date: datetime | None = None,
    ) -> dict[str, Any]:
        """Create test commitment."""
        return {
            "id": TestDataFactory.uio_id("commitment"),
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "uio_type": "commitment",
            "title": "Test commitment",
            "description": "This is a test commitment",
            "status": status,
            "direction": "owed_by_me",
            "owner_id": TestDataFactory.entity_id("contact"),
            "counterparty_id": TestDataFactory.entity_id("contact"),
            "due_date": due_date or (datetime.utcnow() + timedelta(days=7)),
            "confidence": 0.85,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

    @staticmethod
    def decision(
        organization_id: str | None = None,
        status: str = "made",
    ) -> dict[str, Any]:
        """Create test decision."""
        return {
            "id": TestDataFactory.uio_id("decision"),
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "uio_type": "decision",
            "title": "Test decision",
            "description": "We decided to do something",
            "status": status,
            "rationale": "Because it makes sense",
            "alternatives_considered": ["Option A", "Option B"],
            "made_by_id": TestDataFactory.entity_id("contact"),
            "confidence": 0.9,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

    @staticmethod
    def task(
        organization_id: str | None = None,
        status: str = "pending",
    ) -> dict[str, Any]:
        """Create test task."""
        return {
            "id": TestDataFactory.uio_id("task"),
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "uio_type": "task",
            "title": "Test task",
            "description": "Do something important",
            "status": status,
            "owner_id": TestDataFactory.entity_id("contact"),
            "priority": "medium",
            "confidence": 0.8,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

    @staticmethod
    def risk(
        organization_id: str | None = None,
        severity: str = "medium",
    ) -> dict[str, Any]:
        """Create test risk."""
        return {
            "id": TestDataFactory.uio_id("risk"),
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "uio_type": "risk",
            "title": "Test risk",
            "description": "Something might go wrong",
            "risk_type": "deal_risk",
            "severity": severity,
            "likelihood": 0.5,
            "impact": "medium",
            "confidence": 0.75,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

    @staticmethod
    def contact(
        organization_id: str | None = None,
        name: str = "John Doe",
        email: str | None = None,
    ) -> dict[str, Any]:
        """Create test contact entity."""
        return {
            "id": TestDataFactory.entity_id("contact"),
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "entity_type": "person",
            "name": name,
            "email": email or f"{name.lower().replace(' ', '.')}@example.com",
            "company": "Test Company",
            "title": "Test Title",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

    @staticmethod
    def email_content() -> str:
        """Create realistic test email content."""
        return """
Subject: Project Update - Q1 Planning

Hi team,

I wanted to follow up on our meeting yesterday. Here's what we agreed on:

1. Sarah will prepare the budget proposal by Friday
2. We decided to go with Vendor A for the new software
3. The deadline for the project is March 15th

John mentioned he's concerned about the timeline - we should discuss this further.

Can everyone confirm they're aligned? Please let me know if you have any questions.

Best,
Alice
        """.strip()

    @staticmethod
    def slack_message() -> str:
        """Create realistic test Slack message."""
        return """
@channel Quick update:

- Just finished the API integration
- @bob can you review the PR when you get a chance?
- Let's sync tomorrow at 2pm about the deployment

Also, we need to decide on the pricing tier by EOD Wednesday.
        """.strip()

    @staticmethod
    def connection_config(
        connector_type: str = "gmail",
        organization_id: str | None = None,
    ) -> dict[str, Any]:
        """Create test connection config."""
        return {
            "id": f"conn_{uuid.uuid4().hex[:12]}",
            "organization_id": organization_id or TestDataFactory.organization_id(),
            "connector_type": connector_type,
            "name": f"Test {connector_type} connection",
            "config": {
                "credentials": {"access_token": "test-token"},
                "settings": {"sync_interval_minutes": 15},
            },
            "status": "active",
            "created_at": datetime.utcnow(),
        }


@pytest.fixture
def factory() -> type[TestDataFactory]:
    """Provide test data factory."""
    return TestDataFactory


# =============================================================================
# ORCHESTRATOR FIXTURES
# =============================================================================


@pytest.fixture
def sample_analysis_input(factory):
    """Sample analysis input for testing."""
    return factory.analysis_input(content=factory.email_content())


@pytest.fixture
def sample_intelligence_state(factory):
    """Sample intelligence state for testing."""
    from src.orchestrator.state import IntelligenceState, AnalysisInput

    org_id = factory.organization_id()
    return IntelligenceState(
        input=AnalysisInput(
            organization_id=org_id,
            content=factory.email_content(),
            source_type="email",
        ),
    )


# =============================================================================
# MCP FIXTURES
# =============================================================================


@pytest_asyncio.fixture
async def mcp_server():
    """Create MCP server for testing."""
    from src.mcp.server import DroviMCPServer

    server = DroviMCPServer()
    yield server


# =============================================================================
# EVENT FIXTURES
# =============================================================================


@pytest_asyncio.fixture
async def mock_event_publisher():
    """Mock event publisher."""
    from src.events import EventPublisher

    publisher = AsyncMock(spec=EventPublisher)
    publisher.publish.return_value = True

    with patch("src.events.publisher.get_event_publisher", return_value=publisher):
        yield publisher


# =============================================================================
# SESSION FIXTURES
# =============================================================================


@pytest_asyncio.fixture
async def mock_session_manager():
    """Mock session manager."""
    from src.agents import SessionManager, AgentSession

    manager = AsyncMock(spec=SessionManager)

    # Create a sample session
    session = AgentSession.create(
        organization_id=TestDataFactory.organization_id(),
        agent_id="test_agent",
    )

    manager.create_session.return_value = session
    manager.get_session.return_value = session
    manager.get_or_create_session.return_value = session

    with patch("src.agents.sessions.get_session_manager", return_value=manager):
        yield manager


# =============================================================================
# CONNECTOR FIXTURES
# =============================================================================


@pytest.fixture
def mock_connector():
    """Base mock for connectors."""
    connector = AsyncMock()
    connector.check_connection.return_value = (True, None)
    connector.discover_streams.return_value = []
    connector.read_stream.return_value = AsyncMock()

    return connector


# =============================================================================
# CLEANUP FIXTURES
# =============================================================================


@pytest_asyncio.fixture(autouse=True)
async def cleanup_after_test():
    """Clean up after each test."""
    yield
    # Add any cleanup logic here


# =============================================================================
# ASSERTION HELPERS
# =============================================================================


class AssertHelpers:
    """Custom assertion helpers."""

    @staticmethod
    def assert_valid_uio(uio: dict[str, Any], uio_type: str) -> None:
        """Assert UIO has required fields."""
        assert "id" in uio, "UIO missing 'id'"
        assert "organization_id" in uio, "UIO missing 'organization_id'"
        assert uio.get("uio_type") == uio_type, f"Expected uio_type '{uio_type}'"
        assert "title" in uio, "UIO missing 'title'"
        assert "confidence" in uio, "UIO missing 'confidence'"
        assert 0 <= uio["confidence"] <= 1, "Confidence must be between 0 and 1"

    @staticmethod
    def assert_valid_entity(entity: dict[str, Any]) -> None:
        """Assert entity has required fields."""
        assert "id" in entity, "Entity missing 'id'"
        assert "entity_type" in entity, "Entity missing 'entity_type'"
        assert "name" in entity, "Entity missing 'name'"

    @staticmethod
    def assert_valid_api_response(response, expected_status: int = 200) -> None:
        """Assert API response is valid."""
        assert response.status_code == expected_status, (
            f"Expected status {expected_status}, got {response.status_code}: {response.text}"
        )

    @staticmethod
    def assert_event_published(mock_publisher, event_type: str) -> None:
        """Assert event was published."""
        calls = mock_publisher.publish.call_args_list
        event_types = [call[0][0].event_type.value for call in calls]
        assert event_type in event_types, (
            f"Expected event '{event_type}' to be published, got: {event_types}"
        )


@pytest.fixture
def assertions() -> type[AssertHelpers]:
    """Provide assertion helpers."""
    return AssertHelpers
