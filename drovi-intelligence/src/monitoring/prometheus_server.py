"""Optional Prometheus HTTP server for non-API processes.

The API exposes `/metrics` via ASGI. Background workers (Kafka worker, scheduler,
jobs worker) run as standalone processes and can expose their own metrics port
for Prometheus to scrape.

Enable by setting `PROMETHEUS_METRICS_PORT` in the process environment.
"""

from __future__ import annotations

import os

import structlog

logger = structlog.get_logger()

_started = False


def maybe_start_prometheus_http_server(*, component: str) -> None:
    """Start a metrics server if `PROMETHEUS_METRICS_PORT` is configured."""
    global _started
    if _started:
        return

    raw_port = (os.getenv("PROMETHEUS_METRICS_PORT") or "").strip()
    if not raw_port:
        return

    try:
        port = int(raw_port)
        if port <= 0 or port > 65535:
            raise ValueError("port out of range")
    except Exception as exc:
        logger.warning(
            "Invalid PROMETHEUS_METRICS_PORT (metrics server disabled)",
            component=component,
            value=raw_port,
            error=str(exc),
        )
        return

    try:
        from prometheus_client import start_http_server  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning(
            "prometheus_client not available (metrics server disabled)",
            component=component,
            error=str(exc),
        )
        return

    # Listen on all interfaces so the Prometheus container can scrape it.
    start_http_server(port, addr="0.0.0.0")
    _started = True
    logger.info("Prometheus metrics server started", component=component, port=port)

