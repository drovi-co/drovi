from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


@asynccontextmanager
async def _fake_session(session):
    yield session


class TestContinuumWriteFreeze:
    async def test_create_continuum_returns_gone(self, async_client):
        response = await async_client.post(
            "/api/v1/continuums",
            json={
                "organization_id": "org_test",
                "definition": {
                    "name": "Legacy",
                    "goal": "Legacy flow",
                    "schedule": {"type": "on_demand"},
                    "steps": [{"id": "s1", "name": "Step", "action": "workflow:intelligence_brief", "inputs": {}}],
                },
            },
        )
        assert response.status_code == 410
        assert "decommissioned" in response.json()["detail"].lower()

    async def test_run_continuum_returns_gone(self, async_client):
        response = await async_client.post(
            "/api/v1/continuums/cont_legacy/run",
            json={"organization_id": "org_test", "triggered_by": "manual"},
        )
        assert response.status_code == 410

    async def test_publish_exchange_bundle_returns_gone(self, async_client):
        response = await async_client.post(
            "/api/v1/continuum-exchange/bundles/publish",
            json={
                "organization_id": "org_test",
                "manifest": {
                    "name": "Legacy Bundle",
                    "version": "1.0.0",
                    "description": "deprecated",
                    "continuum_definition": {
                        "name": "Legacy",
                        "goal": "Legacy flow",
                        "schedule": {"type": "on_demand"},
                        "steps": [
                            {"id": "s1", "name": "Step", "action": "workflow:intelligence_brief", "inputs": {}}
                        ],
                    },
                },
            },
        )
        assert response.status_code == 410


class TestLegacyMigrationEndpoints:
    async def test_list_legacy_continuums(self, async_client):
        with patch(
            "src.api.routes.agents_control_plane._continuum_migration_service.list_legacy_continuums",
            AsyncMock(
                return_value=[
                    {
                        "id": "cont_1",
                        "organization_id": "org_test",
                        "name": "Legacy Flow",
                        "description": "legacy",
                        "status": "active",
                        "current_version": 2,
                        "active_version": 2,
                        "updated_at": datetime(2026, 2, 14, tzinfo=timezone.utc),
                        "definition_hash": "abc",
                        "version_created_at": datetime(2026, 2, 13, tzinfo=timezone.utc),
                    }
                ]
            ),
        ) as mocked:
            response = await async_client.get(
                "/api/v1/agents/control/legacy/continuums",
                params={"organization_id": "org_test"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["id"] == "cont_1"
        assert payload[0]["status"] == "active"
        mocked.assert_awaited_once()

    async def test_migrate_legacy_continuums_dry_run(self, async_client):
        with patch(
            "src.api.routes.agents_control_plane._continuum_migration_service.migrate_continuums",
            AsyncMock(
                return_value=[
                    {
                        "migration_id": "agmig_1",
                        "continuum_id": "cont_1",
                        "continuum_version": 2,
                        "mode": "dry_run",
                        "migration_status": "completed",
                        "equivalence_score": 0.98,
                        "equivalence_report": {"score_breakdown": {"steps": 1.0}},
                        "role_id": None,
                        "profile_id": None,
                        "playbook_id": None,
                        "deployment_id": None,
                        "trigger_id": None,
                    }
                ]
            ),
        ) as mocked:
            response = await async_client.post(
                "/api/v1/agents/control/legacy/continuums/migrate",
                json={
                    "organization_id": "org_test",
                    "continuum_ids": ["cont_1"],
                    "dry_run": True,
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["mode"] == "dry_run"
        assert payload[0]["equivalence_score"] == pytest.approx(0.98)
        mocked.assert_awaited_once()

    async def test_shadow_validate_endpoint(self, async_client):
        with patch(
            "src.api.routes.agents_control_plane._continuum_migration_service.run_shadow_validation",
            AsyncMock(
                return_value=[
                    {
                        "id": "agshadow_1",
                        "organization_id": "org_test",
                        "continuum_id": "cont_1",
                        "migration_id": "agmig_1",
                        "window_start": datetime(2026, 2, 1, tzinfo=timezone.utc),
                        "window_end": datetime(2026, 2, 14, tzinfo=timezone.utc),
                        "continuum_run_count": 20,
                        "agent_run_count": 19,
                        "status_parity": 0.96,
                        "duration_parity": 0.91,
                        "score": 0.94,
                        "report": {"status_parity": 0.96},
                        "created_by_user_id": "user_test",
                        "created_at": datetime(2026, 2, 14, tzinfo=timezone.utc),
                    }
                ]
            ),
        ) as mocked:
            response = await async_client.post(
                "/api/v1/agents/control/legacy/continuums/shadow-validate",
                json={
                    "organization_id": "org_test",
                    "continuum_ids": ["cont_1"],
                    "lookback_days": 14,
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["score"] == pytest.approx(0.94)
        mocked.assert_awaited_once()


class TestLegacyReadOnlyCompatibility:
    async def test_list_continuums_still_available(self, async_client):
        session = AsyncMock()
        query_result = MagicMock()
        query_result.fetchall.return_value = [
            MagicMock(
                _mapping={
                    "id": "cont_1",
                    "name": "Legacy Flow",
                    "description": "legacy",
                    "status": "active",
                    "current_version": 2,
                    "active_version": 2,
                    "created_at": datetime(2026, 2, 10, tzinfo=timezone.utc),
                    "updated_at": datetime(2026, 2, 14, tzinfo=timezone.utc),
                    "next_run_at": None,
                }
            )
        ]
        session.execute.return_value = query_result

        with patch("src.api.routes.continuums.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get(
                "/api/v1/continuums",
                params={"organization_id": "org_test"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["id"] == "cont_1"

    async def test_history_endpoint_returns_versions(self, async_client):
        session = AsyncMock()
        continuum_result = MagicMock()
        continuum_result.fetchone.return_value = MagicMock(_mapping={"id": "cont_1"}, id="cont_1")
        history_result = MagicMock()
        history_result.fetchall.return_value = [
            MagicMock(
                _mapping={
                    "version": 2,
                    "created_at": datetime(2026, 2, 14, tzinfo=timezone.utc),
                    "created_by": "user_1",
                    "is_active": True,
                    "definition_hash": "hash_v2",
                    "definition": {
                        "name": "Legacy Flow",
                        "goal": "Track tasks",
                        "schedule": {"type": "interval", "interval_minutes": 60},
                    },
                }
            )
        ]
        session.execute = AsyncMock(side_effect=[continuum_result, history_result])

        with patch("src.api.routes.continuums.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get(
                "/api/v1/continuums/cont_1/history",
                params={"organization_id": "org_test"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["version"] == 2
        assert payload[0]["name"] == "Legacy Flow"
