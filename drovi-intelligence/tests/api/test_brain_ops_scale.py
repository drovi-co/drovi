from __future__ import annotations

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


async def test_brain_capacity_forecast_endpoint(async_client) -> None:
    response = await async_client.post(
        "/api/v1/brain/ops/capacity/forecast",
        json={
            "organization_id": "org_test",
            "horizon_days": 10,
            "history": [
                {
                    "timestamp": "2026-02-20T00:00:00Z",
                    "event_rate_eps": 100.0,
                    "storage_bytes": 1000000000.0,
                    "graph_nodes": 10000000.0,
                },
                {
                    "timestamp": "2026-02-21T00:00:00Z",
                    "event_rate_eps": 120.0,
                    "storage_bytes": 1100000000.0,
                    "graph_nodes": 10300000.0,
                },
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["forecast"]["horizon_days"] == 10
    assert len(payload["forecast"]["projection"]) == 10


async def test_brain_inference_scale_plan_endpoint(async_client) -> None:
    response = await async_client.post(
        "/api/v1/brain/ops/inference/plan",
        json={
            "organization_id": "org_test",
            "requests": [
                {
                    "model_family": "verifier_nli",
                    "risk_class": "critical",
                    "sla_minutes": 3,
                    "backlog_depth": 120,
                },
                {
                    "model_family": "temporal_forecast",
                    "risk_class": "low",
                    "sla_minutes": 120,
                    "backlog_depth": 20,
                },
            ],
            "autoscale_inputs": [
                {
                    "pool_id": "inference-gpu-heavy",
                    "backlog_depth": 900,
                    "p95_latency_ms": 2400,
                    "utilization": 0.9,
                    "current_replicas": 4,
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["dispatch"][0]["pool_id"] == "inference-gpu-heavy"
    assert payload["dispatch"][0]["priority_class"] == "p0"
    assert payload["autoscale"][0]["action"] == "scale_up"


async def test_brain_disaster_recovery_drill_endpoint(async_client) -> None:
    response = await async_client.post(
        "/api/v1/brain/ops/drill/disaster-recovery",
        json={
            "organization_id": "org_test",
            "initiated_by": "sre",
            "targets": [
                {
                    "layer": "evidence_store",
                    "primary_region": "us-east-1",
                    "secondary_region": "us-west-2",
                    "rto_target_minutes": 30,
                    "rpo_target_minutes": 10,
                }
            ],
            "observed_results": [
                {
                    "layer": "evidence_store",
                    "observed_rto_minutes": 22,
                    "observed_rpo_minutes": 6,
                    "integrity_ok": True,
                    "checksum_match_ratio": 1.0,
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["evaluation"]["passed"] is True
    assert payload["plan"]["targets"][0]["layer"] == "evidence_store"


async def test_brain_inference_scale_plan_rejects_unknown_pool(async_client) -> None:
    response = await async_client.post(
        "/api/v1/brain/ops/inference/plan",
        json={
            "organization_id": "org_test",
            "requests": [],
            "autoscale_inputs": [
                {
                    "pool_id": "unknown-pool",
                    "backlog_depth": 100,
                    "p95_latency_ms": 1000,
                    "utilization": 0.5,
                    "current_replicas": 3,
                }
            ],
        },
    )
    assert response.status_code == 400
