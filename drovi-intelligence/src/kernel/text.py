"""Text sanitization helpers for ingestion and evidence display."""

from __future__ import annotations

from html import unescape
import re

_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_STRIP_BLOCK_RE = re.compile(
    r"<(script|style|head|title|meta|link)[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_BREAK_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BLOCK_END_RE = re.compile(r"</(p|div|li|tr|h[1-6]|section|article|blockquote)>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_HTML_HINT_RE = re.compile(r"</?[a-z][^>]*>", re.IGNORECASE)
_WHITESPACE_RE = re.compile(r"[ \t\f\v]+")
_NEWLINES_RE = re.compile(r"\n{3,}")


def looks_like_html(value: str | None) -> bool:
    """Return True when text appears to contain HTML markup."""
    if not value:
        return False
    text = value.strip()
    if not text:
        return False
    if "<" not in text or ">" not in text:
        return False
    return bool(_HTML_HINT_RE.search(text))


def sanitize_extraction_text(value: str | None, *, max_length: int | None = None) -> str | None:
    """Normalize text for extraction/evidence usage.

    - Converts HTML-heavy content to plain text.
    - Decodes common HTML entities.
    - Collapses excessive whitespace/newlines.
    - Optionally truncates while preserving readability.
    """
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    is_html = looks_like_html(text)
    if is_html:
        text = _COMMENT_RE.sub(" ", text)
        text = _STRIP_BLOCK_RE.sub(" ", text)
        text = _BREAK_RE.sub("\n", text)
        text = _BLOCK_END_RE.sub("\n", text)
        text = _TAG_RE.sub(" ", text)

    text = unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WHITESPACE_RE.sub(" ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = _NEWLINES_RE.sub("\n\n", text)
    text = text.strip()

    if not text:
        return None

    if max_length and max_length > 3 and len(text) > max_length:
        text = text[: max_length - 3].rstrip() + "..."

    return text
