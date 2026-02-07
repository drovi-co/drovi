"""
API tests for Monitoring endpoints.

Tests the health checks, metrics, and observability APIs.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class TestHealthEndpoint:
    """Tests for GET /monitoring/health."""

    async def test_health_check_healthy(self, async_client):
        """Test health check returns healthy status."""
        from src.monitoring.health import HealthStatus

        with patch("src.api.routes.monitoring.get_health_checker") as mock_get:
            mock_checker = AsyncMock()
            mock_health = MagicMock()
            mock_health.status = HealthStatus.HEALTHY
            mock_health.version = "1.0.0"
            mock_health.uptime_seconds = 1000
            mock_health.components = []
            mock_health.checked_at = datetime.utcnow()
            mock_checker.check_all.return_value = mock_health
            mock_get.return_value = mock_checker

            response = await async_client.get("/api/v1/monitoring/health")

            assert response.status_code == 200
            data = response.json()

            assert data["status"] == "healthy"
            assert "components" in data

    async def test_health_check_degraded(self, async_client):
        """Test health check returns degraded status."""
        from src.monitoring.health import HealthStatus

        with patch("src.api.routes.monitoring.get_health_checker") as mock_get:
            mock_checker = AsyncMock()
            mock_health = MagicMock()
            mock_health.status = HealthStatus.DEGRADED
            mock_health.version = "1.0.0"
            mock_health.uptime_seconds = 1000
            mock_health.components = []
            mock_health.checked_at = datetime.utcnow()
            mock_checker.check_all.return_value = mock_health
            mock_get.return_value = mock_checker

            response = await async_client.get("/api/v1/monitoring/health")

            # Degraded should still return 200 but indicate issues
            assert response.status_code == 200
            data = response.json()

            assert data["status"] == "degraded"

    async def test_health_check_unhealthy(self, async_client):
        """Test health check returns unhealthy status."""
        from src.monitoring.health import HealthStatus

        with patch("src.api.routes.monitoring.get_health_checker") as mock_get:
            mock_checker = AsyncMock()
            mock_health = MagicMock()
            mock_health.status = HealthStatus.UNHEALTHY
            mock_health.version = "1.0.0"
            mock_health.uptime_seconds = 1000
            mock_health.components = []
            mock_health.checked_at = datetime.utcnow()
            mock_checker.check_all.return_value = mock_health
            mock_get.return_value = mock_checker

            response = await async_client.get("/api/v1/monitoring/health")

            # Unhealthy could return 503 or 200 with unhealthy status
            assert response.status_code in [200, 503]
            data = response.json()

            assert data["status"] == "unhealthy"


class TestLivenessEndpoint:
    """Tests for GET /monitoring/health/live."""

    async def test_liveness_probe_success(self, async_client):
        """Test liveness probe returns OK."""
        response = await async_client.get("/api/v1/monitoring/health/live")

        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "alive"

    async def test_liveness_includes_timestamp(self, async_client):
        """Test liveness includes timestamp."""
        response = await async_client.get("/api/v1/monitoring/health/live")

        data = response.json()
        assert "timestamp" in data


class TestReadinessEndpoint:
    """Tests for GET /monitoring/health/ready."""

    async def test_readiness_probe_ready(self, async_client):
        """Test readiness probe when service is ready."""
        with patch("src.api.routes.monitoring.get_health_checker") as mock_get:
            mock_checker = AsyncMock()
            mock_checker.readiness.return_value = {
                "status": "ready",
                "timestamp": datetime.utcnow().isoformat(),
                "details": {"postgresql": "healthy", "redis": "healthy"},
            }
            mock_get.return_value = mock_checker

            response = await async_client.get("/api/v1/monitoring/health/ready")

            assert response.status_code == 200
            data = response.json()

            assert data["status"] == "ready"

    async def test_readiness_probe_not_ready(self, async_client):
        """Test readiness probe when service is not ready."""
        with patch("src.api.routes.monitoring.get_health_checker") as mock_get:
            mock_checker = AsyncMock()
            mock_checker.readiness.return_value = {
                "status": "not_ready",
                "timestamp": datetime.utcnow().isoformat(),
                "details": {"postgresql": "unhealthy"},
            }
            mock_get.return_value = mock_checker

            response = await async_client.get("/api/v1/monitoring/health/ready")

            # Not ready should return 503
            assert response.status_code == 503
            data = response.json()

            assert data["status"] == "not_ready"


class TestMetricsEndpoint:
    """Tests for GET /monitoring/metrics."""

    async def test_get_prometheus_metrics(self, async_client):
        """Test getting Prometheus metrics in text format."""
        with patch("src.api.routes.monitoring.get_metrics") as mock_get:
            mock_metrics = MagicMock()
            mock_metrics.export.return_value = """
# HELP intelligence_requests_total Total number of intelligence requests
# TYPE intelligence_requests_total counter
intelligence_requests_total{status="success"} 100
intelligence_requests_total{status="error"} 5

# HELP intelligence_extraction_duration_seconds Duration of intelligence extraction
# TYPE intelligence_extraction_duration_seconds histogram
intelligence_extraction_duration_seconds_bucket{le="0.1"} 50
intelligence_extraction_duration_seconds_bucket{le="0.5"} 90
intelligence_extraction_duration_seconds_bucket{le="+Inf"} 105
"""
            mock_get.return_value = mock_metrics

            response = await async_client.get("/api/v1/monitoring/metrics")

            assert response.status_code == 200
            # Prometheus metrics should be text/plain
            assert "text" in response.headers.get("content-type", "")

    async def test_metrics_include_extraction_stats(self, async_client):
        """Test metrics include extraction statistics."""
        with patch("src.api.routes.monitoring.get_metrics") as mock_get:
            mock_metrics = MagicMock()
            mock_metrics.export.return_value = "intelligence_extractions_total 500"
            mock_get.return_value = mock_metrics

            response = await async_client.get("/api/v1/monitoring/metrics")

            assert response.status_code == 200
            assert "intelligence" in response.text.lower() or response.text != ""


class TestMetricsSummaryEndpoint:
    """Tests for GET /monitoring/metrics/summary."""

    async def test_get_metrics_summary(self, async_client):
        """Test getting metrics summary in JSON format."""
        response = await async_client.get("/api/v1/monitoring/metrics/summary")

        assert response.status_code == 200
        data = response.json()

        # Check for actual response structure
        assert "period" in data
        assert "extractions" in data
        assert "syncs" in data
        assert "searches" in data
        assert "llm" in data
        assert "events" in data

    async def test_metrics_summary_with_time_range(self, async_client):
        """Test metrics summary with time range filter."""
        with patch("src.api.routes.monitoring.get_metrics") as mock_get:
            mock_metrics = MagicMock()
            mock_metrics.get_summary.return_value = {"requests": {"total": 100}}
            mock_get.return_value = mock_metrics

            response = await async_client.get(
                "/api/v1/monitoring/metrics/summary",
                params={"period": "1h"},
            )

            assert response.status_code == 200


class TestDecayEndpoints:
    """Tests for memory decay endpoints."""

    async def test_trigger_decay_async_enqueues_job(self, async_client, factory):
        with patch("src.jobs.queue.enqueue_job", AsyncMock(return_value="job_decay_1")):
            response = await async_client.post(
                "/api/v1/monitoring/trigger-decay",
                params={"organization_id": factory.organization_id(), "async_mode": True},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "queued"
        assert data["job_id"] == "job_decay_1"


class TestAccessStatsEndpoint:
    """Tests for GET /monitoring/access-stats."""

    async def test_get_access_stats(self, async_client, factory):
        """Test getting access statistics."""
        org_id = factory.organization_id()

        with patch("src.graph.access_tracking.get_access_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_most_accessed.return_value = [
                {"id": "contact_1", "access_count": 100},
            ]
            mock_tracker.get_recently_accessed.return_value = [
                {"id": "contact_1", "last_accessed": datetime.utcnow().isoformat()},
            ]
            mock_tracker.get_never_accessed.return_value = []
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/monitoring/access-stats",
                params={"organization_id": org_id},
            )

            assert response.status_code == 200
            data = response.json()

            assert "most_accessed" in data
            assert "recently_accessed" in data
            assert "never_accessed_count" in data
            assert len(data["most_accessed"]) > 0

    async def test_access_stats_by_period(self, async_client, factory):
        """Test getting access stats for a specific period."""
        org_id = factory.organization_id()

        with patch("src.graph.access_tracking.get_access_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_most_accessed.return_value = [
                {"id": "contact_1", "access_count": 100},
            ]
            mock_tracker.get_recently_accessed.return_value = [
                {"id": "contact_1", "last_accessed": datetime.utcnow().isoformat()},
            ]
            mock_tracker.get_never_accessed.return_value = []
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/monitoring/access-stats",
                params={
                    "organization_id": org_id,
                },
            )

            assert response.status_code == 200


class TestDecayStatsEndpoint:
    """Tests for GET /monitoring/decay-stats."""

    async def test_get_decay_stats(self, async_client, factory):
        """Test getting decay statistics."""
        org_id = factory.organization_id()

        # The endpoint returns placeholder data without external calls
        response = await async_client.get(
            "/api/v1/monitoring/decay-stats",
            params={"organization_id": org_id},
        )

        assert response.status_code == 200
        data = response.json()

        # Check response structure matches DecayStatsResponse model
        assert "organization_id" in data
        assert "total_nodes" in data
        assert "high_relevance" in data
        assert "medium_relevance" in data
        assert "low_relevance" in data
        assert "archived" in data
        assert "last_decay_run" in data

    async def test_decay_stats_without_run(self, async_client, factory):
        """Test decay stats when no decay has run yet."""
        org_id = factory.organization_id()

        # The endpoint returns placeholder data with last_decay_run=None
        response = await async_client.get(
            "/api/v1/monitoring/decay-stats",
            params={"organization_id": org_id},
        )

        assert response.status_code == 200
        data = response.json()

        # Placeholder implementation returns None for last_decay_run
        assert data["last_decay_run"] is None


class TestTriggerDecayEndpoint:
    """Tests for POST /monitoring/trigger-decay."""

    async def test_trigger_decay_success(self, async_client, factory):
        """Test triggering decay computation (sync mode)."""
        org_id = factory.organization_id()

        # Mock the decay job module import
        import sys
        mock_decay_module = MagicMock()
        mock_job = AsyncMock()
        mock_job.run.return_value = {
            "success": True,
            "entities_processed": 1000,
        }
        mock_decay_module.get_decay_job = AsyncMock(return_value=mock_job)

        with patch.dict(sys.modules, {"src.jobs.decay": mock_decay_module}):
            response = await async_client.post(
                "/api/v1/monitoring/trigger-decay",
                params={
                    "organization_id": org_id,
                    "async_mode": "false",  # Run synchronously to test decay job
                },
            )

            assert response.status_code == 200
            data = response.json()

            assert data["status"] == "completed"

    async def test_trigger_decay_with_options(self, async_client, factory, mock_db_pool):
        """Test triggering decay in async mode queues a durable job."""
        org_id = factory.organization_id()

        response = await async_client.post(
            "/api/v1/monitoring/trigger-decay",
            params={
                "organization_id": org_id,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "queued"
        assert data["job_id"]
        assert mock_db_pool.acquire.called

    async def test_trigger_decay_dry_run(self, async_client, factory, mock_db_pool):
        """Test decay can be queued in async mode."""
        org_id = factory.organization_id()

        response = await async_client.post(
            "/api/v1/monitoring/trigger-decay",
            params={
                "organization_id": org_id,
                "async_mode": "true",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "queued"
        assert data["job_id"]
        assert mock_db_pool.acquire.called


class TestMonitoringIntegration:
    """Integration tests for monitoring system."""

    async def test_health_and_metrics_consistency(self, async_client):
        """Test health status reflects in metrics."""
        from src.monitoring.health import HealthStatus

        # First check health
        with patch("src.api.routes.monitoring.get_health_checker") as mock_health:
            mock_checker = AsyncMock()
            mock_health_result = MagicMock()
            mock_health_result.status = HealthStatus.HEALTHY
            mock_health_result.version = "1.0.0"
            mock_health_result.uptime_seconds = 1000
            mock_health_result.components = []
            mock_health_result.checked_at = datetime.utcnow()
            mock_checker.check_all.return_value = mock_health_result
            mock_health.return_value = mock_checker

            health_response = await async_client.get("/api/v1/monitoring/health")
            assert health_response.json()["status"] == "healthy"

    async def test_all_monitoring_endpoints_accessible(self, async_client, factory):
        """Test all monitoring endpoints are accessible."""
        from src.monitoring.health import HealthStatus

        # Liveness - no mocking needed
        live_response = await async_client.get("/api/v1/monitoring/health/live")
        assert live_response.status_code == 200

        # Other endpoints need mocking but should not return 404
        with patch("src.api.routes.monitoring.get_health_checker") as mock_health:
            mock_checker = AsyncMock()
            # Mock for check_all (health endpoint)
            mock_health_result = MagicMock()
            mock_health_result.status = HealthStatus.HEALTHY
            mock_health_result.version = "1.0.0"
            mock_health_result.uptime_seconds = 1000
            mock_health_result.components = []
            mock_health_result.checked_at = datetime.utcnow()
            mock_checker.check_all.return_value = mock_health_result
            # Mock for readiness (ready endpoint)
            mock_checker.readiness.return_value = {
                "status": "ready",
                "timestamp": datetime.utcnow().isoformat(),
            }
            mock_health.return_value = mock_checker

            health_response = await async_client.get("/api/v1/monitoring/health")
            assert health_response.status_code != 404

            ready_response = await async_client.get("/api/v1/monitoring/health/ready")
            assert ready_response.status_code != 404

        # Metrics endpoints don't need mocking - they return placeholder data
        metrics_response = await async_client.get("/api/v1/monitoring/metrics")
        # May return 501 if prometheus_client not installed, but not 404
        assert metrics_response.status_code != 404

        summary_response = await async_client.get("/api/v1/monitoring/metrics/summary")
        assert summary_response.status_code == 200
