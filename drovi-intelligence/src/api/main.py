"""
Drovi Intelligence Backend - FastAPI Application

State-of-the-art AI backend for the Drovi Intelligence Platform.
Provides:
- Intelligence extraction via LangGraph orchestrator
- Knowledge graph operations via FalkorDB
- Agentic memory with temporal awareness
- Hybrid search (vector + fulltext + graph)
"""

import logging
import structlog
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app

from src.api.middleware import (
    SecurityHeadersMiddleware,
    RequestIDMiddleware,
    RateLimitMiddleware,
    get_cors_origins,
)

from src.config import get_settings
from src.api.routes import (
    analyze,
    analytics,
    actuations,
    audit,
    api_keys,
    ask,
    auth,
    brief,
    content,
    changes,
    jobs,
    connections,
    console,
    contacts,
    continuums,
    continuum_exchange,
    contradictions,
    customer,
    events,
    evidence,
    guardrails,
    graph,
    health,
    live_sessions,
    memory,
    monitoring,
    org,
    patterns,
    personalization,
    search,
    sensors,
    sessions,
    signals,
    stream,
    uios,
    workflows,
    trust,
    simulations,
)
from src.mcp.http import router as mcp_router
from src.connectors.webhooks import webhook_router
from src.connectors.scheduling.scheduler import init_scheduler, shutdown_scheduler
from src.continuum.runtime import init_continuum_scheduler, shutdown_continuum_scheduler
from src.graph.client import get_graph_client, close_graph_client
from src.db.client import init_db, close_db
from src.streaming import init_streaming, shutdown_streaming

# Map log level string to logging constant
_LOG_LEVEL_MAP = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}

def _get_log_level() -> int:
    """Get numeric log level from settings."""
    level_str = get_settings().log_level.lower()
    return _LOG_LEVEL_MAP.get(level_str, logging.INFO)

# Configure structured logging
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer()
        if get_settings().log_format == "json"
        else structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(_get_log_level()),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan - startup and shutdown."""
    settings = get_settings()

    # Startup
    logger.info(
        "Starting Drovi Intelligence Backend",
        version="0.1.0",
        falkordb_host=settings.falkordb_host,
        falkordb_port=settings.falkordb_port,
    )

    # Initialize database connection
    await init_db()
    logger.info("PostgreSQL connection initialized")

    # Initialize FalkorDB connection (skip for tests)
    if settings.environment == "test":
        logger.info("Skipping FalkorDB initialization in test environment")
    else:
        graph_client = await get_graph_client()
        await graph_client.initialize_indexes()
        logger.info("FalkorDB connection initialized with indexes")

    # Initialize connector scheduler (optional)
    settings = get_settings()
    if settings.environment == "test":
        logger.info("Skipping connector scheduler in test environment")
    elif settings.scheduler_run_in_api:
        await init_scheduler()
        logger.info("Connector scheduler initialized")
    else:
        logger.info("Connector scheduler disabled in API process")

    # Initialize Continuum scheduler
    if settings.environment == "test":
        logger.info("Skipping Continuum scheduler in test environment")
    elif settings.continuum_scheduler_run_in_api:
        await init_continuum_scheduler()
        logger.info("Continuum scheduler initialized")
    else:
        logger.info("Continuum scheduler disabled in API process")

    # Initialize Kafka streaming (if enabled)
    if settings.environment == "test":
        logger.info("Skipping Kafka streaming in test environment")
    else:
        streaming_started = await init_streaming()
        if streaming_started:
            logger.info("Kafka streaming infrastructure initialized")
        else:
            logger.info("Running without Kafka streaming (disabled or unavailable)")

    yield

    # Shutdown
    logger.info("Shutting down Drovi Intelligence Backend")
    await shutdown_streaming()
    if get_settings().scheduler_run_in_api and get_settings().environment != "test":
        await shutdown_scheduler()
    if get_settings().continuum_scheduler_run_in_api and get_settings().environment != "test":
        await shutdown_continuum_scheduler()
    await close_graph_client()
    await close_db()


# Create FastAPI application
app = FastAPI(
    title="Drovi Intelligence API",
    description="State-of-the-art AI backend for intelligence extraction, knowledge graph, and agentic memory",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Security middleware (order matters - first added = last executed)
settings = get_settings()

# Rate limiting (applied first to reject early)
if settings.environment == "production":
    app.add_middleware(
        RateLimitMiddleware,
        requests_per_minute=100,
        burst_limit=20,
    )

# Request ID tracking
app.add_middleware(RequestIDMiddleware)

# Security headers
app.add_middleware(SecurityHeadersMiddleware)

# CORS middleware (must be after security headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# Note: CSRF middleware is optional - pilot surface uses httpOnly cookies
# which provide CSRF protection via SameSite=Lax. Enable if needed:
# app.add_middleware(CSRFMiddleware)

# Prometheus metrics endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(brief.router, prefix="/api/v1", tags=["Brief"])
app.include_router(evidence.router, prefix="/api/v1", tags=["Evidence"])
app.include_router(analyze.router, prefix="/api/v1", tags=["Analysis"])
app.include_router(analytics.router, prefix="/api/v1", tags=["Analytics"])
app.include_router(actuations.router, prefix="/api/v1", tags=["Actuations"])
app.include_router(audit.router, prefix="/api/v1", tags=["Audit"])
app.include_router(console.router, prefix="/api/v1", tags=["Console"])
app.include_router(customer.router, prefix="/api/v1", tags=["Customer Context"])
app.include_router(graph.router, prefix="/api/v1", tags=["Graph"])
app.include_router(memory.router, prefix="/api/v1", tags=["Memory"])
app.include_router(search.router, prefix="/api/v1", tags=["Search"])
app.include_router(content.router, prefix="/api/v1", tags=["Content"])
app.include_router(uios.router, prefix="/api/v1", tags=["UIOs"])
app.include_router(mcp_router, prefix="/api/v1", tags=["MCP"])
app.include_router(connections.router, prefix="/api/v1", tags=["Connections"])
app.include_router(contacts.router, prefix="/api/v1", tags=["Contacts"])
app.include_router(continuums.router, prefix="/api/v1", tags=["Continuums"])
app.include_router(continuum_exchange.router, prefix="/api/v1", tags=["Continuum Exchange"])
app.include_router(contradictions.router, prefix="/api/v1", tags=["Contradictions"])
app.include_router(webhook_router, prefix="/api/v1", tags=["Webhooks"])
app.include_router(events.router, prefix="/api/v1", tags=["Events"])
app.include_router(signals.router, prefix="/api/v1", tags=["Signals"])
app.include_router(live_sessions.router, prefix="/api/v1", tags=["Live Sessions"])
app.include_router(sessions.router, prefix="/api/v1", tags=["Sessions"])
app.include_router(changes.router, prefix="/api/v1", tags=["Changes"])
app.include_router(monitoring.router, prefix="/api/v1", tags=["Monitoring"])
app.include_router(api_keys.router, prefix="/api/v1", tags=["API Keys"])
app.include_router(jobs.router, prefix="/api/v1", tags=["Jobs"])
app.include_router(stream.router, prefix="/api/v1", tags=["Real-Time Stream"])
app.include_router(ask.router, prefix="/api/v1", tags=["Natural Language Query"])
app.include_router(workflows.router, prefix="/api/v1", tags=["Agent Workflows"])
app.include_router(auth.router, prefix="/api/v1", tags=["Authentication"])
app.include_router(org.router, prefix="/api/v1", tags=["Organization Management"])
app.include_router(patterns.router, prefix="/api/v1", tags=["Patterns"])
app.include_router(personalization.router, prefix="/api/v1", tags=["Personalization"])
app.include_router(guardrails.router, prefix="/api/v1", tags=["Guardrails"])
app.include_router(sensors.router, prefix="/api/v1", tags=["Sensors"])
app.include_router(trust.router, prefix="/api/v1", tags=["Trust"])
app.include_router(simulations.router, prefix="/api/v1", tags=["Simulations"])


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "Drovi Intelligence API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
        "metrics": "/metrics",
    }
