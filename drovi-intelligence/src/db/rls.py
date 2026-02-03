"""Row-level security (RLS) context helpers."""

from __future__ import annotations

from contextvars import ContextVar
from contextlib import contextmanager

_org_id_var: ContextVar[str | None] = ContextVar("rls_org_id", default=None)
_internal_var: ContextVar[bool] = ContextVar("rls_internal", default=False)


def set_rls_context(organization_id: str | None, is_internal: bool = False) -> None:
    """Set the current organization id for RLS policies."""
    _org_id_var.set(organization_id)
    _internal_var.set(is_internal)


def get_rls_context() -> str | None:
    """Get the current organization id for RLS policies."""
    return _org_id_var.get()


def is_rls_internal() -> bool:
    """Whether the current context is internal (bypasses org filter)."""
    return _internal_var.get()


@contextmanager
def rls_context(organization_id: str | None, is_internal: bool = False):
    """Context manager to set and restore RLS context."""
    token_org = _org_id_var.set(organization_id)
    token_internal = _internal_var.set(is_internal)
    try:
        yield
    finally:
        _org_id_var.reset(token_org)
        _internal_var.reset(token_internal)
