from datetime import UTC, datetime

import pytest

from src.api.routes.uios import build_uio_response


@pytest.mark.asyncio
async def test_build_uio_response_infers_commitment_due_date_and_party() -> None:
    row = {
        "id": "uio_commitment_1",
        "type": "commitment",
        "canonical_title": "Grafana trial ends tomorrow",
        "canonical_description": "Subscription trial window",
        "status": "active",
        "overall_confidence": 0.82,
        "created_at": datetime(2026, 2, 16, 9, 0, tzinfo=UTC),
        "updated_at": None,
        "first_seen_at": None,
        "due_date": None,
        "due_date_original_text": "Grafana trial ends tomorrow",
        "direction": "owed_to_me",
        "commitment_status": "pending",
        "commitment_priority": "medium",
        "due_date_source": "inferred",
        "is_conditional": False,
        "condition": None,
        "snoozed_until": None,
        "commitment_completed_at": None,
        "commitment_supersedes_uio_id": None,
        "commitment_superseded_by_uio_id": None,
        "creditor_id": "ct_me",
        "creditor_display_name": "Jeremy",
        "creditor_email": "jeremy@drovi.co",
        "creditor_avatar_url": None,
        "creditor_company": None,
        "creditor_title": None,
        "source_timestamp": datetime(2026, 2, 16, 9, 0, tzinfo=UTC),
        "source_quoted_text": "Grafana trial ends tomorrow",
    }

    response = await build_uio_response(row)

    assert response.due_date is not None
    assert response.due_date.date().isoformat() == "2026-02-17"
    assert response.creditor is not None
    assert response.debtor is not None
    assert response.debtor.primary_email == response.creditor.primary_email


@pytest.mark.asyncio
async def test_build_uio_response_uses_source_sender_for_decision_maker() -> None:
    row = {
        "id": "uio_decision_1",
        "type": "decision",
        "canonical_title": "Proceed with premium rollout",
        "canonical_description": "Premium rollout approved for pilot",
        "status": "active",
        "overall_confidence": 0.9,
        "created_at": datetime(2026, 2, 16, 9, 0, tzinfo=UTC),
        "updated_at": None,
        "first_seen_at": None,
        "due_date": None,
        "decision_status": "made",
        "statement": "Proceed with premium rollout",
        "rationale": "Pilot velocity and retention impact",
        "decided_at": datetime(2026, 2, 16, 9, 0, tzinfo=UTC),
        "supersedes_uio_id": None,
        "superseded_by_uio_id": None,
        "impact_areas": ["go_to_market"],
        "source_sender_email": "jules@drovi.co",
        "source_sender_name": "Jules Garcia",
    }

    response = await build_uio_response(row)

    assert response.decision_maker is not None
    assert response.decision_maker.primary_email == "jules@drovi.co"
    assert response.owner is not None
    assert response.owner.primary_email == "jules@drovi.co"
