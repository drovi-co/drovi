from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import src.api.routes.agents_teams as agents_teams_route
import src.api.routes.agents_starter_packs as agents_starter_packs_route
import src.api.routes.agents_governance as agents_governance_route
import src.api.routes.agents_playbooks_deployments as agents_playbooks_route
import src.api.routes.agents_quality_optimization as agents_quality_route
import src.api.routes.agents_tools_policy as agents_tools_policy_route
import src.api.routes.agents_work_products as agents_work_products_route
from src.agentos.orchestration import TeamMemberSpec
from src.agentos.orchestration.service import TeamRecord
from src.agentos.control_plane.models import (
    ActionReceiptRecord,
    AgentServicePrincipalRecord,
    ApprovalDecisionRecord,
    ApprovalRequestRecord,
    DelegatedAuthorityRecord,
    GovernancePolicyRecord,
    PolicyDecisionRecord,
)
from src.agentos.control_plane.red_team import RedTeamRunResult
from src.agentos.quality.models import (
    CalibrationSnapshot,
    OfflineEvalMetricResult,
    OfflineEvalRunResult,
    QualityRecommendationRecord,
    QualityTrendResponse,
    RegressionGateEvaluation,
    RegressionGateEvaluationResponse,
    RegressionGateRecord,
    RunQualityScoreRecord,
)
from src.agentos.starter_packs.models import (
    StarterPackEvalMetricResult,
    StarterPackEvalRunResponse,
    StarterPackEvalSuiteSpec,
    StarterPackSeedDemoResponse,
    StarterPackTemplateModel,
)
from src.agentos.work_products.models import WorkProductDeliveryResult, WorkProductRecord
from src.auth.context import AuthMetadata, AuthType
from src.auth.middleware import APIKeyContext, get_api_key_context, get_auth_context

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _row(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(_mapping=payload, **payload)


@asynccontextmanager
async def _fake_session(session):
    yield session


def _session_ctx(org_id: str = "org_test") -> APIKeyContext:
    return APIKeyContext(
        organization_id=org_id,
        auth_subject_id="user_user_a",
        scopes=["read", "write"],
        metadata=AuthMetadata(
            auth_type=AuthType.SESSION,
            user_email="pilot@example.com",
            user_id="user_a",
            key_id="session:user_a",
            key_name="Session",
        ),
        is_internal=False,
        rate_limit_per_minute=1000,
    )


class TestAgentRoles:
    async def test_list_roles_returns_rows(self, async_client):
        session = AsyncMock()
        roles_result = MagicMock()
        roles_result.fetchall.return_value = [
            _row(
                {
                    "id": "agrole_1",
                    "organization_id": "org_test",
                    "role_key": "sales.sdr",
                    "name": "SDR Agent",
                    "description": "Outbound sales agent",
                    "domain": "sales",
                    "status": "active",
                    "metadata": {"tier": "starter"},
                    "created_by_user_id": "user_a",
                    "created_at": "2026-02-13T00:00:00Z",
                    "updated_at": "2026-02-13T00:00:00Z",
                }
            )
        ]
        session.execute.return_value = roles_result

        with patch("src.api.routes.agents_roles_profiles.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get("/api/v1/agents/roles", params={"organization_id": "org_test"})

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["id"] == "agrole_1"
        assert body[0]["role_key"] == "sales.sdr"

    async def test_list_roles_rejects_cross_org_for_session_auth(self, app, async_client):
        async def fake_ctx():
            return _session_ctx(org_id="org_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.get("/api/v1/agents/roles", params={"organization_id": "org_b"})
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]


class TestProfiles:
    async def test_create_profile_rejects_invalid_channel_value(self, async_client):
        response = await async_client.post(
            "/api/v1/agents/profiles",
            json={
                "organization_id": "org_test",
                "role_id": "agrole_1",
                "name": "Ops profile",
                "autonomy_tier": "L2",
                "permission_scope": {"channels": ["sms"]},
            },
        )
        assert response.status_code == 422


class TestPlaybookLint:
    async def test_lint_playbook_reports_missing_controls(self, async_client):
        response = await async_client.post(
            "/api/v1/agents/playbooks/lint",
            json={
                "objective": "short",
                "sop": {},
                "constraints": {},
                "success_criteria": {},
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["valid"] is False
        assert "objective must contain at least 10 characters" in payload["errors"]
        assert any("forbidden_tools" in warning for warning in payload["warnings"])


class TestDeployments:
    async def test_promote_deployment_transitions_to_active(self, async_client):
        session = AsyncMock()
        select_result = MagicMock()
        select_result.fetchone.return_value = _row(
            {"organization_id": "org_test", "role_id": "agrole_1"}
        )
        update_result = MagicMock()
        session.execute = AsyncMock(side_effect=[select_result, update_result])
        gate_response = RegressionGateEvaluationResponse(
            organization_id="org_test",
            role_id="agrole_1",
            deployment_id="agdep_1",
            evaluated_at="2026-02-14T00:00:00Z",
            blocked=False,
            evaluations=[],
        )

        with (
            patch("src.api.routes.agents_playbooks_deployments.get_db_session", lambda: _fake_session(session)),
            patch.object(
                agents_playbooks_route._regression_gate_service,
                "evaluate",
                AsyncMock(return_value=gate_response),
            ),
        ):
            response = await async_client.post("/api/v1/agents/deployments/agdep_1/promote")

        assert response.status_code == 200
        payload = response.json()
        assert payload["deployment_id"] == "agdep_1"
        assert payload["status"] == "active"
        session.commit.assert_awaited_once()

    async def test_promote_deployment_blocks_when_quality_gate_fails(self, async_client):
        session = AsyncMock()
        select_result = MagicMock()
        select_result.fetchone.return_value = _row(
            {"organization_id": "org_test", "role_id": "agrole_1"}
        )
        session.execute = AsyncMock(side_effect=[select_result])
        gate_response = RegressionGateEvaluationResponse(
            organization_id="org_test",
            role_id="agrole_1",
            deployment_id="agdep_1",
            evaluated_at="2026-02-14T00:00:00Z",
            blocked=True,
            evaluations=[
                RegressionGateEvaluation(
                    gate_id="aggate_1",
                    metric_name="quality_score",
                    comparator="max_drop",
                    threshold=0.1,
                    baseline_value=0.84,
                    current_value=0.61,
                    delta_value=-0.23,
                    sample_count=20,
                    verdict="block",
                    blocked=True,
                    severity="blocker",
                    metadata={},
                )
            ],
        )

        with (
            patch("src.api.routes.agents_playbooks_deployments.get_db_session", lambda: _fake_session(session)),
            patch.object(
                agents_playbooks_route._regression_gate_service,
                "evaluate",
                AsyncMock(return_value=gate_response),
            ),
        ):
            response = await async_client.post("/api/v1/agents/deployments/agdep_1/promote")

        assert response.status_code == 409
        payload = response.json()
        assert payload["detail"]["code"] == "quality_regression_gate_blocked"


class TestRunsReplay:
    async def test_replay_returns_run_and_steps(self, async_client):
        session = AsyncMock()

        run_result = MagicMock()
        run_result.fetchone.return_value = _row(
            {
                "id": "agrun_1",
                "organization_id": "org_test",
                "deployment_id": "agdep_1",
                "trigger_id": None,
                "status": "completed",
                "initiated_by": "agent",
                "started_at": "2026-02-13T00:00:00Z",
                "completed_at": "2026-02-13T00:01:00Z",
                "failure_reason": None,
                "metadata": {"source": "email"},
                "created_at": "2026-02-13T00:00:00Z",
                "updated_at": "2026-02-13T00:01:00Z",
            }
        )

        steps_result = MagicMock()
        steps_result.fetchall.return_value = [
            _row(
                {
                    "id": "step_1",
                    "run_id": "agrun_1",
                    "organization_id": "org_test",
                    "step_index": 1,
                    "step_type": "retrieve_context",
                    "status": "completed",
                    "input_payload": {},
                    "output_payload": {"items": 3},
                    "evidence_refs": {"count": 2},
                    "started_at": "2026-02-13T00:00:00Z",
                    "completed_at": "2026-02-13T00:00:05Z",
                    "created_at": "2026-02-13T00:00:00Z",
                }
            )
        ]
        handoff_result = MagicMock()
        handoff_result.fetchall.return_value = []
        child_runs_result = MagicMock()
        child_runs_result.fetchall.return_value = []
        session.execute = AsyncMock(side_effect=[run_result, steps_result, handoff_result, child_runs_result])

        with patch("src.api.routes.agents_runs_quality.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get("/api/v1/agents/runs/agrun_1/replay")

        assert response.status_code == 200
        payload = response.json()
        assert payload["run"]["id"] == "agrun_1"
        assert len(payload["steps"]) == 1
        assert payload["steps"][0]["step_type"] == "retrieve_context"

    async def test_replay_includes_handoffs_and_child_runs(self, async_client):
        session = AsyncMock()

        run_result = MagicMock()
        run_result.fetchone.return_value = _row(
            {
                "id": "agrun_parent",
                "organization_id": "org_test",
                "deployment_id": "agdep_parent",
                "trigger_id": None,
                "status": "running",
                "initiated_by": "user_a",
                "started_at": "2026-02-13T00:00:00Z",
                "completed_at": None,
                "failure_reason": None,
                "metadata": {"runtime": "temporal"},
                "created_at": "2026-02-13T00:00:00Z",
                "updated_at": "2026-02-13T00:00:05Z",
            }
        )

        steps_result = MagicMock()
        steps_result.fetchall.return_value = []

        handoff_result = MagicMock()
        handoff_result.fetchall.return_value = [
            _row(
                {
                    "id": "handoff_1",
                    "organization_id": "org_test",
                    "parent_run_id": "agrun_parent",
                    "child_run_id": "agrun_child",
                    "from_role_id": "agrole_planner",
                    "to_role_id": "agrole_executor",
                    "reason": "stage_dependency",
                    "metadata": {"stage_index": 1},
                    "created_at": "2026-02-13T00:00:01Z",
                }
            )
        ]

        children_result = MagicMock()
        children_result.fetchall.return_value = [
            _row(
                {
                    "id": "agrun_child",
                    "organization_id": "org_test",
                    "deployment_id": "agdep_child",
                    "trigger_id": None,
                    "status": "accepted",
                    "initiated_by": "user_a",
                    "started_at": None,
                    "completed_at": None,
                    "failure_reason": None,
                    "metadata": {"parent_run_id": "agrun_parent"},
                    "created_at": "2026-02-13T00:00:01Z",
                    "updated_at": "2026-02-13T00:00:01Z",
                }
            )
        ]
        session.execute = AsyncMock(side_effect=[run_result, steps_result, handoff_result, children_result])

        with patch("src.api.routes.agents_runs_quality.get_db_session", lambda: _fake_session(session)):
            response = await async_client.get("/api/v1/agents/runs/agrun_parent/replay")

        assert response.status_code == 200
        payload = response.json()
        assert payload["run"]["id"] == "agrun_parent"
        assert len(payload["handoffs"]) == 1
        assert payload["handoffs"][0]["child_run_id"] == "agrun_child"
        assert len(payload["child_runs"]) == 1
        assert payload["child_runs"][0]["id"] == "agrun_child"


class TestTeams:
    async def test_dispatch_team_run_creates_plan_and_starts_monitor(self, async_client):
        session = AsyncMock()
        session.execute = AsyncMock(return_value=MagicMock())

        team = TeamRecord(
            id="agteam_1",
            organization_id="org_test",
            name="Revenue Team",
            description=None,
            metadata={},
            created_by_user_id="user_a",
            created_at="2026-02-13T00:00:00Z",
            updated_at="2026-02-13T00:00:00Z",
        )
        members = [
            TeamMemberSpec(role_id="agrole_planner", role_name="Planner", priority=1, is_required=True, stage=0),
            TeamMemberSpec(role_id="agrole_executor", role_name="Executor", priority=2, is_required=True, stage=1),
        ]

        monitor = AsyncMock()
        emit_audit = AsyncMock()
        with (
            patch("src.api.routes.agents_teams.get_db_session", lambda: _fake_session(session)),
            patch.object(
                agents_teams_route._team_service,
                "get_team",
                AsyncMock(return_value=team),
            ),
            patch.object(
                agents_teams_route._team_service,
                "list_team_members",
                AsyncMock(return_value=members),
            ),
            patch.object(
                agents_teams_route._team_service,
                "resolve_role_deployments",
                AsyncMock(
                    return_value={
                        "agrole_planner": "agdep_planner",
                        "agrole_executor": "agdep_executor",
                    }
                ),
            ),
            patch("src.api.routes.agents_teams.start_team_monitor_workflow", monitor),
            patch("src.api.routes.agents_teams.emit_control_plane_audit_event", emit_audit),
        ):
            response = await async_client.post(
                "/api/v1/agents/teams/agteam_1/runs",
                json={
                    "organization_id": "org_test",
                    "objective": "Prepare renewal strategy for all Q2 accounts",
                    "execution_policy": {"mode": "sequential", "dependency_failure_policy": "halt"},
                    "conflict_resolution": {"strategy": "required_roles_must_succeed"},
                    "budget": {"max_sub_runs": 10, "max_parallel": 2},
                    "guardrails": {"blocked_tools": []},
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "accepted"
        assert payload["plan"]["team_id"] == "agteam_1"
        assert len(payload["plan"]["children"]) == 2
        assert payload["plan"]["children"][1]["dependencies"] == [payload["plan"]["children"][0]["child_run_id"]]
        monitor.assert_awaited_once()


class TestRunControls:
    async def test_create_run_passes_runtime_overrides_to_workflow(self, async_client):
        session = AsyncMock()
        insert_result = MagicMock()
        select_result = MagicMock()
        select_result.fetchone.return_value = _row(
            {
                "id": "agrun_1",
                "organization_id": "org_test",
                "deployment_id": "agdep_1",
                "trigger_id": None,
                "status": "accepted",
                "initiated_by": "user_a",
                "started_at": None,
                "completed_at": None,
                "failure_reason": None,
                "metadata": {"runtime": "temporal"},
                "created_at": "2026-02-13T00:00:00Z",
                "updated_at": "2026-02-13T00:00:00Z",
            }
        )
        session.execute = AsyncMock(side_effect=[insert_result, select_result])

        start_workflow = AsyncMock()
        emit_audit = AsyncMock()
        with (
            patch("src.api.routes.agents_runs_quality.get_db_session", lambda: _fake_session(session)),
            patch("src.api.routes.agents_runs_quality._start_agent_run_workflow", start_workflow),
            patch("src.api.routes.agents_runs_quality.emit_control_plane_audit_event", emit_audit),
        ):
            response = await async_client.post(
                "/api/v1/agents/runs",
                json={
                    "organization_id": "org_test",
                    "deployment_id": "agdep_1",
                    "payload": {"task": "do work"},
                    "org_concurrency_cap": 6,
                    "lane_ttl_seconds": 180,
                    "lane_max_attempts": 300,
                    "lane_retry_seconds": 3,
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["id"] == "agrun_1"
        start_workflow.assert_awaited_once()
        kwargs = start_workflow.await_args.kwargs
        assert kwargs["org_concurrency_cap"] == 6
        assert kwargs["lane_ttl_seconds"] == 180
        assert kwargs["lane_max_attempts"] == 300
        assert kwargs["lane_retry_seconds"] == 3

    async def test_kill_run_signals_temporal_and_updates_status(self, async_client):
        session = AsyncMock()
        session.execute = AsyncMock(return_value=MagicMock())

        handle = SimpleNamespace(signal=AsyncMock())
        temporal_client = SimpleNamespace(get_workflow_handle=MagicMock(return_value=handle))

        emit_audit = AsyncMock()
        with (
            patch("src.api.routes.agents_runs_quality.get_db_session", lambda: _fake_session(session)),
            patch("src.api.routes.agents_runs_quality.get_settings", return_value=SimpleNamespace(temporal_enabled=True)),
            patch("src.api.routes.agents_runs_quality.get_temporal_client", AsyncMock(return_value=temporal_client)),
            patch("src.api.routes.agents_runs_quality.emit_control_plane_audit_event", emit_audit),
        ):
            response = await async_client.post(
                "/api/v1/agents/runs/agrun_1/kill",
                json={"organization_id": "org_test", "reason": "operator abort"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["run_id"] == "agrun_1"
        assert payload["status"] == "failed"
        handle.signal.assert_awaited_once_with("kill")
        session.commit.assert_awaited_once()


class TestWorkProducts:
    async def test_list_work_products_returns_service_rows(self, async_client):
        records = [
            WorkProductRecord(
                id="agwp_1",
                organization_id="org_test",
                run_id="agrun_1",
                product_type="doc",
                title="Advice timeline",
                status="generated",
                artifact_ref="evh_1",
                payload={},
                created_at="2026-02-13T00:00:00Z",
                updated_at="2026-02-13T00:00:00Z",
            )
        ]
        with patch.object(
            agents_work_products_route._service,
            "list_work_products",
            AsyncMock(return_value=records),
        ) as list_mock:
            response = await async_client.get(
                "/api/v1/agents/work-products",
                params={"organization_id": "org_test", "run_id": "agrun_1"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert len(payload) == 1
        assert payload[0]["id"] == "agwp_1"
        list_mock.assert_awaited_once()

    async def test_create_work_product_maps_service_value_error_to_404(self, async_client):
        with patch.object(
            agents_work_products_route._service,
            "generate_work_product",
            AsyncMock(side_effect=ValueError("Run not found for work product generation")),
        ):
            response = await async_client.post(
                "/api/v1/agents/work-products",
                json={
                    "organization_id": "org_test",
                    "run_id": "agrun_missing",
                    "product_type": "doc",
                    "title": "Advice timeline",
                    "input_payload": {"sections": ["Overview"]},
                },
            )

        assert response.status_code == 404
        assert "Run not found" in response.json()["detail"]

    async def test_deliver_work_product_returns_delivery_result(self, async_client):
        delivery = WorkProductDeliveryResult(
            work_product_id="agwp_1",
            status="delivered",
            delivery_channel="share_link",
            details={"url": "https://example.com/artifact"},
        )
        with patch.object(
            agents_work_products_route._service,
            "deliver_work_product",
            AsyncMock(return_value=delivery),
        ) as deliver_mock:
            response = await async_client.post(
                "/api/v1/agents/work-products/agwp_1/deliver",
                json={
                    "organization_id": "org_test",
                    "channel": "share_link",
                    "approval_tier": "medium",
                },
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "delivered"
        assert payload["details"]["url"] == "https://example.com/artifact"
        deliver_mock.assert_awaited_once()


class TestStarterPacks:
    async def test_list_starter_packs(self, async_client):
        templates = [
            StarterPackTemplateModel(
                key="sales_sdr",
                name="Sales SDR Agent",
                summary="summary",
                domain="sales",
                role_key="sales.sdr",
                autonomy_tier="L2",
                default_work_product_type="email",
                eval_suite=StarterPackEvalSuiteSpec(
                    suite_name="sales.sdr.baseline.v1",
                    summary="summary",
                    metrics=[],
                ),
                installed=False,
            )
        ]
        with patch.object(
            agents_starter_packs_route._starter_pack_service,
            "list_templates",
            AsyncMock(return_value=templates),
        ) as list_mock:
            response = await async_client.get(
                "/api/v1/agents/starter-packs",
                params={"organization_id": "org_test"},
            )

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["key"] == "sales_sdr"
        list_mock.assert_awaited_once()

    async def test_install_starter_pack_returns_installation_payload(self, async_client):
        install_payload = {
            "template_key": "sales_sdr",
            "organization_id": "org_test",
            "role_id": "agrole_1",
            "profile_id": "agprof_1",
            "playbook_id": "agplay_1",
            "deployment_id": "agdep_1",
            "created": {"role": True},
        }
        with (
            patch.object(
                agents_starter_packs_route._starter_pack_service,
                "install_template",
                AsyncMock(return_value=install_payload),
            ),
            patch("src.api.routes.agents_starter_packs.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/starter-packs/sales_sdr/install",
                json={"organization_id": "org_test"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["deployment_id"] == "agdep_1"

    async def test_run_starter_pack_eval_returns_results(self, async_client):
        eval_response = StarterPackEvalRunResponse(
            template_key="sales_sdr",
            organization_id="org_test",
            deployment_id="agdep_1",
            suite_name="sales.sdr.baseline.v1",
            passed=True,
            metrics=[
                StarterPackEvalMetricResult(
                    metric_name="run_success_rate",
                    metric_value=0.95,
                    threshold=0.9,
                    comparator="gte",
                    passed=True,
                    description="desc",
                )
            ],
        )
        with (
            patch.object(
                agents_starter_packs_route._starter_pack_service,
                "run_eval_suite",
                AsyncMock(return_value=eval_response),
            ),
            patch("src.api.routes.agents_starter_packs.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/starter-packs/sales_sdr/evals/run",
                json={"organization_id": "org_test"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["passed"] is True
        assert body["metrics"][0]["metric_name"] == "run_success_rate"

    async def test_seed_starter_pack_demo_returns_counts(self, async_client):
        seed_response = StarterPackSeedDemoResponse(
            organization_id="org_test",
            seeded_templates=["sales_sdr", "sales_revops"],
            created_runs=6,
            created_work_products=6,
            created_eval_results=18,
        )
        with (
            patch.object(
                agents_starter_packs_route._starter_pack_service,
                "seed_demo_scenarios",
                AsyncMock(return_value=seed_response),
            ),
            patch("src.api.routes.agents_starter_packs.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/starter-packs/seed-demo",
                json={"organization_id": "org_test", "runs_per_template": 3},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["created_runs"] == 6
        assert body["created_eval_results"] == 18


class TestOrgBoundaryAcrossAgentFamilies:
    @pytest.mark.parametrize(
        ("path", "params"),
        [
            ("/api/v1/agents/roles", {"organization_id": "org_b"}),
            ("/api/v1/agents/profiles", {"organization_id": "org_b"}),
            ("/api/v1/agents/playbooks", {"organization_id": "org_b"}),
            ("/api/v1/agents/deployments", {"organization_id": "org_b"}),
            ("/api/v1/agents/triggers", {"organization_id": "org_b"}),
            ("/api/v1/agents/runs", {"organization_id": "org_b"}),
            ("/api/v1/agents/catalog", {"organization_id": "org_b"}),
            ("/api/v1/agents/evals", {"organization_id": "org_b"}),
            ("/api/v1/agents/feedback", {"organization_id": "org_b"}),
            ("/api/v1/agents/tools/manifests", {"organization_id": "org_b"}),
            ("/api/v1/agents/policies/overlay", {"organization_id": "org_b"}),
            ("/api/v1/agents/governance/policy", {"organization_id": "org_b"}),
            ("/api/v1/agents/approvals", {"organization_id": "org_b"}),
            ("/api/v1/agents/approvals/agapr_1/decisions", {"organization_id": "org_b"}),
            ("/api/v1/agents/receipts", {"organization_id": "org_b"}),
            ("/api/v1/agents/governance/principals", {"organization_id": "org_b"}),
            ("/api/v1/agents/governance/authorities", {"organization_id": "org_b"}),
            ("/api/v1/agents/quality/trends", {"organization_id": "org_b"}),
            ("/api/v1/agents/quality/recommendations", {"organization_id": "org_b"}),
            ("/api/v1/agents/quality/regression-gates", {"organization_id": "org_b"}),
            ("/api/v1/agents/quality/runs/scores", {"organization_id": "org_b"}),
            ("/api/v1/agents/teams", {"organization_id": "org_b"}),
            ("/api/v1/agents/work-products", {"organization_id": "org_b"}),
            ("/api/v1/agents/starter-packs", {"organization_id": "org_b"}),
            ("/api/v1/agents/runs/agrun_1/handoffs", {"organization_id": "org_b"}),
        ],
    )
    async def test_list_endpoints_reject_cross_org(self, app, async_client, path: str, params: dict[str, str]):
        async def fake_ctx():
            return _session_ctx(org_id="org_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.get(path, params=params)
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]

    @pytest.mark.parametrize(
        ("path", "payload"),
        [
            (
                "/api/v1/agents/roles",
                {"organization_id": "org_b", "role_key": "sales.sdr", "name": "SDR"},
            ),
            (
                "/api/v1/agents/profiles",
                {"organization_id": "org_b", "role_id": "agrole_1", "name": "Profile"},
            ),
            (
                "/api/v1/agents/playbooks",
                {"organization_id": "org_b", "role_id": "agrole_1", "name": "Playbook", "objective": "Objective text"},
            ),
            (
                "/api/v1/agents/deployments",
                {
                    "organization_id": "org_b",
                    "role_id": "agrole_1",
                    "profile_id": "agprof_1",
                    "playbook_id": "agplay_1",
                },
            ),
            (
                "/api/v1/agents/triggers",
                {
                    "organization_id": "org_b",
                    "deployment_id": "agdep_1",
                    "trigger_type": "manual",
                },
            ),
            (
                "/api/v1/agents/evals",
                {
                    "organization_id": "org_b",
                    "suite_name": "smoke",
                    "metric_name": "accuracy",
                    "metric_value": 0.8,
                    "passed": True,
                },
            ),
            (
                "/api/v1/agents/feedback",
                {"organization_id": "org_b", "run_id": "agrun_1", "verdict": "accepted"},
            ),
            (
                "/api/v1/agents/approvals",
                {"organization_id": "org_b", "tool_id": "email.send", "action_tier": "external_commit"},
            ),
            (
                "/api/v1/agents/policies/decide",
                {"organization_id": "org_b", "tool_id": "email.send"},
            ),
            (
                "/api/v1/agents/policies/simulate",
                {"organization_id": "org_b", "scenarios": [{"tool_id": "email.send"}]},
            ),
            (
                "/api/v1/agents/policies/red-team/run",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/governance/principals/ensure",
                {"organization_id": "org_b", "deployment_id": "agdep_1"},
            ),
            (
                "/api/v1/agents/governance/authorities",
                {"organization_id": "org_b", "principal_id": "agsp_1"},
            ),
            (
                "/api/v1/agents/governance/authorities/agauth_1/revoke",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/quality/evals/offline/run",
                {
                    "organization_id": "org_b",
                    "suite_name": "offline.sales.smoke",
                    "cases": [
                        {
                            "scenario_id": "case_1",
                            "expected": {"status": "ok"},
                            "observed": {"status": "ok"},
                        }
                    ],
                },
            ),
            (
                "/api/v1/agents/quality/runs/agrun_1/score",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/quality/calibration/recompute",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/quality/recommendations/generate",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/quality/regression-gates",
                {
                    "organization_id": "org_b",
                    "metric_name": "quality_score",
                    "threshold": 0.2,
                },
            ),
            (
                "/api/v1/agents/quality/regression-gates/evaluate",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/teams",
                {"organization_id": "org_b", "name": "Cross Org Team"},
            ),
            (
                "/api/v1/agents/teams/agteam_1/runs",
                {
                    "organization_id": "org_b",
                    "objective": "Cross org dispatch should fail",
                    "execution_policy": {"mode": "parallel"},
                    "conflict_resolution": {"strategy": "best_effort"},
                    "budget": {"max_sub_runs": 5, "max_parallel": 5},
                    "guardrails": {},
                },
            ),
            (
                "/api/v1/agents/work-products",
                {
                    "organization_id": "org_b",
                    "run_id": "agrun_1",
                    "product_type": "doc",
                },
            ),
            (
                "/api/v1/agents/work-products/agwp_1/deliver",
                {
                    "organization_id": "org_b",
                    "channel": "share_link",
                },
            ),
            (
                "/api/v1/agents/starter-packs/sales_sdr/install",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/starter-packs/sales_sdr/evals/run",
                {"organization_id": "org_b"},
            ),
            (
                "/api/v1/agents/starter-packs/seed-demo",
                {"organization_id": "org_b", "runs_per_template": 1},
            ),
        ],
    )
    async def test_create_endpoints_reject_cross_org(self, app, async_client, path: str, payload: dict):
        async def fake_ctx():
            return _session_ctx(org_id="org_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.post(path, json=payload)
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]

    @pytest.mark.parametrize(
        ("path", "payload"),
        [
            (
                "/api/v1/agents/control/trigger-simulate",
                {"organization_id": "org_b", "trigger_type": "manual"},
            ),
            (
                "/api/v1/agents/control/lint-config",
                {"organization_id": "org_b", "deployment_id": "agdep_1"},
            ),
        ],
    )
    async def test_control_plane_post_endpoints_reject_cross_org(self, app, async_client, path: str, payload: dict):
        async def fake_ctx():
            return _session_ctx(org_id="org_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.post(path, json=payload)
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]

    async def test_governance_put_endpoint_rejects_cross_org(self, app, async_client):
        async def fake_ctx():
            return _session_ctx(org_id="org_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.put(
            "/api/v1/agents/governance/policy",
            json={
                "organization_id": "org_b",
                "residency_region": "eu-west-1",
                "allowed_regions": ["eu-west-1"],
                "data_retention_days": 120,
                "evidence_retention_days": 3650,
                "require_residency_enforcement": True,
                "enforce_delegated_authority": False,
                "kill_switch_enabled": False,
            },
        )
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]

    async def test_run_kill_endpoint_rejects_cross_org(self, app, async_client):
        async def fake_ctx():
            return _session_ctx(org_id="org_a")

        app.dependency_overrides[get_api_key_context] = fake_ctx
        app.dependency_overrides[get_auth_context] = fake_ctx

        response = await async_client.post(
            "/api/v1/agents/runs/agrun_1/kill",
            json={"organization_id": "org_b", "reason": "cross-org test"},
        )
        assert response.status_code == 403
        assert "Organization ID mismatch" in response.json()["detail"]


class TestToolPolicyPlane:
    async def test_policy_decide_endpoint_returns_denial_payload(self, async_client):
        decision = PolicyDecisionRecord(
            action="deny",
            code="agentos.policy.no_evidence_no_action",
            reason="No evidence",
            reasons=["missing_evidence"],
            tool_id="crm.update",
            organization_id="org_test",
            deployment_id="agdep_1",
            action_tier="high_risk_write",
            policy_hash="hash_1",
            requires_evidence=True,
            high_stakes=True,
        )
        with patch("src.api.routes.agents_tools_policy._policy_engine.decide", AsyncMock(return_value=decision)):
            response = await async_client.post(
                "/api/v1/agents/policies/decide",
                json={
                    "organization_id": "org_test",
                    "deployment_id": "agdep_1",
                    "tool_id": "crm.update",
                    "evidence_refs": {},
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["action"] == "deny"
        assert body["code"] == "agentos.policy.no_evidence_no_action"

    async def test_approval_create_and_deny_actions(self, async_client):
        created = ApprovalRequestRecord(
            id="agapr_1",
            organization_id="org_test",
            run_id="agrun_1",
            deployment_id="agdep_1",
            tool_id="email.send",
            action_tier="external_commit",
            reason="Needs human review",
            status="pending",
            requested_by="user_a",
            requested_at="2026-02-13T10:00:00Z",
            sla_due_at="2026-02-13T10:15:00Z",
            escalation_path={"target": "manager"},
            approver_id=None,
            approval_reason=None,
            decided_at=None,
            metadata={},
        )
        denied = created.model_copy(
            update={
                "status": "denied",
                "approver_id": "user_a",
                "approval_reason": "Insufficient context",
                "decided_at": "2026-02-13T10:05:00Z",
            }
        )
        with (
            patch("src.api.routes.agents_tools_policy._approvals.create_request", AsyncMock(return_value=created)),
            patch("src.api.routes.agents_tools_policy._approvals.decide_request", AsyncMock(return_value=denied)),
            patch("src.api.routes.agents_tools_policy.emit_control_plane_audit_event", AsyncMock()),
        ):
            create_response = await async_client.post(
                "/api/v1/agents/approvals",
                json={
                    "organization_id": "org_test",
                    "run_id": "agrun_1",
                    "deployment_id": "agdep_1",
                    "tool_id": "email.send",
                    "action_tier": "external_commit",
                    "reason": "Needs human review",
                    "sla_minutes": 15,
                },
            )
            deny_response = await async_client.post(
                "/api/v1/agents/approvals/agapr_1/deny",
                json={"organization_id": "org_test", "reason": "Insufficient context"},
            )

        assert create_response.status_code == 200
        assert create_response.json()["status"] == "pending"
        assert deny_response.status_code == 200
        assert deny_response.json()["status"] == "denied"

    async def test_receipts_list_endpoint(self, async_client):
        receipts = [
            ActionReceiptRecord(
                id="agrcp_1",
                organization_id="org_test",
                run_id="agrun_1",
                deployment_id="agdep_1",
                tool_id="email.send",
                request_payload={"subject": "Hi"},
                evidence_refs={"count": 1},
                policy_result={"action": "allow"},
                approval_request_id=None,
                final_status="completed",
                result_payload={"status": "sent"},
                created_at="2026-02-13T10:00:00Z",
                updated_at="2026-02-13T10:00:30Z",
            )
        ]
        with patch("src.api.routes.agents_tools_policy._receipts.list_receipts", AsyncMock(return_value=receipts)):
            response = await async_client.get("/api/v1/agents/receipts", params={"organization_id": "org_test"})

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["id"] == "agrcp_1"

    async def test_policy_simulation_endpoint_returns_summary(self, async_client):
        decisions = [
            PolicyDecisionRecord(
                action="allow",
                code="agentos.policy.allowed",
                reason="Allowed",
                reasons=["allowed"],
                tool_id="crm.update",
                organization_id="org_test",
                deployment_id="agdep_1",
                action_tier="low_risk_write",
            ),
            PolicyDecisionRecord(
                action="deny",
                code="agentos.policy.kill_switch",
                reason="Blocked",
                reasons=["governance_kill_switch"],
                tool_id="email.send",
                organization_id="org_test",
                deployment_id="agdep_1",
                action_tier="external_commit",
            ),
        ]
        with (
            patch("src.api.routes.agents_tools_policy._policy_engine.decide", AsyncMock(side_effect=decisions)),
            patch("src.api.routes.agents_tools_policy.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/policies/simulate",
                json={
                    "organization_id": "org_test",
                    "deployment_id": "agdep_1",
                    "scenarios": [
                        {"case_id": "c1", "tool_id": "crm.update", "evidence_refs": {"count": 1}},
                        {"case_id": "c2", "tool_id": "email.send", "evidence_refs": {"count": 1}},
                    ],
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert body["summary"]["total"] == 2
        assert body["summary"]["allow"] == 1
        assert body["summary"]["deny"] == 1

    async def test_policy_red_team_endpoint(self, async_client):
        run_result = RedTeamRunResult(
            organization_id="org_test",
            deployment_id="agdep_1",
            passed=True,
            passed_count=4,
            failed_count=0,
            total_count=4,
            results=[],
        )
        with (
            patch.object(agents_tools_policy_route._red_team_harness, "run", AsyncMock(return_value=run_result)),
            patch("src.api.routes.agents_tools_policy.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/policies/red-team/run",
                json={"organization_id": "org_test", "deployment_id": "agdep_1"},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["passed"] is True
        assert body["total_count"] == 4

    async def test_approval_decisions_endpoint(self, async_client):
        decisions = [
            ApprovalDecisionRecord(
                id="agapd_1",
                organization_id="org_test",
                approval_id="agapr_1",
                step_index=1,
                approver_id="user_a",
                decision="approved",
                reason="ok",
                decided_at="2026-02-13T10:01:00Z",
                metadata={},
            )
        ]
        with patch("src.api.routes.agents_tools_policy._approvals.list_decisions", AsyncMock(return_value=decisions)):
            response = await async_client.get(
                "/api/v1/agents/approvals/agapr_1/decisions",
                params={"organization_id": "org_test"},
            )
        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["decision"] == "approved"


class TestAgentGovernanceEndpoints:
    async def test_get_governance_policy_endpoint(self, async_client):
        policy = GovernancePolicyRecord(
            organization_id="org_test",
            residency_region="eu-west-1",
            allowed_regions=["eu-west-1"],
            data_retention_days=90,
            evidence_retention_days=3650,
            require_residency_enforcement=True,
            enforce_delegated_authority=False,
            kill_switch_enabled=False,
            metadata={},
        )
        with patch.object(
            agents_governance_route._governance_policy,
            "get_policy",
            AsyncMock(return_value=policy),
        ):
            response = await async_client.get(
                "/api/v1/agents/governance/policy",
                params={"organization_id": "org_test"},
            )
        assert response.status_code == 200
        assert response.json()["residency_region"] == "eu-west-1"

    async def test_ensure_service_principal_endpoint(self, async_client):
        principal = AgentServicePrincipalRecord(
            id="agsp_1",
            organization_id="org_test",
            deployment_id="agdep_1",
            principal_name="agent-sales-v1",
            status="active",
            allowed_scopes={},
            metadata={},
            created_by_user_id="user_a",
            created_at="2026-02-13T10:00:00Z",
            updated_at="2026-02-13T10:00:00Z",
        )
        with (
            patch.object(
                agents_governance_route._service_principals,
                "ensure_principal_for_deployment",
                AsyncMock(return_value=principal),
            ),
            patch("src.api.routes.agents_governance.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/governance/principals/ensure",
                json={
                    "organization_id": "org_test",
                    "deployment_id": "agdep_1",
                    "principal_name": "agent-sales-v1",
                },
            )
        assert response.status_code == 200
        assert response.json()["id"] == "agsp_1"

    async def test_grant_authority_endpoint(self, async_client):
        authority = DelegatedAuthorityRecord(
            id="agauth_1",
            organization_id="org_test",
            principal_id="agsp_1",
            authorized_by_user_id="user_a",
            authority_scope={"allow_tools": ["email.send"]},
            authority_reason="pilot",
            valid_from="2026-02-13T10:00:00Z",
            valid_to=None,
            revoked_at=None,
            revoked_by_user_id=None,
            metadata={},
            created_at="2026-02-13T10:00:00Z",
        )
        with (
            patch.object(
                agents_governance_route._delegated_authority,
                "grant_authority",
                AsyncMock(return_value=authority),
            ),
            patch("src.api.routes.agents_governance.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/governance/authorities",
                json={
                    "organization_id": "org_test",
                    "principal_id": "agsp_1",
                    "authority_scope": {"allow_tools": ["email.send"]},
                },
            )
        assert response.status_code == 200
        assert response.json()["id"] == "agauth_1"


class TestAgentQualityEndpoints:
    async def test_offline_eval_run_endpoint(self, async_client):
        eval_result = OfflineEvalRunResult(
            organization_id="org_test",
            deployment_id="agdep_1",
            suite_name="offline.sales.smoke",
            passed=True,
            case_count=2,
            metrics=[
                OfflineEvalMetricResult(
                    metric_name="offline.accuracy",
                    metric_value=0.9,
                    threshold=0.8,
                    comparator="gte",
                    passed=True,
                    description="accuracy",
                )
            ],
            metadata={},
        )
        with (
            patch.object(
                agents_quality_route.OfflineEvaluationRunner,
                "run_suite",
                AsyncMock(return_value=eval_result),
            ),
            patch("src.api.routes.agents_quality_optimization.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/quality/evals/offline/run",
                json={
                    "organization_id": "org_test",
                    "deployment_id": "agdep_1",
                    "suite_name": "offline.sales.smoke",
                    "cases": [
                        {
                            "scenario_id": "case_1",
                            "expected": {"status": "ok"},
                            "observed": {"status": "ok"},
                        }
                    ],
                },
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["suite_name"] == "offline.sales.smoke"
        assert payload["passed"] is True

    async def test_quality_trend_endpoint_returns_expected_summary(self, async_client):
        trend = QualityTrendResponse(
            organization_id="org_test",
            role_id="agrole_1",
            deployment_id=None,
            lookback_days=30,
            points=[],
            summary={"run_count": 12, "avg_quality_score": 0.74},
        )
        with patch.object(
            agents_quality_route._scoring_service,
            "list_trends",
            AsyncMock(return_value=trend),
        ):
            response = await async_client.get(
                "/api/v1/agents/quality/trends",
                params={"organization_id": "org_test", "role_id": "agrole_1"},
            )
        assert response.status_code == 200
        payload = response.json()
        assert payload["summary"]["run_count"] == 12
        assert payload["summary"]["avg_quality_score"] == 0.74

    async def test_feedback_to_quality_recommendation_pipeline(self, async_client):
        insert_result = MagicMock()
        select_result = MagicMock()
        select_result.fetchone.return_value = _row(
            {
                "id": "agfbk_1",
                "organization_id": "org_test",
                "run_id": "agrun_1",
                "deployment_id": "agdep_1",
                "user_id": "user_a",
                "verdict": "rejected",
                "reason": "Missing source evidence",
                "metadata": {},
                "created_at": "2026-02-14T00:00:00Z",
            }
        )
        session = AsyncMock()
        session.execute = AsyncMock(side_effect=[insert_result, select_result])

        with patch("src.api.routes.agents_runs_quality.get_db_session", lambda: _fake_session(session)):
            feedback_response = await async_client.post(
                "/api/v1/agents/feedback",
                json={
                    "organization_id": "org_test",
                    "run_id": "agrun_1",
                    "deployment_id": "agdep_1",
                    "verdict": "rejected",
                    "reason": "Missing source evidence",
                },
            )
        assert feedback_response.status_code == 200

        score = RunQualityScoreRecord(
            id="agqsc_1",
            organization_id="org_test",
            run_id="agrun_1",
            deployment_id="agdep_1",
            role_id="agrole_1",
            quality_score=0.42,
            confidence_score=0.68,
            outcome_score=0.0,
            status="calibrated",
            score_breakdown={"feedback_score": 0.0},
            evaluated_at="2026-02-14T00:01:00Z",
            created_at="2026-02-14T00:01:00Z",
            updated_at="2026-02-14T00:01:00Z",
        )
        recommendations = [
            QualityRecommendationRecord(
                id="agrec_1",
                organization_id="org_test",
                role_id="agrole_1",
                deployment_id="agdep_1",
                recommendation_type="prompt_refinement",
                priority="high",
                status="open",
                summary="Tighten prompt requirements",
                details={},
                source_signals={},
                created_at="2026-02-14T00:02:00Z",
                updated_at="2026-02-14T00:02:00Z",
                resolved_at=None,
            )
        ]
        with (
            patch.object(
                agents_quality_route._scoring_service,
                "score_run",
                AsyncMock(return_value=score),
            ),
            patch.object(
                agents_quality_route._recommendation_service,
                "generate",
                AsyncMock(return_value=recommendations),
            ),
            patch("src.api.routes.agents_quality_optimization.emit_control_plane_audit_event", AsyncMock()),
        ):
            score_response = await async_client.post(
                "/api/v1/agents/quality/runs/agrun_1/score",
                json={"organization_id": "org_test"},
            )
            rec_response = await async_client.post(
                "/api/v1/agents/quality/recommendations/generate",
                json={"organization_id": "org_test", "deployment_id": "agdep_1"},
            )
        assert score_response.status_code == 200
        assert score_response.json()["quality_score"] == 0.42
        assert rec_response.status_code == 200
        assert rec_response.json()[0]["recommendation_type"] == "prompt_refinement"

    async def test_regression_gate_endpoints(self, async_client):
        gate = RegressionGateRecord(
            id="aggate_1",
            organization_id="org_test",
            role_id="agrole_1",
            deployment_id=None,
            metric_name="quality_score",
            comparator="max_drop",
            threshold=0.1,
            lookback_days=14,
            min_samples=10,
            severity="blocker",
            is_enabled=True,
            metadata={},
            created_by_user_id="user_a",
            created_at="2026-02-14T00:00:00Z",
            updated_at="2026-02-14T00:00:00Z",
        )
        eval_response = RegressionGateEvaluationResponse(
            organization_id="org_test",
            role_id="agrole_1",
            deployment_id=None,
            evaluated_at="2026-02-14T00:10:00Z",
            blocked=False,
            evaluations=[
                RegressionGateEvaluation(
                    gate_id="aggate_1",
                    metric_name="quality_score",
                    comparator="max_drop",
                    threshold=0.1,
                    baseline_value=0.78,
                    current_value=0.73,
                    delta_value=-0.05,
                    sample_count=25,
                    verdict="pass",
                    blocked=False,
                    severity="blocker",
                    metadata={},
                )
            ],
        )
        with (
            patch.object(
                agents_quality_route._regression_gate_service,
                "create_gate",
                AsyncMock(return_value=gate),
            ),
            patch.object(
                agents_quality_route._regression_gate_service,
                "evaluate",
                AsyncMock(return_value=eval_response),
            ),
            patch("src.api.routes.agents_quality_optimization.emit_control_plane_audit_event", AsyncMock()),
        ):
            create_response = await async_client.post(
                "/api/v1/agents/quality/regression-gates",
                json={
                    "organization_id": "org_test",
                    "role_id": "agrole_1",
                    "metric_name": "quality_score",
                    "comparator": "max_drop",
                    "threshold": 0.1,
                },
            )
            evaluate_response = await async_client.post(
                "/api/v1/agents/quality/regression-gates/evaluate",
                json={"organization_id": "org_test", "role_id": "agrole_1"},
            )

        assert create_response.status_code == 200
        assert create_response.json()["id"] == "aggate_1"
        assert evaluate_response.status_code == 200
        assert evaluate_response.json()["blocked"] is False

    async def test_calibration_recompute_endpoint(self, async_client):
        snapshot = CalibrationSnapshot(
            id="agcal_1",
            organization_id="org_test",
            role_id="agrole_1",
            sample_count=32,
            mean_absolute_error=0.12,
            brier_score=0.06,
            calibration_error=0.08,
            adjustment_factor=0.91,
            bucket_stats=[],
            metadata={},
            computed_at="2026-02-14T00:00:00Z",
            created_at="2026-02-14T00:00:00Z",
        )
        with (
            patch.object(
                agents_quality_route._calibration_service,
                "recompute",
                AsyncMock(return_value=snapshot),
            ),
            patch("src.api.routes.agents_quality_optimization.emit_control_plane_audit_event", AsyncMock()),
        ):
            response = await async_client.post(
                "/api/v1/agents/quality/calibration/recompute",
                json={"organization_id": "org_test", "role_id": "agrole_1"},
            )
        assert response.status_code == 200
        body = response.json()
        assert body["sample_count"] == 32
        assert body["adjustment_factor"] == 0.91
