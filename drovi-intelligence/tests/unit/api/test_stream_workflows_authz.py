from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.api.routes import stream as stream_route
from src.api.routes import workflows as workflows_route


def _ctx(org_id: str = "org_test") -> SimpleNamespace:
    return SimpleNamespace(organization_id=org_id)


@pytest.mark.asyncio
async def test_stream_changes_rejects_mismatched_organization_scope() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await stream_route.stream_graph_changes(
            request=SimpleNamespace(),
            organization_id="org_other",
            node_types=None,
            change_types=None,
            ctx=_ctx("org_test"),
        )

    assert exc_info.value.status_code == 403
    assert "Organization ID mismatch" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_stream_changes_allows_internal_scope() -> None:
    response = await stream_route.stream_graph_changes(
        request=SimpleNamespace(),
        organization_id="org_any",
        node_types=None,
        change_types=None,
        ctx=_ctx("internal"),
    )

    assert response.status_code == 200
    assert response.media_type == "text/event-stream"


@pytest.mark.asyncio
async def test_workflow_rejects_mismatched_organization_scope() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await workflows_route.run_customer_research(
            request=workflows_route.CustomerResearchRequest(
                organization_id="org_other",
                customer_name="Acme",
            ),
            ctx=_ctx("org_test"),
        )

    assert exc_info.value.status_code == 403
    assert "Organization ID mismatch" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_workflow_allows_org_scoped_execution() -> None:
    workflows = SimpleNamespace(
        run_customer_research=AsyncMock(
            return_value={
                "customer_id": "cust_1",
                "customer_name": "Acme",
                "context": {"size": "enterprise"},
                "relationships": [],
                "commitments": [],
                "risks": [],
                "insights": ["Strong buying signal"],
                "recommendations": ["Prioritize exec follow-up"],
                "status": "completed",
                "error": None,
            }
        )
    )

    with patch(
        "src.agents.langgraph_workflows.get_workflows",
        AsyncMock(return_value=workflows),
    ):
        response = await workflows_route.run_customer_research(
            request=workflows_route.CustomerResearchRequest(
                organization_id="org_test",
                customer_name="Acme",
            ),
            ctx=_ctx("org_test"),
        )

    assert response.status == "completed"
    assert response.customer_name == "Acme"
    workflows.run_customer_research.assert_awaited_once()
