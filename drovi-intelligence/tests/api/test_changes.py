"""
API tests for Changes endpoints.

Tests the change detection, diffing, and entity version history APIs.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timedelta

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def make_change_record(
    entity_id: str,
    entity_type: str,
    change_type: str = "updated",
    version: int = 1,
    diff: MagicMock | None = None,
):
    """Create a mock ChangeRecord."""
    record = MagicMock()
    record.entity_id = entity_id
    record.entity_type = entity_type
    record.change_type = change_type
    record.version = version
    record.timestamp = datetime.utcnow()
    record.changed_by = None
    record.change_reason = None
    record.diff = diff
    return record


def make_diff_result(
    entity_id: str,
    entity_type: str,
    old_version: int | None = None,
    new_version: int = 1,
    is_new: bool = False,
    is_deleted: bool = False,
    changes: list | None = None,
):
    """Create a mock DiffResult."""
    diff = MagicMock()
    diff.entity_id = entity_id
    diff.entity_type = entity_type
    diff.old_version = old_version
    diff.new_version = new_version
    diff.is_new = is_new
    diff.is_deleted = is_deleted
    diff.change_summary = "Modified fields"
    diff.changes = changes or []
    return diff


class TestListChangesEndpoint:
    """Tests for GET /changes."""

    async def test_list_changes_success(self, async_client, factory):
        """Test listing changes for an organization."""
        org_id = factory.organization_id()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            # get_changes_since returns list of ChangeRecord objects
            mock_tracker.get_changes_since.return_value = [
                make_change_record("comm_1", "commitment", "updated", 2),
                make_change_record("contact_1", "contact", "created", 1),
            ]
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes",
                params={"organization_id": org_id},
            )

            assert response.status_code == 200
            data = response.json()

            assert "changes" in data
            assert data["total_count"] == 2

    async def test_list_changes_with_time_filter(self, async_client, factory):
        """Test filtering changes by time range."""
        org_id = factory.organization_id()
        since = (datetime.utcnow() - timedelta(hours=24)).isoformat()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_changes_since.return_value = []
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes",
                params={
                    "organization_id": org_id,
                    "since": since,
                },
            )

            assert response.status_code == 200

    async def test_list_changes_with_entity_type_filter(self, async_client, factory):
        """Test filtering changes by entity type."""
        org_id = factory.organization_id()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_changes_since.return_value = [
                make_change_record("comm_1", "commitment", "updated", 2),
            ]
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes",
                params={
                    "organization_id": org_id,
                    "entity_types": "commitment",
                },
            )

            assert response.status_code == 200
            data = response.json()

            for change in data["changes"]:
                assert change["entity_type"] == "commitment"

    async def test_list_changes_pagination(self, async_client, factory):
        """Test pagination of changes."""
        org_id = factory.organization_id()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_changes_since.return_value = [
                make_change_record(f"ent_{i}", "commitment", "updated", i + 1)
                for i in range(10)
            ]
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes",
                params={
                    "organization_id": org_id,
                    "limit": 10,
                },
            )

            assert response.status_code == 200
            data = response.json()

            assert len(data["changes"]) == 10

    async def test_list_changes_requires_org_id(self, async_client):
        """Test changes list requires organization_id."""
        response = await async_client.get("/api/v1/changes")

        assert response.status_code == 422


class TestEntityHistoryEndpoint:
    """Tests for GET /changes/entities/{entity_type}/{entity_id}/history."""

    async def test_get_entity_history_success(self, async_client, factory):
        """Test getting version history for an entity."""
        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            # get_entity_history returns list of ChangeRecord objects
            mock_tracker.get_entity_history.return_value = [
                make_change_record("comm_123", "commitment", "updated", 3),
                make_change_record("comm_123", "commitment", "updated", 2),
                make_change_record("comm_123", "commitment", "created", 1),
            ]
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes/entities/commitment/comm_123/history",
            )

            assert response.status_code == 200
            data = response.json()

            assert data["entity_type"] == "commitment"
            assert data["entity_id"] == "comm_123"
            assert data["current_version"] == 3
            assert len(data["history"]) == 3

    async def test_get_entity_history_limited(self, async_client, factory):
        """Test getting limited version history."""
        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_entity_history.return_value = [
                make_change_record("contact_1", "contact", "updated", 5),
                make_change_record("contact_1", "contact", "updated", 4),
            ]
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes/entities/contact/contact_1/history",
                params={"limit": 2},
            )

            assert response.status_code == 200
            data = response.json()

            assert len(data["history"]) == 2

    async def test_get_entity_history_not_found(self, async_client, factory):
        """Test getting history for non-existent entity."""
        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_entity_history.return_value = []  # Empty list
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes/entities/commitment/nonexistent/history",
            )

            assert response.status_code == 404


class TestCompareVersionsEndpoint:
    """Tests for POST /changes/compare."""

    async def test_compare_versions_success(self, async_client, factory):
        """Test comparing two versions of an entity."""
        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()

            # Create mock field changes
            field_change1 = MagicMock()
            field_change1.field_name = "title"
            field_change1.change_type = MagicMock(value="modified")
            field_change1.old_value = "Original"
            field_change1.new_value = "Updated"

            field_change2 = MagicMock()
            field_change2.field_name = "status"
            field_change2.change_type = MagicMock(value="modified")
            field_change2.old_value = "pending"
            field_change2.new_value = "in_progress"

            # compare_versions returns DiffResult
            diff = make_diff_result(
                "comm_123",
                "commitment",
                old_version=1,
                new_version=3,
                changes=[field_change1, field_change2],
            )
            mock_tracker.compare_versions.return_value = diff
            mock_get.return_value = mock_tracker

            response = await async_client.post(
                "/api/v1/changes/compare",
                json={
                    "entity_type": "commitment",
                    "entity_id": "comm_123",
                    "version1": 1,
                    "version2": 3,
                },
            )

            assert response.status_code == 200
            data = response.json()

            assert data["old_version"] == 1
            assert data["new_version"] == 3
            assert len(data["changes"]) == 2

    async def test_compare_with_latest(self, async_client, factory):
        """Test comparing version with latest (both versions required by API)."""
        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            diff = make_diff_result(
                "dec_1",
                "decision",
                old_version=1,
                new_version=5,
            )
            mock_tracker.compare_versions.return_value = diff
            mock_get.return_value = mock_tracker

            response = await async_client.post(
                "/api/v1/changes/compare",
                json={
                    "entity_type": "decision",
                    "entity_id": "dec_1",
                    "version1": 1,
                    "version2": 5,
                },
            )

            assert response.status_code == 200

    async def test_compare_invalid_versions(self, async_client, factory):
        """Test comparing with versions that don't exist returns 404."""
        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.compare_versions.return_value = None  # Not found
            mock_get.return_value = mock_tracker

            response = await async_client.post(
                "/api/v1/changes/compare",
                json={
                    "entity_type": "commitment",
                    "entity_id": "comm_123",
                    "version1": 999,
                    "version2": 1000,
                },
            )

            assert response.status_code == 404


class TestChangedEntitiesEndpoint:
    """Tests for GET /changes/changed-entities."""

    async def test_get_changed_entities(self, async_client, factory):
        """Test getting list of entities changed in a time period."""
        org_id = factory.organization_id()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            # get_changed_entities returns dict[str, list[str]]
            mock_tracker.get_changed_entities.return_value = {
                "commitment": ["comm_1", "comm_2"],
                "contact": ["contact_1"],
            }
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes/changed-entities",
                params={
                    "organization_id": org_id,
                    "since": (datetime.utcnow() - timedelta(days=7)).isoformat(),
                },
            )

            assert response.status_code == 200
            data = response.json()

            assert "entity_types" in data
            assert data["total_count"] == 3

    async def test_get_changed_entities_filtered(self, async_client, factory):
        """Test getting changed entities filtered by type."""
        org_id = factory.organization_id()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_changed_entities.return_value = {
                "commitment": ["comm_1"],
            }
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes/changed-entities",
                params={
                    "organization_id": org_id,
                    "since": (datetime.utcnow() - timedelta(days=7)).isoformat(),
                    "entity_types": "commitment,decision",
                },
            )

            assert response.status_code == 200


class TestEntityAtTimeEndpoint:
    """Tests for POST /changes/at-time."""

    async def test_get_entity_at_time(self, async_client, factory):
        """Test getting entity state at a specific point in time."""
        target_time = (datetime.utcnow() - timedelta(days=3)).isoformat()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            # get_entity_at_time returns the entity data dict
            mock_tracker.get_entity_at_time.return_value = {
                "title": "Deliver report",
                "status": "pending",
                "due_date": "2024-01-15",
            }
            mock_get.return_value = mock_tracker

            response = await async_client.post(
                "/api/v1/changes/at-time",
                json={
                    "entity_type": "commitment",
                    "entity_id": "comm_123",
                    "at_time": target_time,
                },
            )

            assert response.status_code == 200
            data = response.json()

            assert data["entity_id"] == "comm_123"
            assert "data" in data

    async def test_get_entity_at_time_before_creation(self, async_client, factory):
        """Test getting entity state before it was created."""
        very_old_time = (datetime.utcnow() - timedelta(days=365)).isoformat()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_entity_at_time.return_value = None
            mock_get.return_value = mock_tracker

            response = await async_client.post(
                "/api/v1/changes/at-time",
                json={
                    "entity_type": "commitment",
                    "entity_id": "comm_123",
                    "at_time": very_old_time,
                },
            )

            assert response.status_code == 404


class TestChangesIntegration:
    """Integration tests for change tracking system."""

    async def test_track_modification_and_query(self, async_client, factory):
        """Test tracking a modification and querying the history."""
        org_id = factory.organization_id()
        entity_id = "comm_track_test"

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_entity_history.return_value = [
                make_change_record(entity_id, "commitment", "created", 1),
            ]
            mock_get.return_value = mock_tracker

            # Query history
            history_response = await async_client.get(
                f"/api/v1/changes/entities/commitment/{entity_id}/history",
            )

            assert history_response.status_code == 200
            assert history_response.json()["current_version"] == 1

    async def test_change_types_enumeration(self, async_client, factory):
        """Test all change types are properly represented."""
        org_id = factory.organization_id()

        with patch("src.api.routes.changes.get_change_tracker") as mock_get:
            mock_tracker = AsyncMock()
            mock_tracker.get_changes_since.return_value = [
                make_change_record("1", "commitment", "created", 1),
                make_change_record("2", "commitment", "updated", 2),
                make_change_record("3", "commitment", "deleted", 3),
            ]
            mock_get.return_value = mock_tracker

            response = await async_client.get(
                "/api/v1/changes",
                params={"organization_id": org_id},
            )

            assert response.status_code == 200
            data = response.json()

            change_types = {c["change_type"] for c in data["changes"]}
            assert "created" in change_types
            assert "updated" in change_types
            assert "deleted" in change_types
