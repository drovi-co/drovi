from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _row(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(_mapping=payload, **payload)


@asynccontextmanager
async def _fake_session(session):
    yield session


class TestTriggerRoutingEndpoint:
    async def test_trigger_simulation_resolves_precedence(self, async_client):
        session = AsyncMock()
        trigger_result = MagicMock()
        trigger_result.fetchall.return_value = [
            _row(
                {
                    "id": "agtrg_low",
                    "organization_id": "org_test",
                    "deployment_id": "agdep_low",
                    "trigger_type": "event",
                    "trigger_spec": {"events": ["ticket.created"], "priority": 1},
                    "is_enabled": True,
                    "updated_at": datetime(2026, 2, 13, tzinfo=timezone.utc),
                    "deployment_status": "canary",
                }
            ),
            _row(
                {
                    "id": "agtrg_high",
                    "organization_id": "org_test",
                    "deployment_id": "agdep_high",
                    "trigger_type": "event",
                    "trigger_spec": {"event_name": "ticket.created", "priority": 5},
                    "is_enabled": True,
                    "updated_at": datetime(2026, 2, 13, tzinfo=timezone.utc),
                    "deployment_status": "active",
                }
            ),
        ]
        session.execute.return_value = trigger_result

        with patch("src.agentos.control_plane.registry.get_db_session", lambda: _fake_session(session)):
            response = await async_client.post(
                "/api/v1/agents/control/trigger-simulate",
                json={
                    "organization_id": "org_test",
                    "trigger_type": "event",
                    "event_name": "ticket.created",
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["selected"]["trigger_id"] == "agtrg_high"
        assert payload["candidates"][0]["score"] > payload["candidates"][1]["score"]

    async def test_create_trigger_rejects_invalid_trigger_type(self, async_client):
        response = await async_client.post(
            "/api/v1/agents/triggers",
            json={
                "organization_id": "org_test",
                "deployment_id": "agdep_1",
                "trigger_type": "timer",
                "trigger_spec": {},
            },
        )
        assert response.status_code == 422


class TestConfigLintEndpoint:
    async def test_lint_config_returns_policy_and_schema_errors(self, async_client):
        session = AsyncMock()

        deployment_result = MagicMock()
        deployment_result.fetchone.return_value = _row(
            {
                "id": "agdep_1",
                "organization_id": "org_test",
                "role_id": "agrole_1",
                "profile_id": "agprof_1",
                "playbook_id": "agplay_1",
                "version": 1,
                "status": "draft",
                "rollout_strategy": {},
                "snapshot_hash": "placeholder",
                "published_at": None,
                "created_by_user_id": "user_a",
                "created_at": datetime(2026, 2, 13, tzinfo=timezone.utc),
                "updated_at": datetime(2026, 2, 13, tzinfo=timezone.utc),
            }
        )

        role_result = MagicMock()
        role_result.fetchone.return_value = _row(
            {
                "id": "agrole_1",
                "organization_id": "org_test",
                "role_key": "legal.sentinel",
                "name": "Legal Sentinel",
                "description": None,
                "domain": "legal",
                "status": "active",
                "metadata": {},
            }
        )

        profile_result = MagicMock()
        profile_result.fetchone.return_value = _row(
            {
                "id": "agprof_1",
                "organization_id": "org_test",
                "role_id": "agrole_1",
                "name": "Legal Profile",
                "autonomy_tier": "L3",
                "model_policy": {},
                "tool_policy": {"deny_tools": ["email"]},
                "permission_scope": {
                    "tools": ["email"],
                    "sources": ["emails"],
                    "channels": ["email"],
                    "allow_external_send": True,
                    "allowed_domains": [],
                },
                "metadata": {},
            }
        )

        playbook_result = MagicMock()
        playbook_result.fetchone.return_value = _row(
            {
                "id": "agplay_1",
                "organization_id": "org_test",
                "role_id": "agrole_1",
                "version": 3,
                "name": "Advice Timeline",
                "objective": "Track legal advice drift.",
                "constraints": {
                    "required_tools": ["ghost_tool"],
                    "required_read_scopes": ["matter.timeline"],
                },
                "sop": {"steps": [{"id": "s1", "action": "ghost_tool"}]},
                "success_criteria": {},
                "escalation_policy": {},
                "dsl": {},
                "status": "draft",
            }
        )

        memory_result = MagicMock()
        memory_result.fetchone.return_value = _row(
            {
                "readable_scopes": [],
                "writable_scopes": [],
                "retention_policy": {},
            }
        )

        org_result = MagicMock()
        org_result.fetchone.return_value = _row(
            {
                "id": "org_test",
                "allowed_connectors": None,
                "default_connection_visibility": "org_shared",
            }
        )

        session.execute = AsyncMock(
            side_effect=[
                deployment_result,
                role_result,
                profile_result,
                playbook_result,
                memory_result,
                org_result,
            ]
        )

        with patch("src.agentos.control_plane.registry.get_db_session", lambda: _fake_session(session)):
            response = await async_client.post(
                "/api/v1/agents/control/lint-config",
                json={"organization_id": "org_test", "deployment_id": "agdep_1"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["valid"] is False
        assert any("Unknown required tools" in error for error in payload["errors"])
        assert any("Missing readable memory scopes" in error for error in payload["errors"])

