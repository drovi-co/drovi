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

from src.config import get_settings
from src.api.routes import analyze, graph, health, memory, search, uios
from src.graph.client import get_graph_client, close_graph_client
from src.db.client import init_db, close_db

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

    # Initialize FalkorDB connection
    graph_client = await get_graph_client()
    await graph_client.initialize_indexes()
    logger.info("FalkorDB connection initialized with indexes")

    yield

    # Shutdown
    logger.info("Shutting down Drovi Intelligence Backend")
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

# CORS middleware
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus metrics endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)

# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(analyze.router, prefix="/api/v1", tags=["Analysis"])
app.include_router(graph.router, prefix="/api/v1", tags=["Graph"])
app.include_router(memory.router, prefix="/api/v1", tags=["Memory"])
app.include_router(search.router, prefix="/api/v1", tags=["Search"])
app.include_router(uios.router, prefix="/api/v1", tags=["UIOs"])


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
