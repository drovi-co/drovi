"""Fetch workers for crawler pipeline."""

from src.crawlers.fetch.render_worker import RenderFetchResult, fetch_rendered
from src.crawlers.fetch.static_worker import StaticFetchResult, fetch_static

__all__ = [
    "StaticFetchResult",
    "RenderFetchResult",
    "fetch_static",
    "fetch_rendered",
]
