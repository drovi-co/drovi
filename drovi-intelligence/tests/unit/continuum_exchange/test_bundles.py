from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.continuum_exchange.bundles import BundleManifest, install_bundle, sign_manifest, verify_manifest


def test_sign_manifest_roundtrip():
    manifest = BundleManifest(
        name="Renewal Guardian",
        version="1.0.0",
        description="Demo",
        continuum_definition={
            "name": "Renewals",
            "goal": "Track renewals",
            "schedule": {"type": "interval", "interval_minutes": 60},
            "steps": [
                {"id": "scan", "name": "Scan", "action": "workflow:scan", "inputs": {}},
            ],
        },
    )
    signature = sign_manifest(manifest, "secret")
    assert verify_manifest(manifest, signature, "secret")


@pytest.mark.asyncio
async def test_install_bundle_rejects_missing_driver():
    manifest = BundleManifest(
        name="Revenue Watch",
        version="1.0.0",
        description="Demo",
        continuum_definition={
            "name": "Revenue",
            "goal": "Track revenue",
            "schedule": {"type": "interval", "interval_minutes": 60},
            "steps": [
                {"id": "scan", "name": "Scan", "action": "workflow:scan", "inputs": {}},
            ],
        },
        required_drivers=["slack"],
    )
    signature = sign_manifest(manifest, "dev-exchange-secret")
    row = SimpleNamespace(
        id="version_1",
        manifest=manifest.model_dump(),
        signature=signature,
        version="1.0.0",
        visibility="public",
        governance_status="approved",
        organization_id="org_1",
    )

    result = MagicMock()
    result.fetchone.return_value = row

    session = AsyncMock()
    session.execute.side_effect = [result, AsyncMock()]

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.continuum_exchange.bundles.get_db_session", fake_session), patch(
        "src.continuum_exchange.bundles.list_drivers",
        return_value=[],
    ):
        with pytest.raises(ValueError, match="Missing required drivers"):
            await install_bundle(
                organization_id="org_1",
                bundle_id="bundle_1",
                version=None,
                installed_by="user_1",
            )
