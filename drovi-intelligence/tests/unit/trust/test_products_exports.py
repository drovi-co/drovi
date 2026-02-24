from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.trust import products

pytestmark = [pytest.mark.unit]


class _FakeSessionContext:
    def __init__(self, session: AsyncMock):
        self._session = session

    async def __aenter__(self) -> AsyncMock:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


@pytest.mark.asyncio
async def test_generate_record_certificate_matches_fixture_snapshot() -> None:
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            SimpleNamespace(
                fetchone=lambda: SimpleNamespace(
                    id="uio_123",
                    type="decision",
                    canonical_title="Proceed with pilot rollout",
                    canonical_description="Signed approval after risk review",
                    status="active",
                    overall_confidence=0.94,
                    belief_state="confirmed",
                    truth_state="verified",
                    last_update_reason="user_verified",
                    created_at=datetime(2026, 2, 1, 10, 0, tzinfo=timezone.utc),
                    updated_at=datetime(2026, 2, 5, 11, 0, tzinfo=timezone.utc),
                    last_updated_at=datetime(2026, 2, 6, 8, 30, tzinfo=timezone.utc),
                )
            ),
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(
                        id="src_1",
                        source_type="email",
                        source_account_id="conn_gmail",
                        conversation_id="thread_1",
                        message_id="msg_1",
                        role="evidence",
                        quoted_text="Proceed with rollout after legal review.",
                        quoted_text_start="0",
                        quoted_text_end="42",
                        source_timestamp=datetime(2026, 2, 5, 9, 15, tzinfo=timezone.utc),
                        confidence=0.93,
                        segment_hash="seg_abc",
                        added_at=datetime(2026, 2, 5, 9, 16, tzinfo=timezone.utc),
                    )
                ]
            ),
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(
                        event_type="updated",
                        event_description="Decision verified by owner",
                        event_reason="user_verified",
                        source_type="manual",
                        source_id="usr_1",
                        confidence=0.99,
                        event_at=datetime(2026, 2, 6, 8, 30, tzinfo=timezone.utc),
                    )
                ]
            ),
            SimpleNamespace(
                fetchone=lambda: SimpleNamespace(
                    root_date=date(2026, 2, 6),
                    merkle_root="root_hash",
                    signed_root="root_signature",
                    signature_alg="hmac-sha256",
                    signature_key_id="key_main",
                )
            ),
        ]
    )

    with (
        patch("src.trust.products.get_db_session", lambda: _FakeSessionContext(session)),
        patch("src.trust.products.set_rls_context", lambda *_args, **_kwargs: None),
    ):
        result = await products.generate_record_certificate(
            organization_id="org_test",
            uio_id="uio_123",
            evidence_limit=5,
        )

    assert result["certificate_id"].startswith("cert_")
    assert result["organization_id"] == "org_test"
    assert result["uio_id"] == "uio_123"
    assert result["certificate"]["record"]["title"] == "Proceed with pilot rollout"
    assert len(result["certificate"]["evidence"]) == 1
    assert len(result["certificate"]["timeline"]) == 1
    assert result["certificate"]["custody_anchor"]["merkle_root"] == "root_hash"
    assert len(result["payload_hash"]) == 64
    assert len(result["signature"]) == 64


@pytest.mark.asyncio
async def test_generate_monthly_integrity_report_from_fixture_dataset() -> None:
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(type="commitment", count=7),
                    SimpleNamespace(type="decision", count=3),
                ]
            ),
            SimpleNamespace(
                fetchone=lambda: SimpleNamespace(total_artifacts=12, legal_hold_count=2)
            ),
            SimpleNamespace(
                fetchone=lambda: SimpleNamespace(audit_events=21, reason_coded_events=19)
            ),
            SimpleNamespace(
                fetchone=lambda: SimpleNamespace(detected_count=4, resolved_count=3, open_count=2)
            ),
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(
                        root_date=date(2026, 1, 5),
                        merkle_root="root_1",
                        signed_root="sig_1",
                        signature_key_id="key_main",
                        artifact_count=7,
                        event_count=14,
                    ),
                    SimpleNamespace(
                        root_date=date(2026, 1, 6),
                        merkle_root="root_2",
                        signed_root="sig_2",
                        signature_key_id="key_main",
                        artifact_count=5,
                        event_count=10,
                    ),
                ]
            ),
        ]
    )

    with (
        patch("src.trust.products.get_db_session", lambda: _FakeSessionContext(session)),
        patch("src.trust.products.set_rls_context", lambda *_args, **_kwargs: None),
        patch(
            "src.trust.products.compute_continuity_score",
            AsyncMock(
                return_value={
                    "score": 88.4,
                    "score_normalized": 0.884,
                    "factors": [{"id": "evidence_coverage", "contribution": 0.25}],
                }
            ),
        ),
    ):
        result = await products.generate_monthly_integrity_report(
            organization_id="org_test",
            month="2026-01",
        )

    assert result["report_id"].startswith("ir_202601_")
    assert result["month"] == "2026-01"
    assert result["report"]["metrics"]["uio_created_by_type"]["commitment"] == 7
    assert result["report"]["metrics"]["evidence_artifacts_created"] == 12
    assert result["report"]["metrics"]["audit_events"] == 21
    assert result["report"]["metrics"]["custody_roots_generated"] == 2
    assert result["report"]["continuity_score"]["score"] == 88.4
    assert len(result["payload_hash"]) == 64
    assert len(result["signature"]) == 64


@pytest.mark.asyncio
async def test_export_evidence_bundle_includes_artifacts_and_quotes() -> None:
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(
                        unified_object_id="uio_1",
                        source_type="email",
                        conversation_id="thread_1",
                        message_id="msg_1",
                        quoted_text="Please sign before Friday.",
                        quoted_text_start="0",
                        quoted_text_end="27",
                        segment_hash="seg_123",
                        confidence=0.91,
                    )
                ]
            ),
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(
                        id="evh_1",
                        source_type="email",
                        source_id="msg_1",
                        artifact_type="email_raw",
                        mime_type="message/rfc822",
                        storage_backend="s3",
                        storage_path="org_test/evh_1.eml",
                        byte_size=1024,
                        sha256="hash_1",
                        retention_until=None,
                        immutable=True,
                        legal_hold=False,
                        metadata={"label": "primary"},
                        created_at=datetime(2026, 2, 7, 12, 0, tzinfo=timezone.utc),
                    )
                ]
            ),
            SimpleNamespace(
                fetchall=lambda: [
                    SimpleNamespace(
                        id="evh_2",
                        source_type="email",
                        source_id="thread_1",
                        artifact_type="thread_export",
                        mime_type="application/json",
                        storage_backend="s3",
                        storage_path="org_test/evh_2.json",
                        byte_size=2048,
                        sha256="hash_2",
                        retention_until=None,
                        immutable=True,
                        legal_hold=True,
                        metadata={},
                        created_at=datetime(2026, 2, 8, 12, 0, tzinfo=timezone.utc),
                    )
                ]
            ),
            SimpleNamespace(
                fetchone=lambda: SimpleNamespace(
                    root_date=date(2026, 2, 8),
                    merkle_root="root_hash",
                    signed_root="root_sig",
                    signature_alg="hmac-sha256",
                    signature_key_id="key_main",
                )
            ),
        ]
    )

    fake_storage = SimpleNamespace(create_presigned_url=AsyncMock(return_value="https://signed"))

    with (
        patch("src.trust.products.get_db_session", lambda: _FakeSessionContext(session)),
        patch("src.trust.products.set_rls_context", lambda *_args, **_kwargs: None),
        patch("src.trust.products.get_evidence_storage", lambda: fake_storage),
    ):
        result = await products.export_evidence_bundle(
            organization_id="org_test",
            uio_ids=["uio_1"],
            evidence_ids=["evh_1"],
            include_presigned_urls=True,
        )

    assert result["bundle_id"].startswith("bundle_")
    assert result["bundle"]["artifact_count"] == 2
    assert len(result["bundle"]["quoted_evidence"]) == 1
    assert result["bundle"]["artifacts"][0]["presigned_url"] == "https://signed"
    assert result["bundle"]["custody_anchor"]["merkle_root"] == "root_hash"


@pytest.mark.asyncio
async def test_export_governance_bundle_aggregates_integrity_and_controls() -> None:
    with (
        patch(
            "src.trust.products.compute_continuity_score",
            AsyncMock(return_value={"score": 91.2, "score_normalized": 0.912}),
        ),
        patch(
            "src.trust.products.get_retention_profile",
            AsyncMock(
                return_value={
                    "organization_id": "org_test",
                    "data_retention_days": 365,
                    "evidence_retention_days": 3650,
                }
            ),
        ),
        patch(
            "src.trust.products.get_org_security_policy",
            AsyncMock(
                return_value=SimpleNamespace(
                    to_dict=lambda: {
                        "organization_id": "org_test",
                        "evidence_masking_enabled": True,
                    }
                )
            ),
        ),
        patch(
            "src.trust.products._audit_integrity_summary",
            AsyncMock(return_value={"valid": True, "total_entries": 12, "invalid_entries": []}),
        ),
        patch(
            "src.trust.products._latest_custody_anchor",
            AsyncMock(return_value={"root_date": "2026-02-23", "merkle_root": "root_hash"}),
        ),
        patch(
            "src.trust.products.export_evidence_bundle",
            AsyncMock(return_value={"bundle_id": "bundle_demo"}),
        ),
    ):
        result = await products.export_governance_bundle(
            organization_id="org_test",
            include_evidence_bundle=True,
            uio_ids=["uio_1"],
        )

    assert result["bundle_id"].startswith("governance_")
    assert result["bundle"]["controls"]["org_security_policy"]["organization_id"] == "org_test"
    assert result["bundle"]["integrity"]["audit_ledger"]["valid"] is True
    assert result["bundle"]["integrity"]["custody_anchor"]["merkle_root"] == "root_hash"
    assert result["bundle"]["evidence_bundle"]["bundle_id"] == "bundle_demo"
    assert len(result["payload_hash"]) == 64
    assert len(result["signature"]) == 64
