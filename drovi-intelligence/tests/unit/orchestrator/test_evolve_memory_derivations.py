from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.graph.types import GraphNodeType
from src.orchestrator.nodes.evolve_memory import _handle_derivations, run_derivation_rule


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _FakeGraph:
    def __init__(self):
        self.created_nodes = []
        self.queries = []

    async def query(self, cypher, params=None):
        self.queries.append((cypher, params or {}))
        if "RETURN c as c, t as t" in cypher:
            return [
                {
                    "c": {"id": "contact_1", "name": "Alex", "organizationId": "org_1"},
                    "t": {"id": "topic_1", "name": "Payments", "organizationId": "org_1"},
                }
            ]
        if "derivationFingerprint" in cypher:
            return []
        return []

    async def create_node(self, node_type, node_id, organization_id, properties):
        self.created_nodes.append(
            {
                "node_type": node_type,
                "node_id": node_id,
                "organization_id": organization_id,
                "properties": properties,
            }
        )
        return {"id": node_id, **properties}


@pytest.mark.asyncio
async def test_run_derivation_rule_creates_entity_and_edges():
    graph = _FakeGraph()
    rule = {
        "id": "rule_1",
        "input_pattern": "(c:Contact)-[:MENTIONED_IN]->(t:Topic)",
        "output_entity_type": "topic",
        "output_template": {
            "nameTemplate": "{c.name} works on {t.name}",
            "summaryTemplate": "{c.name} repeatedly mentions {t.name}",
            "properties": {"focus_area": "{t.name}"},
        },
        "confidence_multiplier": 0.9,
        "domain": "general",
    }

    derived = await run_derivation_rule(
        rule_id="rule_1",
        organization_id="org_1",
        graph=graph,
        rule=rule,
    )

    assert len(derived) == 1
    assert derived[0]["rule_id"] == "rule_1"
    assert derived[0]["name"] == "Alex works on Payments"
    assert graph.created_nodes
    created = graph.created_nodes[0]
    assert created["node_type"] == GraphNodeType.ENTITY
    assert created["organization_id"] == "org_1"
    assert created["properties"]["derivationRule"] == "rule_1"
    assert created["properties"]["derivationSourceIds"] == ["contact_1", "topic_1"]


@pytest.mark.asyncio
async def test_handle_derivations_runs_rules_and_records_usage(monkeypatch):
    graph = _FakeGraph()
    state = SimpleNamespace(input=SimpleNamespace(organization_id="org_1"))

    monkeypatch.setattr(
        "src.orchestrator.nodes.evolve_memory._list_active_derivation_rules",
        AsyncMock(return_value=[{"id": "rule_1"}]),
    )
    monkeypatch.setattr(
        "src.orchestrator.nodes.evolve_memory.run_derivation_rule",
        AsyncMock(return_value=[{"id": "drv_1"}]),
    )
    record_usage_mock = AsyncMock()
    monkeypatch.setattr(
        "src.orchestrator.nodes.evolve_memory._record_derivation_rule_match",
        record_usage_mock,
    )

    derived = await _handle_derivations(state, graph)

    assert derived == [{"id": "drv_1"}]
    record_usage_mock.assert_awaited_once_with(
        organization_id="org_1",
        rule_id="rule_1",
        match_count=1,
    )
