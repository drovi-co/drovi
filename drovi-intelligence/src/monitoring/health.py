"""
Health Checks

Provides health check endpoints for monitoring system status.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import asyncio

import structlog

logger = structlog.get_logger()

# Singleton instance
_health_checker: "HealthCheck | None" = None


class HealthStatus(str, Enum):
    """Health check status."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


@dataclass
class ComponentHealth:
    """Health status of a single component."""

    name: str
    status: HealthStatus
    message: str | None = None
    latency_ms: float | None = None
    details: dict[str, Any] = field(default_factory=dict)
    checked_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "name": self.name,
            "status": self.status.value,
            "message": self.message,
            "latency_ms": self.latency_ms,
            "details": self.details,
            "checked_at": self.checked_at.isoformat(),
        }


@dataclass
class SystemHealth:
    """Overall system health."""

    status: HealthStatus
    components: list[ComponentHealth]
    version: str | None = None
    uptime_seconds: float | None = None
    checked_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "status": self.status.value,
            "components": [c.to_dict() for c in self.components],
            "version": self.version,
            "uptime_seconds": self.uptime_seconds,
            "checked_at": self.checked_at.isoformat(),
        }


class HealthCheck:
    """
    System health checker.

    Checks health of:
    - PostgreSQL database
    - Redis cache
    - FalkorDB graph database
    - LLM service
    - External APIs
    """

    def __init__(self):
        """Initialize health checker."""
        self._start_time = datetime.utcnow()
        self._version = "1.0.0"  # Should be loaded from config

    @property
    def uptime_seconds(self) -> float:
        """Get uptime in seconds."""
        return (datetime.utcnow() - self._start_time).total_seconds()

    async def check_all(self, include_details: bool = False) -> SystemHealth:
        """
        Check health of all components.

        Args:
            include_details: Include detailed information

        Returns:
            SystemHealth with all component statuses
        """
        # Run all checks concurrently
        checks = await asyncio.gather(
            self.check_database(),
            self.check_redis(),
            self.check_graph_database(),
            self.check_llm(),
            return_exceptions=True,
        )

        components = []
        for check in checks:
            if isinstance(check, Exception):
                logger.error("Health check failed", error=str(check))
                components.append(ComponentHealth(
                    name="unknown",
                    status=HealthStatus.UNHEALTHY,
                    message=str(check),
                ))
            else:
                components.append(check)

        # Determine overall status
        statuses = [c.status for c in components]
        if HealthStatus.UNHEALTHY in statuses:
            overall = HealthStatus.UNHEALTHY
        elif HealthStatus.DEGRADED in statuses:
            overall = HealthStatus.DEGRADED
        else:
            overall = HealthStatus.HEALTHY

        return SystemHealth(
            status=overall,
            components=components,
            version=self._version,
            uptime_seconds=self.uptime_seconds,
        )

    async def check_database(self) -> ComponentHealth:
        """Check PostgreSQL database health."""
        import time
        start = time.perf_counter()

        try:
            from src.db.client import get_db_pool

            pool = await get_db_pool()
            async with pool.acquire() as conn:
                result = await conn.fetchval("SELECT 1")

            latency = (time.perf_counter() - start) * 1000

            if result == 1:
                return ComponentHealth(
                    name="postgresql",
                    status=HealthStatus.HEALTHY,
                    latency_ms=latency,
                )
            else:
                return ComponentHealth(
                    name="postgresql",
                    status=HealthStatus.UNHEALTHY,
                    message="Unexpected query result",
                    latency_ms=latency,
                )

        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            return ComponentHealth(
                name="postgresql",
                status=HealthStatus.UNHEALTHY,
                message=str(e),
                latency_ms=latency,
            )

    async def check_redis(self) -> ComponentHealth:
        """Check Redis health."""
        import time
        start = time.perf_counter()

        try:
            import redis.asyncio as redis
            from src.config import get_settings

            settings = get_settings()
            redis_url = getattr(settings, 'redis_url', 'redis://localhost:6379/0')

            client = redis.from_url(str(redis_url))
            pong = await client.ping()
            await client.close()

            latency = (time.perf_counter() - start) * 1000

            if pong:
                return ComponentHealth(
                    name="redis",
                    status=HealthStatus.HEALTHY,
                    latency_ms=latency,
                )
            else:
                return ComponentHealth(
                    name="redis",
                    status=HealthStatus.UNHEALTHY,
                    message="Ping failed",
                    latency_ms=latency,
                )

        except ImportError:
            return ComponentHealth(
                name="redis",
                status=HealthStatus.DEGRADED,
                message="redis package not installed",
            )
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            return ComponentHealth(
                name="redis",
                status=HealthStatus.UNHEALTHY,
                message=str(e),
                latency_ms=latency,
            )

    async def check_graph_database(self) -> ComponentHealth:
        """Check FalkorDB graph database health."""
        import time
        start = time.perf_counter()

        try:
            from src.graph.client import get_graph_client

            client = await get_graph_client()
            # Try a simple query
            # This depends on your graph client implementation
            is_connected = await client.ping() if hasattr(client, 'ping') else True

            latency = (time.perf_counter() - start) * 1000

            if is_connected:
                return ComponentHealth(
                    name="falkordb",
                    status=HealthStatus.HEALTHY,
                    latency_ms=latency,
                )
            else:
                return ComponentHealth(
                    name="falkordb",
                    status=HealthStatus.UNHEALTHY,
                    message="Connection failed",
                    latency_ms=latency,
                )

        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            return ComponentHealth(
                name="falkordb",
                status=HealthStatus.UNHEALTHY,
                message=str(e),
                latency_ms=latency,
            )

    async def check_llm(self) -> ComponentHealth:
        """Check LLM service health."""
        import time
        start = time.perf_counter()

        try:
            from src.llm import get_llm_service

            llm = get_llm_service()
            # Try a minimal request
            response, _ = await llm.complete(
                messages=[{"role": "user", "content": "Hello"}],
                model_tier="fast",
                max_tokens=1,
                node_name="health_check",
            )

            latency = (time.perf_counter() - start) * 1000

            if response:
                return ComponentHealth(
                    name="llm",
                    status=HealthStatus.HEALTHY,
                    latency_ms=latency,
                )
            else:
                return ComponentHealth(
                    name="llm",
                    status=HealthStatus.DEGRADED,
                    message="Empty response",
                    latency_ms=latency,
                )

        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            # LLM is not critical, so mark as degraded
            return ComponentHealth(
                name="llm",
                status=HealthStatus.DEGRADED,
                message=str(e),
                latency_ms=latency,
            )

    async def liveness(self) -> dict[str, Any]:
        """
        Liveness check - is the service running?

        Returns immediately, no external dependencies.
        """
        return {
            "status": "alive",
            "timestamp": datetime.utcnow().isoformat(),
        }

    async def readiness(self) -> dict[str, Any]:
        """
        Readiness check - is the service ready to serve traffic?

        Checks critical dependencies.
        """
        health = await self.check_all()

        # Critical components that must be healthy
        critical = ["postgresql", "falkordb"]
        critical_healthy = all(
            c.status == HealthStatus.HEALTHY
            for c in health.components
            if c.name in critical
        )

        return {
            "status": "ready" if critical_healthy else "not_ready",
            "timestamp": datetime.utcnow().isoformat(),
            "details": health.to_dict() if not critical_healthy else None,
        }


async def get_health_checker() -> HealthCheck:
    """Get or create the singleton health checker."""
    global _health_checker
    if _health_checker is None:
        _health_checker = HealthCheck()
    return _health_checker


# FastAPI router for health endpoints
def create_health_router():
    """Create FastAPI router for health endpoints."""
    from fastapi import APIRouter, Response

    router = APIRouter(tags=["health"])

    @router.get("/health")
    async def health():
        """Full health check."""
        checker = await get_health_checker()
        health = await checker.check_all()
        return health.to_dict()

    @router.get("/health/live")
    async def liveness(response: Response):
        """Kubernetes liveness probe."""
        checker = await get_health_checker()
        result = await checker.liveness()
        return result

    @router.get("/health/ready")
    async def readiness(response: Response):
        """Kubernetes readiness probe."""
        checker = await get_health_checker()
        result = await checker.readiness()
        if result["status"] != "ready":
            response.status_code = 503
        return result

    @router.get("/metrics")
    async def metrics():
        """Prometheus metrics endpoint."""
        try:
            from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
            from fastapi.responses import PlainTextResponse

            return PlainTextResponse(
                generate_latest(),
                media_type=CONTENT_TYPE_LATEST,
            )
        except ImportError:
            return {"error": "prometheus_client not installed"}

    return router
