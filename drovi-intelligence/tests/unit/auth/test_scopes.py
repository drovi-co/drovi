"""
Unit tests for API Scopes.

Tests scope definitions and hierarchy.
"""

import pytest

from src.auth.scopes import (
    Scope,
    has_scope,
    get_default_scopes,
    get_all_scopes,
    SCOPE_HIERARCHY,
)

pytestmark = pytest.mark.unit


# =============================================================================
# Scope Enum Tests
# =============================================================================


class TestScopeEnum:
    """Tests for Scope enum."""

    def test_read_scope(self):
        """Test READ scope value."""
        assert Scope.READ.value == "read"

    def test_write_scope(self):
        """Test WRITE scope value."""
        assert Scope.WRITE.value == "write"

    def test_admin_scope(self):
        """Test ADMIN scope value."""
        assert Scope.ADMIN.value == "admin"

    def test_internal_scope(self):
        """Test INTERNAL scope value."""
        assert Scope.INTERNAL.value == "internal"

    def test_all_scopes_are_strings(self):
        """Test all scope values are strings."""
        for scope in Scope:
            assert isinstance(scope.value, str)


# =============================================================================
# has_scope Tests
# =============================================================================


class TestHasScope:
    """Tests for has_scope function."""

    def test_direct_match(self):
        """Test direct scope match."""
        assert has_scope(["read"], "read") is True
        assert has_scope(["read", "write"], "write") is True

    def test_no_match(self):
        """Test scope not in list."""
        assert has_scope(["read"], "write") is False
        assert has_scope([], "read") is False

    def test_wildcard_grants_all(self):
        """Test wildcard grants all scopes."""
        assert has_scope(["*"], "read") is True
        assert has_scope(["*"], "admin") is True
        assert has_scope(["*"], "anything") is True

    def test_admin_includes_all(self):
        """Test ADMIN scope includes all lower scopes."""
        assert has_scope(["admin"], "read") is True
        assert has_scope(["admin"], "write") is True
        assert has_scope(["admin"], "read:graph") is True
        assert has_scope(["admin"], "mcp") is True

    def test_internal_includes_all(self):
        """Test INTERNAL scope includes all scopes."""
        assert has_scope(["internal"], "read") is True
        assert has_scope(["internal"], "admin") is True
        assert has_scope(["internal"], "manage:keys") is True

    def test_write_includes_read(self):
        """Test WRITE includes READ."""
        assert has_scope(["write"], "read") is True

    def test_hierarchy_does_not_escalate(self):
        """Test lower scopes don't grant higher ones."""
        assert has_scope(["read"], "write") is False
        assert has_scope(["read"], "admin") is False
        assert has_scope(["write"], "admin") is False


# =============================================================================
# get_default_scopes Tests
# =============================================================================


class TestGetDefaultScopes:
    """Tests for get_default_scopes function."""

    def test_returns_list(self):
        """Test returns a list."""
        scopes = get_default_scopes()
        assert isinstance(scopes, list)

    def test_includes_read(self):
        """Test default includes read."""
        scopes = get_default_scopes()
        assert "read" in scopes

    def test_includes_write(self):
        """Test default includes write."""
        scopes = get_default_scopes()
        assert "write" in scopes

    def test_includes_mcp(self):
        """Test default includes mcp."""
        scopes = get_default_scopes()
        assert "mcp" in scopes

    def test_does_not_include_admin(self):
        """Test default does not include admin."""
        scopes = get_default_scopes()
        assert "admin" not in scopes


# =============================================================================
# get_all_scopes Tests
# =============================================================================


class TestGetAllScopes:
    """Tests for get_all_scopes function."""

    def test_returns_all_scopes(self):
        """Test returns all scope values."""
        scopes = get_all_scopes()

        assert "read" in scopes
        assert "write" in scopes
        assert "admin" in scopes
        assert "internal" in scopes
        assert "mcp" in scopes

    def test_count_matches_enum(self):
        """Test count matches Scope enum."""
        scopes = get_all_scopes()
        assert len(scopes) == len(Scope)


# =============================================================================
# Scope Hierarchy Tests
# =============================================================================


class TestScopeHierarchy:
    """Tests for scope hierarchy definition."""

    def test_admin_hierarchy(self):
        """Test ADMIN hierarchy includes expected scopes."""
        admin_implied = SCOPE_HIERARCHY[Scope.ADMIN]

        assert Scope.READ in admin_implied
        assert Scope.WRITE in admin_implied
        assert Scope.READ_GRAPH in admin_implied
        assert Scope.MANAGE_KEYS in admin_implied

    def test_internal_hierarchy(self):
        """Test INTERNAL hierarchy includes ADMIN."""
        internal_implied = SCOPE_HIERARCHY[Scope.INTERNAL]

        assert Scope.ADMIN in internal_implied
        assert Scope.READ in internal_implied

    def test_write_hierarchy(self):
        """Test WRITE hierarchy includes READ."""
        write_implied = SCOPE_HIERARCHY[Scope.WRITE]

        assert Scope.READ in write_implied
