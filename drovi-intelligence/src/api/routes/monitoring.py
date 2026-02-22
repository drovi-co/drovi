"""
Monitoring API Routes

Provides comprehensive monitoring, metrics, health checks, and
observability endpoints for the intelligence platform.

OpenAPI Tags:
- monitoring: Health checks, metrics, and observability
"""

from collections import defaultdict
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
import structlog

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings
from src.connectors.http import request_with_retry
from src.monitoring import (
    get_metrics,
    get_health_checker,
    HealthStatus,
)
from src.notifications.resend import send_resend_email

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


def _collect_prometheus_samples() -> dict[str, list[Any]]:
    """Collect Prometheus samples keyed by sample name."""
    try:
        from prometheus_client import REGISTRY
    except ImportError:
        return {}

    grouped: dict[str, list[Any]] = defaultdict(list)
    for family in REGISTRY.collect():
        for sample in family.samples:
            grouped[sample.name].append(sample)
    return grouped


def _sum_sample_values(samples: dict[str, list[Any]], sample_name: str) -> float:
    return float(sum(float(sample.value) for sample in samples.get(sample_name, [])))


def _group_sample_values(
    samples: dict[str, list[Any]],
    *,
    sample_name: str,
    label: str,
) -> dict[str, float]:
    grouped: dict[str, float] = defaultdict(float)
    for sample in samples.get(sample_name, []):
        key = str(sample.labels.get(label) or "unknown")
        grouped[key] += float(sample.value)
    return dict(grouped)


def _to_int(value: Any) -> int:
    """Best-effort integer conversion for query results."""
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0


def _parse_optional_datetime(value: Any) -> datetime | None:
    """Normalize optional datetime values from graph query results."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


async def _query_decay_count(
    graph: Any,
    *,
    organization_id: str,
    condition: str,
) -> int:
    query = f"""
        MATCH (n)
        WHERE n.organizationId = $orgId
          AND n.relevanceScore IS NOT NULL
          AND {condition}
        RETURN count(n) as count
    """
    result = await graph.query(query, {"orgId": organization_id})
    if not result:
        return 0
    return _to_int(result[0].get("count"))


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
    samples = _collect_prometheus_samples()

    extraction_total = int(_sum_sample_values(samples, "drovi_extractions_total"))
    extraction_success = sum(
        float(sample.value)
        for sample in samples.get("drovi_extractions_total", [])
        if str(sample.labels.get("status", "")).lower() in {"success", "completed"}
    )
    extraction_success_rate = (
        float(extraction_success) / float(extraction_total)
        if extraction_total > 0
        else 0.0
    )
    extraction_duration_sum = _sum_sample_values(
        samples,
        "drovi_extraction_duration_seconds_sum",
    )
    extraction_duration_count = _sum_sample_values(
        samples,
        "drovi_extraction_duration_seconds_count",
    )
    extraction_avg_duration = (
        extraction_duration_sum / extraction_duration_count
        if extraction_duration_count > 0
        else 0.0
    )

    sync_total = int(_sum_sample_values(samples, "drovi_sync_jobs_total"))
    sync_success = sum(
        float(sample.value)
        for sample in samples.get("drovi_sync_jobs_total", [])
        if str(sample.labels.get("status", "")).lower() in {"success", "completed"}
    )
    sync_success_rate = float(sync_success) / float(sync_total) if sync_total > 0 else 0.0
    sync_by_connector = _group_sample_values(
        samples,
        sample_name="drovi_sync_jobs_total",
        label="connector_type",
    )
    records_synced_total = int(_sum_sample_values(samples, "drovi_records_synced_total"))

    search_total = int(_sum_sample_values(samples, "drovi_search_requests_total"))
    search_duration_sum = _sum_sample_values(samples, "drovi_search_duration_seconds_sum")
    search_duration_count = _sum_sample_values(samples, "drovi_search_duration_seconds_count")
    search_avg_duration = (
        search_duration_sum / search_duration_count if search_duration_count > 0 else 0.0
    )
    search_results_sum = _sum_sample_values(samples, "drovi_search_results_count_sum")
    search_results_count = _sum_sample_values(samples, "drovi_search_results_count_count")
    search_avg_results = (
        search_results_sum / search_results_count if search_results_count > 0 else 0.0
    )
    search_by_type = _group_sample_values(
        samples,
        sample_name="drovi_search_requests_total",
        label="search_type",
    )

    llm_requests_total = int(_sum_sample_values(samples, "drovi_llm_requests_total"))
    llm_tokens_input = sum(
        float(sample.value)
        for sample in samples.get("drovi_llm_tokens_total", [])
        if str(sample.labels.get("type", "")).lower() == "input"
    )
    llm_tokens_output = sum(
        float(sample.value)
        for sample in samples.get("drovi_llm_tokens_total", [])
        if str(sample.labels.get("type", "")).lower() == "output"
    )
    llm_by_model: dict[str, dict[str, float]] = {}
    for sample in samples.get("drovi_llm_requests_total", []):
        model = str(sample.labels.get("model") or "unknown")
        bucket = llm_by_model.setdefault(
            model,
            {"requests": 0.0, "input_tokens": 0.0, "output_tokens": 0.0},
        )
        bucket["requests"] += float(sample.value)
    for sample in samples.get("drovi_llm_tokens_total", []):
        model = str(sample.labels.get("model") or "unknown")
        token_type = str(sample.labels.get("type") or "unknown")
        bucket = llm_by_model.setdefault(
            model,
            {"requests": 0.0, "input_tokens": 0.0, "output_tokens": 0.0},
        )
        if token_type == "input":
            bucket["input_tokens"] += float(sample.value)
        elif token_type == "output":
            bucket["output_tokens"] += float(sample.value)

    events_published = int(_sum_sample_values(samples, "drovi_events_published_total"))
    events_by_type = _group_sample_values(
        samples,
        sample_name="drovi_events_published_total",
        label="event_type",
    )

    return MetricsSummaryResponse(
        period=period,
        extractions={
            "total": extraction_total,
            "success_rate": extraction_success_rate,
            "avg_duration_seconds": extraction_avg_duration,
            "uios_extracted": int(_sum_sample_values(samples, "drovi_uios_extracted_total")),
            "entities_extracted": int(_sum_sample_values(samples, "drovi_entities_extracted_total")),
        },
        syncs={
            "total": sync_total,
            "success_rate": sync_success_rate,
            "records_synced": records_synced_total,
            "by_connector": {
                key: int(value) for key, value in sync_by_connector.items()
            },
        },
        searches={
            "total": search_total,
            "avg_duration_seconds": search_avg_duration,
            "avg_results": search_avg_results,
            "by_type": {key: int(value) for key, value in search_by_type.items()},
        },
        llm={
            "total_requests": llm_requests_total,
            "total_tokens": int(llm_tokens_input + llm_tokens_output),
            "input_tokens": int(llm_tokens_input),
            "output_tokens": int(llm_tokens_output),
            "by_model": {
                model: {
                    "requests": int(values["requests"]),
                    "input_tokens": int(values["input_tokens"]),
                    "output_tokens": int(values["output_tokens"]),
                    "total_tokens": int(values["input_tokens"] + values["output_tokens"]),
                }
                for model, values in llm_by_model.items()
            },
        },
        events={
            "published": events_published,
            "by_type": {key: int(value) for key, value in events_by_type.items()},
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
    from src.graph.client import get_graph_client

    try:
        graph = await get_graph_client()

        total_nodes = await _query_decay_count(
            graph,
            organization_id=organization_id,
            condition="1 = 1",
        )
        high_relevance = await _query_decay_count(
            graph,
            organization_id=organization_id,
            condition="n.validTo IS NULL AND n.relevanceScore > 0.7",
        )
        medium_relevance = await _query_decay_count(
            graph,
            organization_id=organization_id,
            condition="n.validTo IS NULL AND n.relevanceScore >= 0.3 AND n.relevanceScore <= 0.7",
        )
        low_relevance = await _query_decay_count(
            graph,
            organization_id=organization_id,
            condition="n.validTo IS NULL AND n.relevanceScore < 0.3",
        )
        archived = await _query_decay_count(
            graph,
            organization_id=organization_id,
            condition="n.validTo IS NOT NULL",
        )

        last_decay_query = """
            MATCH (n)
            WHERE n.organizationId = $orgId
              AND n.decayComputedAt IS NOT NULL
            RETURN n.decayComputedAt as decayComputedAt
            ORDER BY n.decayComputedAt DESC
            LIMIT 1
        """
        last_decay_result = await graph.query(last_decay_query, {"orgId": organization_id})
        last_decay_run = None
        if last_decay_result:
            last_decay_run = _parse_optional_datetime(
                last_decay_result[0].get("decayComputedAt")
            )

        return DecayStatsResponse(
            organization_id=organization_id,
            total_nodes=total_nodes,
            high_relevance=high_relevance,
            medium_relevance=medium_relevance,
            low_relevance=low_relevance,
            archived=archived,
            last_decay_run=last_decay_run,
        )

    except Exception as e:
        logger.error(
            "Failed to get decay stats",
            organization_id=organization_id,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=f"Failed to get decay stats: {str(e)}")


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


def _split_recipients(raw: str | None) -> list[str]:
    if not raw:
        return []
    parts = [p.strip() for p in raw.replace(";", ",").split(",")]
    return [p for p in parts if p]


def _format_alerts_text(payload: dict[str, Any]) -> str:
    alerts = payload.get("alerts") or []
    lines: list[str] = []
    status = payload.get("status") or "unknown"
    lines.append(f"Drovi monitoring alert webhook ({status})")
    lines.append("")
    for alert in alerts:
        labels = alert.get("labels") or {}
        annotations = alert.get("annotations") or {}
        alertname = labels.get("alertname") or "Alert"
        severity = labels.get("severity") or "unknown"
        summary = annotations.get("summary") or ""
        description = annotations.get("description") or ""
        starts_at = alert.get("startsAt") or ""
        ends_at = alert.get("endsAt") or ""
        lines.append(f"- {alertname} [{severity}] ({alert.get('status')})")
        if summary:
            lines.append(f"  {summary}")
        if description and description != summary:
            lines.append(f"  {description}")
        if starts_at:
            lines.append(f"  startsAt: {starts_at}")
        if ends_at and ends_at != "0001-01-01T00:00:00Z":
            lines.append(f"  endsAt: {ends_at}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _format_alerts_html(payload: dict[str, Any]) -> str:
    alerts = payload.get("alerts") or []
    status = payload.get("status") or "unknown"
    items: list[str] = []
    for alert in alerts:
        labels = alert.get("labels") or {}
        annotations = alert.get("annotations") or {}
        alertname = labels.get("alertname") or "Alert"
        severity = labels.get("severity") or "unknown"
        summary = annotations.get("summary") or ""
        description = annotations.get("description") or ""
        starts_at = alert.get("startsAt") or ""
        ends_at = alert.get("endsAt") or ""
        items.append(
            "<div style='padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;margin:10px 0;'>"
            f"<div style='font-weight:700;font-size:14px;'>{alertname}</div>"
            f"<div style='font-size:12px;color:#6b7280;margin-top:2px;'>severity: {severity} · status: {alert.get('status')}</div>"
            + (f"<div style='margin-top:10px;font-size:13px;'><b>{summary}</b></div>" if summary else "")
            + (f"<div style='margin-top:6px;font-size:13px;color:#374151;'>{description}</div>" if description and description != summary else "")
            + (f"<div style='margin-top:8px;font-size:12px;color:#6b7280;'>startsAt: {starts_at}</div>" if starts_at else "")
            + (f"<div style='margin-top:2px;font-size:12px;color:#6b7280;'>endsAt: {ends_at}</div>" if ends_at and ends_at != "0001-01-01T00:00:00Z" else "")
            + "</div>"
        )

    return (
        "<div style='font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;'>"
        f"<div style='font-size:16px;font-weight:800;margin-bottom:6px;'>Drovi monitoring alerts</div>"
        f"<div style='font-size:12px;color:#6b7280;margin-bottom:14px;'>status: {status} · alerts: {len(alerts)}</div>"
        + "".join(items)
        + "</div>"
    )


async def _post_slack_webhook(webhook_url: str, text: str) -> bool:
    import httpx

    if not webhook_url:
        return False
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await request_with_retry(
            client,
            "POST",
            webhook_url,
            json={"text": text},
            max_attempts=3,
        )
    return response.status_code < 400


@router.post(
    "/alerts/webhook",
    summary="Alertmanager webhook receiver",
    description="Receives Alertmanager webhooks and forwards to Slack/Email.",
)
async def alertmanager_webhook(
    token: str | None = Query(default=None),
    payload: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    settings = get_settings()

    expected_token = settings.monitoring_alert_webhook_token
    if not expected_token and settings.environment != "production":
        expected_token = "dev"

    if not expected_token:
        logger.warning("Alert webhook is not configured (missing token)")
        raise HTTPException(status_code=503, detail="Alert webhook not configured")

    if token != expected_token:
        raise HTTPException(status_code=401, detail="Invalid alert webhook token")

    alerts = payload.get("alerts") or []
    alert_count = len(alerts)

    # Build a concise subject and message.
    common_labels = payload.get("commonLabels") or {}
    common_alertname = common_labels.get("alertname")
    status = payload.get("status") or ("firing" if any(a.get("status") == "firing" for a in alerts) else "unknown")
    subject = f"[Drovi] {status}: {common_alertname or f'{alert_count} alert(s)'}"

    text_body = _format_alerts_text(payload)
    html_body = _format_alerts_html(payload)

    slack_ok = False
    if settings.monitoring_alert_slack_webhook_url:
        slack_ok = await _post_slack_webhook(settings.monitoring_alert_slack_webhook_url, text_body)

    email_ok = False
    recipients = _split_recipients(settings.monitoring_alert_email_to)
    if recipients:
        email_ok = await send_resend_email(
            to_emails=recipients,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            tags={"type": "monitoring_alert", "status": str(status)},
        )

    logger.info(
        "Alert webhook processed",
        status=status,
        alerts=alert_count,
        slack_ok=slack_ok,
        email_ok=email_ok,
    )

    return {"ok": True, "alerts": alert_count, "slack_ok": slack_ok, "email_ok": email_ok}
