"""Connector registry bootstrap.

Connectors register themselves with `ConnectorRegistry` at import time. To avoid
missing connectors in processes that only import the base registry, we provide
an explicit bootstrap hook that imports the connector modules once for their
side-effects.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger()

_bootstrapped = False


def ensure_connectors_registered() -> None:
    global _bootstrapped
    if _bootstrapped:
        return

    # Import the top-level `src.connectors` package which imports connector
    # implementations and registers them into ConnectorRegistry.
    import src.connectors  # noqa: F401

    _bootstrapped = True
    logger.debug("Connector registry bootstrapped")

