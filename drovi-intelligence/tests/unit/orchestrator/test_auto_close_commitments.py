import pytest
from datetime import datetime, timezone
from types import SimpleNamespace

from src.orchestrator.nodes.auto_close_commitments import auto_close_commitments_node
from src.orchestrator.state import AnalysisInput, IntelligenceState
from src.llm.schemas import CommitmentFulfillmentOutput, CommitmentFulfillmentSchema


class FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def fetchall(self):
        return self._rows


class FakeSession:
    def __init__(self, rows, update_calls):
        self._rows = rows
        self._update_calls = update_calls

    async def execute(self, query, params):
        query_str = str(query)
        if "SELECT u.id" in query_str:
            return FakeResult(self._rows)
        self._update_calls.append((query_str, params))
        return FakeResult()

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
async def test_auto_close_commitments_updates_status(monkeypatch):
    now = datetime(2026, 2, 2, tzinfo=timezone.utc)
    row = SimpleNamespace(
        id="uio-1",
        canonical_title="Send proposal",
        canonical_description="Send proposal to finance",
        due_date=now,
        commitment_status="pending",
    )

    update_calls = []

    def fake_get_db_session():
        return FakeSessionContext(FakeSession([row], update_calls))

    class FakeLLM:
        async def complete_structured(self, *args, **kwargs):
            output = CommitmentFulfillmentOutput(
                fulfilled=[
                    CommitmentFulfillmentSchema(
                        commitment_id="uio-1",
                        evidence_quote="sent the proposal",
                        confidence=0.9,
                        reason="Explicit completion",
                    )
                ]
            )
            llm_call = SimpleNamespace(model="test", prompt_tokens=1, completion_tokens=1, duration_ms=5)
            return output, llm_call

    async def fake_get_graph_client():
        class FakeGraph:
            async def query(self, *args, **kwargs):
                return []

        return FakeGraph()

    monkeypatch.setattr("src.orchestrator.nodes.auto_close_commitments.get_db_session", fake_get_db_session)
    monkeypatch.setattr("src.orchestrator.nodes.auto_close_commitments.get_llm_service", lambda: FakeLLM())
    monkeypatch.setattr("src.graph.client.get_graph_client", fake_get_graph_client)

    state = IntelligenceState(
        input=AnalysisInput(
            organization_id="org-1",
            content="I sent the proposal to finance.",
            source_type="email",
            conversation_id="thread-1",
            message_ids=["msg-1"],
        ),
    )

    await auto_close_commitments_node(state)

    update_sql = "\n".join(q for q, _ in update_calls)
    assert "UPDATE unified_intelligence_object" in update_sql
    assert "UPDATE uio_commitment_details" in update_sql
