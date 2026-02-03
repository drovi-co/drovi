import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.api
@pytest.mark.asyncio
async def test_compose_guardrails_blocks_ssn(async_client):
    payload = {
        "organization_id": "org_1",
        "content": "Please process SSN 123-45-6789 for onboarding.",
        "channel": "email",
    }

    with patch("src.api.routes.guardrails.check_contradictions", AsyncMock(return_value=[])), patch(
        "src.api.routes.guardrails.record_audit_event",
        AsyncMock(),
    ):
        response = await async_client.post("/api/v1/guardrails/compose/check", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["overall_action"] == "block"
    assert any(finding["type"] == "ssn" for finding in data["pii_findings"])


@pytest.mark.api
@pytest.mark.asyncio
async def test_compose_guardrails_allows_clean_message(async_client):
    payload = {
        "organization_id": "org_1",
        "content": "Looking forward to the demo tomorrow.",
        "channel": "email",
    }

    with patch("src.api.routes.guardrails.check_contradictions", AsyncMock(return_value=[])), patch(
        "src.api.routes.guardrails.record_audit_event",
        AsyncMock(),
    ):
        response = await async_client.post("/api/v1/guardrails/compose/check", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["overall_action"] == "allow"
    assert data["pii_findings"] == []


@pytest.mark.api
@pytest.mark.asyncio
async def test_inbound_guardrails_flags_fraud(async_client):
    payload = {
        "organization_id": "org_1",
        "sender_email": "ceo@evil-payments.com",
        "sender_name": "CEO",
        "subject": "Urgent wire transfer",
        "content": "Please wire transfer $20,000 today to this account.",
        "known_domains": ["company.com"],
    }

    with patch("src.api.routes.guardrails.record_audit_event", AsyncMock()):
        response = await async_client.post("/api/v1/guardrails/inbound/check", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["fraud_signals"]
    assert data["overall_action"] in {"require_approval", "block"}
