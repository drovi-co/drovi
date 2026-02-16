from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


@asynccontextmanager
async def _fake_session(session):
    yield session


class TestExtensionsCatalog:
    async def test_catalog_exposes_storage_rules(self, async_client):
        response = await async_client.get("/api/v1/extensions/catalog")
        assert response.status_code == 200
        payload = response.json()
        assert "plugins" in payload
        assert "extension_types" in payload
        assert "storage_rules" in payload
        assert payload["storage_rules"]["canonical_spine_table"] == "unified_intelligence_object"


class TestUpsertExtension:
    async def test_upsert_extension_calls_service(self, async_client):
        session = AsyncMock()
        upsert_result = SimpleNamespace(
            plugin_id="legal",
            type_name="legal.matter",
            schema_version="1.0",
            typed_table="legal_matter",
        )
        with patch("src.api.routes.extensions.get_db_session", lambda: _fake_session(session)), patch(
            "src.api.routes.extensions.upsert_uio_extension",
            AsyncMock(return_value=upsert_result),
        ) as mock_upsert:
            response = await async_client.post(
                "/api/v1/extensions/uio_123?organization_id=org_test",
                json={"type": "legal.matter", "payload": {"client_name": "Acme"}},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["plugin_id"] == "legal"
        assert payload["typed_table"] == "legal_matter"
        mock_upsert.assert_awaited_once()
        session.commit.assert_awaited_once()

