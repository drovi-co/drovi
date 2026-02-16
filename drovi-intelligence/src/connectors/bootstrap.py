"""Connector registry bootstrap.

Connectors register themselves with `ConnectorRegistry` at import time. To avoid
missing connectors in processes that only import the base registry, we provide
an explicit bootstrap hook that imports the connector implementation modules
once for their side-effects.

Why not `import src.connectors`?
Importing a submodule like `src.connectors.http` runs `src/connectors/__init__.py`
first. If that module eagerly imports connector implementations, it creates
circular-import hazards across the codebase. We keep `src.connectors` lightweight
and bootstrap registration explicitly here.
"""

from __future__ import annotations

from importlib import import_module

import structlog

logger = structlog.get_logger()

_bootstrapped = False


def ensure_connectors_registered() -> None:
    global _bootstrapped
    if _bootstrapped:
        return

    connector_modules = (
        # Email
        "src.connectors.sources.email.gmail.connector",
        "src.connectors.sources.email.outlook.connector",
        # Messaging
        "src.connectors.sources.messaging.slack.connector",
        "src.connectors.sources.messaging.teams.connector",
        "src.connectors.sources.messaging.whatsapp.connector",
        # Calendar
        "src.connectors.sources.calendar.google_calendar",
        # Productivity
        "src.connectors.sources.productivity.notion.connector",
        "src.connectors.sources.productivity.google_docs.connector",
        # CRM
        "src.connectors.sources.crm.hubspot",
        # Storage
        "src.connectors.sources.storage.s3",
        "src.connectors.sources.storage.bigquery",
        # Databases
        "src.connectors.sources.databases.postgres",
        "src.connectors.sources.databases.mysql",
        "src.connectors.sources.databases.mongodb",
        # Files
        "src.connectors.sources.files.documents",
    )

    failures: list[str] = []
    for module_path in connector_modules:
        try:
            import_module(module_path)
        except Exception as exc:  # pragma: no cover
            failures.append(module_path)
            logger.warning(
                "Failed to import connector module for registration",
                module=module_path,
                error=str(exc),
            )

    _bootstrapped = True
    logger.debug("Connector registry bootstrapped", failures=len(failures))
