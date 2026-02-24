from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.api.routes import trust as trust_route
from src.auth.context import AuthMetadata, AuthType
from src.auth.middleware import APIKeyContext

pytestmark = [pytest.mark.unit]


def _ctx(*, scopes: list[str]) -> APIKeyContext:
    return APIKeyContext(
        organization_id="org_test",
        auth_subject_id="user_test",
        scopes=scopes,
        metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
    )


@pytest.mark.asyncio
async def test_record_certificate_requires_admin_scope() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await trust_route.record_certificate(
            uio_id="uio_123",
            organization_id="org_test",
            evidence_limit=10,
            ctx=_ctx(scopes=["read"]),
        )

    assert exc_info.value.status_code == 403
    assert "Admin scope required" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_monthly_integrity_report_requires_admin_scope() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await trust_route.integrity_report_monthly(
            organization_id="org_test",
            month="2026-02",
            ctx=_ctx(scopes=["read"]),
        )

    assert exc_info.value.status_code == 403
    assert "Admin scope required" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_record_certificate_allows_admin_scope() -> None:
    expected = {"certificate_id": "cert_demo"}
    with patch(
        "src.api.routes.trust.generate_record_certificate",
        AsyncMock(return_value=expected),
    ) as certificate_mock:
        response = await trust_route.record_certificate(
            uio_id="uio_123",
            organization_id="org_test",
            evidence_limit=10,
            ctx=_ctx(scopes=["admin"]),
        )

    assert response == expected
    certificate_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_governance_bundle_requires_admin_scope() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await trust_route.governance_bundle_export(
            request=trust_route.GovernanceBundleRequest(organization_id="org_test"),
            ctx=_ctx(scopes=["read"]),
        )

    assert exc_info.value.status_code == 403
    assert "Admin scope required" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_governance_bundle_allows_admin_scope() -> None:
    expected = {"bundle_id": "governance_demo"}
    with patch(
        "src.api.routes.trust.export_governance_bundle",
        AsyncMock(return_value=expected),
    ) as export_mock:
        response = await trust_route.governance_bundle_export(
            request=trust_route.GovernanceBundleRequest(
                organization_id="org_test",
                include_evidence_bundle=True,
                uio_ids=["uio_1"],
            ),
            ctx=_ctx(scopes=["admin"]),
        )

    assert response == expected
    export_mock.assert_awaited_once()
