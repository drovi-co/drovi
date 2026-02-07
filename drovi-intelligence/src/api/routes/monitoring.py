"""
Monitoring API Routes

Provides comprehensive monitoring, metrics, health checks, and
observability endpoints for the intelligence platform.

OpenAPI Tags:
- monitoring: Health checks, metrics, and observability
"""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
import structlog

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.monitoring import (
    get_metrics,
    get_health_checker,
    HealthStatus,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class ComponentHealthResponse(BaseModel):
    """Health status of a component."""

    name: str = Field(..., description="Component name")
    status: str = Field(..., description="Health status: healthy, degraded, unhealthy")
    message: str | None = Field(None, description="Status message or error")
    latency_ms: float | None = Field(None, description="Check latency in milliseconds")
    details: dict[str, Any] = Field(default_factory=dict, description="Additional details")
    checked_at: datetime = Field(..., description="When the check was performed")

    model_config = {"json_schema_extra": {"example": {"name": "postgresql", "status": "healthy", "message": None, "latency_ms": 5.2, "details": {}, "checked_at": "2024-01-15T10:30:00Z"}}}


class SystemHealthResponse(BaseModel):
    """Overall system health."""

    status: str = Field(..., description="Overall status: healthy, degraded, unhealthy")
    version: str | None = Field(None, description="Application version")
    uptime_seconds: float = Field(..., description="Uptime in seconds")
    components: list[ComponentHealthResponse] = Field(..., description="Component health statuses")
    checked_at: datetime = Field(..., description="When the check was performed")

    model_config = {"json_schema_extra": {"example": {"status": "healthy", "version": "0.1.0", "uptime_seconds": 3600.5, "components": [], "checked_at": "2024-01-15T10:30:00Z"}}}


class AccessStatsResponse(BaseModel):
    """Access tracking statistics."""

    organization_id: str = Field(..., description="Organization ID")
    most_accessed: list[dict[str, Any]] = Field(..., description="Most accessed nodes")
    recently_accessed: list[dict[str, Any]] = Field(..., description="Recently accessed nodes")
    never_accessed_count: int = Field(..., description="Count of never-accessed nodes")

    model_config = {"json_schema_extra": {"example": {"organization_id": "org_123", "most_accessed": [{"id": "node_1", "access_count": 150}], "recently_accessed": [], "never_accessed_count": 25}}}


class DecayStatsResponse(BaseModel):
    """Memory decay statistics."""

    organization_id: str = Field(..., description="Organization ID")
    total_nodes: int = Field(..., description="Total nodes in graph")
    high_relevance: int = Field(..., description="Nodes with relevance > 0.7")
    medium_relevance: int = Field(..., description="Nodes with relevance 0.3-0.7")
    low_relevance: int = Field(..., description="Nodes with relevance < 0.3")
    archived: int = Field(..., description="Archived nodes")
    last_decay_run: datetime | None = Field(None, description="Last decay computation time")

    model_config = {"json_schema_extra": {"example": {"organization_id": "org_123", "total_nodes": 1000, "high_relevance": 200, "medium_relevance": 500, "low_relevance": 250, "archived": 50, "last_decay_run": "2024-01-15T00:00:00Z"}}}


class MetricsSummaryResponse(BaseModel):
    """Summary of key metrics."""

    period: str = Field(..., description="Metrics period")
    extractions: dict[str, Any] = Field(..., description="Extraction metrics")
    syncs: dict[str, Any] = Field(..., description="Sync job metrics")
    searches: dict[str, Any] = Field(..., description="Search metrics")
    llm: dict[str, Any] = Field(..., description="LLM usage metrics")
    events: dict[str, Any] = Field(..., description="Event metrics")

    model_config = {"json_schema_extra": {"example": {"period": "last_24h", "extractions": {"total": 150, "success_rate": 0.98}, "syncs": {"total": 50}, "searches": {"total": 1000}, "llm": {"total_tokens": 50000}, "events": {"published": 500}}}}


class LivenessResponse(BaseModel):
    """Liveness check response."""

    status: str = Field(..., description="Status: alive")
    timestamp: datetime = Field(..., description="Check timestamp")

    model_config = {"json_schema_extra": {"example": {"status": "alive", "timestamp": "2024-01-15T10:30:00Z"}}}


class ReadinessResponse(BaseModel):
    """Readiness check response."""

    status: str = Field(..., description="Status: ready or not_ready")
    timestamp: datetime = Field(..., description="Check timestamp")
    details: dict[str, Any] | None = Field(None, description="Details if not ready")

    model_config = {"json_schema_extra": {"example": {"status": "ready", "timestamp": "2024-01-15T10:30:00Z", "details": None}}}


# =============================================================================
# API ENDPOINTS
# =============================================================================


@router.get(
    "/health",
    response_model=SystemHealthResponse,
    summary="Full health check",
    description="""
Comprehensive health check of all system components.

**Components Checked:**
- PostgreSQL database
- Redis cache
- FalkorDB graph database
- LLM service

**Status Levels:**
- `healthy`: All checks passed
- `degraded`: Non-critical components failing
- `unhealthy`: Critical components failing

**Response Codes:**
- 200: System is healthy or degraded
- 503: System is unhealthy
""",
    responses={
        200: {"description": "Health check completed"},
        503: {"description": "System unhealthy"},
    },
)
async def health_check(response: Response) -> SystemHealthResponse:
    """Full system health check."""
    checker = await get_health_checker()
    health = await checker.check_all()

    if health.status == HealthStatus.UNHEALTHY:
        response.status_code = 503

    return SystemHealthResponse(
        status=health.status.value,
        version=health.version,
        uptime_seconds=health.uptime_seconds or 0,
        components=[
            ComponentHealthResponse(
                name=c.name,
                status=c.status.value,
                message=c.message,
                latency_ms=c.latency_ms,
                details=c.details,
                checked_at=c.checked_at,
            )
            for c in health.components
        ],
        checked_at=health.checked_at,
    )


@router.get(
    "/health/live",
    response_model=LivenessResponse,
    summary="Kubernetes liveness probe",
    description="""
Liveness probe for Kubernetes health checks.

Returns immediately without checking external dependencies.
Use this for Kubernetes `livenessProbe` configuration.

**Returns 200 if:**
- The service is running
- The event loop is responsive
""",
    responses={
        200: {"description": "Service is alive"},
    },
)
async def liveness_probe() -> LivenessResponse:
    """Kubernetes liveness probe."""
    checker = await get_health_checker()
    result = await checker.liveness()

    return LivenessResponse(
        status=result["status"],
        timestamp=datetime.fromisoformat(result["timestamp"]),
    )


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Kubernetes readiness probe",
    description="""
Readiness probe for Kubernetes health checks.

Checks critical dependencies (PostgreSQL, FalkorDB).
Use this for Kubernetes `readinessProbe` configuration.

**Returns 200 if:**
- PostgreSQL is accessible
- FalkorDB is accessible

**Returns 503 if:**
- Any critical dependency is unavailable
""",
    responses={
        200: {"description": "Service is ready"},
        503: {"description": "Service is not ready"},
    },
)
async def readiness_probe(response: Response) -> ReadinessResponse:
    """Kubernetes readiness probe."""
    checker = await get_health_checker()
    result = await checker.readiness()

    if result["status"] != "ready":
        response.status_code = 503

    return ReadinessResponse(
        status=result["status"],
        timestamp=datetime.fromisoformat(result["timestamp"]),
        details=result.get("details"),
    )


@router.get(
    "/metrics",
    summary="Prometheus metrics",
    description="""
Prometheus metrics endpoint.

Returns metrics in Prometheus exposition format for scraping.

**Available Metrics:**
- `drovi_http_requests_total`: HTTP request counts
- `drovi_http_request_duration_seconds`: Request latency
- `drovi_extractions_total`: Intelligence extraction counts
- `drovi_extraction_duration_seconds`: Extraction latency
- `drovi_sync_jobs_total`: Sync job counts
- `drovi_llm_requests_total`: LLM API calls
- `drovi_llm_tokens_total`: LLM token usage
- `drovi_search_requests_total`: Search request counts
- `drovi_events_published_total`: Event publication counts
- And more...
See `deploy/observability/README.md` for the full metrics catalog.

**Usage:**
Add this endpoint to your Prometheus scrape config:
```yaml
scrape_configs:
  - job_name: 'drovi-intelligence'
    static_configs:
      - targets: ['localhost:8000']
    metrics_path: '/api/v1/monitoring/metrics'
```
""",
    responses={
        200: {
            "description": "Prometheus metrics",
            "content": {"text/plain": {"example": "# HELP drovi_http_requests_total Total HTTP requests\\n# TYPE drovi_http_requests_total counter\\ndrovi_http_requests_total{method=\"GET\",endpoint=\"/health\"} 100"}},
        },
    },
)
async def prometheus_metrics():
    """Prometheus metrics endpoint."""
    try:
        from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

        return Response(
            content=generate_latest(),
            media_type=CONTENT_TYPE_LATEST,
        )
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="prometheus_client not installed",
        )


@router.get(
    "/metrics/summary",
    response_model=MetricsSummaryResponse,
    summary="Metrics summary",
    description="""
Human-readable summary of key metrics.

Provides aggregated metrics for dashboards and quick insights.

**Includes:**
- Extraction success rates and counts
- Sync job statistics
- Search performance
- LLM token usage
- Event publication stats
""",
    responses={
        200: {"description": "Metrics summary retrieved"},
    },
)
async def metrics_summary(
    period: Annotated[str, Query(description="Time period: last_hour, last_24h, last_7d")] = "last_24h",
) -> MetricsSummaryResponse:
    """Get metrics summary."""
    # Note: In a real implementation, this would query Prometheus or internal metrics
    # For now, return placeholder structure

    return MetricsSummaryResponse(
        period=period,
        extractions={
            "total": 0,
            "success_rate": 0.0,
            "avg_duration_seconds": 0.0,
            "uios_extracted": 0,
            "entities_extracted": 0,
        },
        syncs={
            "total": 0,
            "success_rate": 0.0,
            "records_synced": 0,
            "by_connector": {},
        },
        searches={
            "total": 0,
            "avg_duration_seconds": 0.0,
            "avg_results": 0.0,
            "by_type": {},
        },
        llm={
            "total_requests": 0,
            "total_tokens": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "by_model": {},
        },
        events={
            "published": 0,
            "by_type": {},
        },
    )


@router.get(
    "/access-stats",
    response_model=AccessStatsResponse,
    summary="Access tracking statistics",
    description="""
Get access tracking statistics for an organization.

Shows which nodes are being accessed and how frequently.

**Use Cases:**
- Identify heavily-used data
- Find stale/unused nodes
- Optimize caching strategies
- Inform decay parameters

Requires `read` scope.
""",
    responses={
        200: {"description": "Access stats retrieved"},
    },
)
async def get_access_stats(
    organization_id: Annotated[str, Query(description="Organization ID")],
    limit: Annotated[int, Query(description="Max items per category", ge=1, le=100)] = 10,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> AccessStatsResponse:
    """Get access tracking statistics."""
    _validate_org_id(ctx, organization_id)

    from src.graph.access_tracking import get_access_tracker

    try:
        tracker = await get_access_tracker()

        most_accessed = await tracker.get_most_accessed(organization_id, limit=limit)
        recently_accessed = await tracker.get_recently_accessed(organization_id, limit=limit)
        never_accessed = await tracker.get_never_accessed(organization_id, limit=limit)

        return AccessStatsResponse(
            organization_id=organization_id,
            most_accessed=most_accessed,
            recently_accessed=recently_accessed,
            never_accessed_count=len(never_accessed),
        )

    except Exception as e:
        logger.error("Failed to get access stats", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get access stats: {str(e)}")


@router.get(
    "/decay-stats",
    response_model=DecayStatsResponse,
    summary="Memory decay statistics",
    description="""
Get memory decay statistics for an organization.

Shows the distribution of node relevance scores and decay status.

**Relevance Levels:**
- High (>0.7): Frequently accessed, recently relevant
- Medium (0.3-0.7): Moderate access, moderate age
- Low (<0.3): Rarely accessed, candidates for archival

**Use Cases:**
- Monitor knowledge graph health
- Tune decay parameters
- Plan archival operations
- Optimize storage

Requires `read` scope.
""",
    responses={
        200: {"description": "Decay stats retrieved"},
    },
)
async def get_decay_stats(
    organization_id: Annotated[str, Query(description="Organization ID")],
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DecayStatsResponse:
    """Get memory decay statistics."""
    _validate_org_id(ctx, organization_id)

    # Note: This would query the graph for relevance score distributions
    # For now, return placeholder structure

    return DecayStatsResponse(
        organization_id=organization_id,
        total_nodes=0,
        high_relevance=0,
        medium_relevance=0,
        low_relevance=0,
        archived=0,
        last_decay_run=None,
    )


@router.post(
    "/trigger-decay",
    response_model=dict[str, Any],
    summary="Trigger memory decay computation",
    description="""
Manually trigger memory decay computation.

This is normally run automatically on a schedule, but can be
triggered manually for testing or immediate cleanup.

**Effects:**
- Updates relevance_score for all nodes
- Archives nodes below threshold
- Updates last_accessed_at based on access patterns

**Note:** This operation may take several minutes for large graphs.

Requires `write` scope.
""",
    responses={
        200: {"description": "Decay computation triggered"},
        202: {"description": "Decay computation queued"},
    },
)
async def trigger_decay(
    organization_id: Annotated[str, Query(description="Organization ID")],
    async_mode: Annotated[bool, Query(description="Run asynchronously")] = True,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    """Trigger memory decay computation."""
    _validate_org_id(ctx, organization_id)

    if async_mode:
        # Queue for background processing via the durable job plane.
        from src.jobs.queue import EnqueueJobRequest, enqueue_job

        bucket = int(datetime.utcnow().timestamp()) // 60
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=organization_id,
                job_type="memory.decay",
                payload={"organization_id": organization_id},
                priority=0,
                max_attempts=1,
                idempotency_key=f"manual_memory_decay:{organization_id}:{bucket}",
                resource_key=f"org:{organization_id}:memory_decay",
            )
        )

        return {
            "status": "queued",
            "job_id": job_id,
            "message": "Decay computation queued for background processing",
        }

    # Run synchronously
    try:
        from src.jobs.decay import get_decay_job

        decay_job = await get_decay_job()
        result = await decay_job.run()

        return {
            "status": "completed",
            "result": result,
        }

    except Exception as e:
        logger.error("Decay computation failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Decay computation failed: {str(e)}")
