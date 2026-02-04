import pytest

from src.orchestrator.nodes.persist_candidates import persist_candidates_node
from src.orchestrator.state import (
    AnalysisInput,
    ExtractedDecision,
    ExtractedIntelligence,
    IntelligenceState,
)


class FakeSession:
    def __init__(self):
        self.params = []

    async def execute(self, _query, params):
        self.params.append(params)

    async def commit(self):
        return None


class FakeSessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return None


@pytest.mark.asyncio
async def test_decision_candidates_pending_confirmation(monkeypatch):
    session = FakeSession()

    def fake_get_db_session():
        return FakeSessionContext(session)

    monkeypatch.setattr(
        "src.orchestrator.nodes.persist_candidates.get_db_session",
        fake_get_db_session,
    )

    decision = ExtractedDecision(
        title="Use Stripe for payments",
        statement="We will use Stripe.",
        quoted_text="We will use Stripe.",
        confidence=0.9,
    )

    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org-1",
            content="We will use Stripe.",
            source_type="meeting",
            conversation_id="session-1",
            candidate_only=True,
        ),
        extracted=ExtractedIntelligence(decisions=[decision]),
    )

    await persist_candidates_node(state)

    assert session.params
    decision_inserts = [p for p in session.params if p["candidate_type"] == "decision"]
    assert decision_inserts
    assert decision_inserts[0]["status"] == "pending_confirmation"
