"""Health check endpoints."""

from datetime import datetime

import structlog
from fastapi import APIRouter, Response

from src.graph.client import get_graph_client
from src.db.client import get_db_session

router = APIRouter()
logger = structlog.get_logger()

# Track startup time
_startup_time = datetime.utcnow()


@router.get("/health")
async def health_check():
    """
    Basic health check endpoint.
    Returns 200 if the service is running.
    """
    return {
        "status": "healthy",
        "service": "drovi-intelligence",
        "version": "0.1.0",
        "timestamp": datetime.utcnow().isoformat(),
        "uptime_seconds": (datetime.utcnow() - _startup_time).total_seconds(),
    }


@router.get("/ready")
async def readiness_check(response: Response):
    """
    Readiness check endpoint.
    Verifies all dependencies are available.
    """
    checks = {
        "postgres": False,
        "falkordb": False,
    }
    all_healthy = True

    # Check PostgreSQL
    try:
        async with get_db_session() as session:
            await session.execute("SELECT 1")
            checks["postgres"] = True
    except Exception as e:
        logger.warning("PostgreSQL health check failed", error=str(e))
        all_healthy = False

    # Check FalkorDB
    try:
        graph = await get_graph_client()
        await graph.query("RETURN 1")
        checks["falkordb"] = True
    except Exception as e:
        logger.warning("FalkorDB health check failed", error=str(e))
        all_healthy = False

    if not all_healthy:
        response.status_code = 503

    return {
        "status": "ready" if all_healthy else "degraded",
        "checks": checks,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/live")
async def liveness_check():
    """
    Liveness check for Kubernetes.
    Returns 200 if the process is alive.
    """
    return {"status": "alive"}
