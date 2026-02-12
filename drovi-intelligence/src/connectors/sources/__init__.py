"""Connector source implementations.

This package groups connector implementations by vertical (email, messaging, etc).
Keep this `__init__` import-free to avoid circular imports when importing
submodules like `src.connectors.sources.calendar.google_calendar_definition`.
"""

from __future__ import annotations

