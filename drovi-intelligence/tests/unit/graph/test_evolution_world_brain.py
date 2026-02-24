from __future__ import annotations

import pytest

from src.graph.evolution import MemoryEvolution


class _FakeGraph:
    def __init__(self) -> None:
        self.queries: list[tuple[str, dict]] = []

    async def query(self, cypher: str, params: dict):
        self.queries.append((cypher, params))
        return [{"ok": True}]


@pytest.mark.asyncio
async def test_upsert_causal_edge_writes_causes_relationship() -> None:
    graph = _FakeGraph()
    evolution = MemoryEvolution(graph)

    result = await evolution.upsert_causal_edge(
        source_ref="source_a",
        target_ref="target_b",
        sign=-1,
        strength=0.8,
        lag_hours=12,
        confidence=0.7,
    )

    assert result.success
    assert graph.queries
    cypher = graph.queries[0][0]
    assert ":CAUSES" in cypher


@pytest.mark.asyncio
async def test_create_impact_bridge_writes_impacts_relationship() -> None:
    graph = _FakeGraph()
    evolution = MemoryEvolution(graph)

    result = await evolution.create_impact_bridge(
        external_ref="external_1",
        internal_ref="internal_1",
        impact_type="invalidates",
        severity="high",
        confidence=0.82,
        evidence_refs=["ev_1"],
    )

    assert result.success
    assert graph.queries
    cypher = graph.queries[0][0]
    assert ":IMPACTS" in cypher
