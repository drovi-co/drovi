"""Tests for pipeline routing based on source intelligence."""

import pytest

from src.orchestrator.state import AnalysisInput, IntelligenceState
from src.orchestrator.nodes.pipeline_router import determine_route, pipeline_router_node
from src.orchestrator.graph import after_persist_raw

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _make_state():
    return IntelligenceState(
        input=AnalysisInput(
            organization_id="org_test",
            content="Hello",
            source_type="email",
        )
    )


def test_determine_route_defaults_to_full():
    state = _make_state()
    assert determine_route(state) == "full"


def test_determine_route_skip_when_should_not_extract():
    state = _make_state()
    state.source_intelligence = {
        "should_extract": False,
        "extraction_level": "full",
    }
    assert determine_route(state) == "skip"


def test_determine_route_minimal():
    state = _make_state()
    state.source_intelligence = {
        "should_extract": True,
        "extraction_level": "minimal",
    }
    assert determine_route(state) == "minimal"


def test_determine_route_structured():
    state = _make_state()
    state.source_intelligence = {
        "should_extract": True,
        "extraction_level": "structured",
    }
    assert determine_route(state) == "structured"


async def test_pipeline_router_node_sets_route():
    state = _make_state()
    state.source_intelligence = {
        "should_extract": True,
        "extraction_level": "minimal",
    }

    result = await pipeline_router_node(state)

    assert result["pipeline_route"] == "minimal"
    assert result["trace"].current_node == "pipeline_router"


def test_after_persist_raw_finalizes_on_skip():
    state = _make_state()
    state.pipeline_route = "skip"
    assert after_persist_raw(state) == "finalize"


def test_after_persist_raw_continues_when_not_skip():
    state = _make_state()
    state.pipeline_route = "full"
    assert after_persist_raw(state) == "summarize_long_content"
