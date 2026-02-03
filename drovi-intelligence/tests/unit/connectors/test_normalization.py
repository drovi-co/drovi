"""
Unit tests for connector normalization helpers.
"""

import pytest

from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig
from src.connectors.base.records import Record, RecordType
from src.connectors.normalization import normalize_record_for_pipeline

pytestmark = pytest.mark.unit


def _base_config() -> ConnectorConfig:
    return ConnectorConfig(
        connection_id="conn_123",
        organization_id="org_456",
        connector_type="test",
        name="Test Connection",
        auth=AuthConfig(auth_type=AuthType.NONE),
    )


def test_normalize_document_record():
    """Normalize document records into canonical content + metadata."""
    record = Record(
        record_id="doc_1",
        source_type="notion",
        stream_name="documents",
        record_type=RecordType.DOCUMENT,
        data={
            "title": "Project Plan",
            "content_text": "Kickoff on Monday.",
            "owner_email": "owner@example.com",
        },
        cursor_value="2024-01-01T00:00:00Z",
        raw_data_hash="hash123",
    )

    normalized = normalize_record_for_pipeline(
        record=record,
        connector=object(),
        config=_base_config(),
        default_source_type="notion",
    )

    assert "Title: Project Plan" in normalized.content
    assert "Kickoff on Monday." in normalized.content
    assert normalized.subject == "Project Plan"
    assert normalized.user_email == "owner@example.com"
    assert normalized.metadata["record_type"] == "document"
    assert normalized.metadata["record_id"] == "doc_1"
    assert normalized.metadata["raw_data_hash"] == "hash123"


def test_normalize_event_record():
    """Normalize event records into canonical content + metadata."""
    record = Record(
        record_id="event_1",
        source_type="calendar",
        stream_name="events",
        record_type=RecordType.EVENT,
        data={
            "summary": "Weekly Sync",
            "description": "Review open items.",
            "start_time": "2024-02-01T10:00:00Z",
            "end_time": "2024-02-01T11:00:00Z",
        },
        cursor_value="2024-02-01T10:00:00Z",
        raw_data_hash="hash456",
    )

    normalized = normalize_record_for_pipeline(
        record=record,
        connector=object(),
        config=_base_config(),
        default_source_type="calendar",
    )

    assert "Weekly Sync" in normalized.content
    assert "Review open items." in normalized.content
    assert normalized.subject == "Weekly Sync"
    assert normalized.metadata["record_type"] == "event"
    assert normalized.metadata["record_id"] == "event_1"
    assert normalized.metadata["raw_data_hash"] == "hash456"
