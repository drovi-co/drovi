"""Explicit connector definition registry.

Why explicit:
- Deterministic load order (important for tests and audits).
- No dynamic import magic.
- Can be used by UI listing endpoints without importing heavy connector implementations.
"""

from __future__ import annotations

from collections.abc import Iterable

from src.connectors.definitions.models import ConnectorDefinition, RequiredSetting
from src.connectors.definitions.oauth_providers import get_oauth_provider_spec

# Light-weight imports only: definition modules must not import connector implementations.
from src.connectors.sources.calendar.google_calendar_definition import CONNECTOR_DEFINITION as GOOGLE_CALENDAR
from src.connectors.sources.crm.hubspot_definition import CONNECTOR_DEFINITION as HUBSPOT
from src.connectors.sources.databases.mongodb_definition import CONNECTOR_DEFINITION as MONGODB
from src.connectors.sources.databases.mysql_definition import CONNECTOR_DEFINITION as MYSQL
from src.connectors.sources.databases.postgres_definition import CONNECTOR_DEFINITION as POSTGRES
from src.connectors.sources.email.gmail.definition import CONNECTOR_DEFINITION as GMAIL
from src.connectors.sources.email.outlook.definition import CONNECTOR_DEFINITION as OUTLOOK
from src.connectors.sources.files.documents_definition import CONNECTOR_DEFINITION as DOCUMENTS
from src.connectors.sources.messaging.slack.definition import CONNECTOR_DEFINITION as SLACK
from src.connectors.sources.messaging.teams.definition import CONNECTOR_DEFINITION as TEAMS
from src.connectors.sources.messaging.whatsapp.definition import CONNECTOR_DEFINITION as WHATSAPP
from src.connectors.sources.productivity.google_docs.definition import CONNECTOR_DEFINITION as GOOGLE_DOCS
from src.connectors.sources.productivity.notion.definition import CONNECTOR_DEFINITION as NOTION
from src.connectors.sources.storage.bigquery_definition import CONNECTOR_DEFINITION as BIGQUERY
from src.connectors.sources.storage.s3_definition import CONNECTOR_DEFINITION as S3


_DEFINITIONS: tuple[ConnectorDefinition, ...] = (
    # Email
    GMAIL,
    OUTLOOK,
    # Messaging
    SLACK,
    TEAMS,
    WHATSAPP,
    # Calendar
    GOOGLE_CALENDAR,
    # Productivity
    NOTION,
    GOOGLE_DOCS,
    # CRM
    HUBSPOT,
    # Storage
    S3,
    BIGQUERY,
    # Databases
    POSTGRES,
    MYSQL,
    MONGODB,
    # Files
    DOCUMENTS,
)

_BY_TYPE: dict[str, ConnectorDefinition] = {d.connector_type: d for d in _DEFINITIONS}


def list_connector_definitions() -> list[ConnectorDefinition]:
    return list(_DEFINITIONS)


def get_connector_definition(connector_type: str) -> ConnectorDefinition | None:
    return _BY_TYPE.get(connector_type)


def required_settings_for(definition: ConnectorDefinition) -> tuple[RequiredSetting, ...]:
    if definition.required_settings:
        return definition.required_settings
    if not definition.oauth_provider:
        return ()
    spec = get_oauth_provider_spec(definition.oauth_provider)
    if not spec:
        return ()
    return spec.required_settings


def iter_required_settings(connector_type: str) -> Iterable[RequiredSetting]:
    definition = get_connector_definition(connector_type)
    if not definition:
        return ()
    return required_settings_for(definition)

