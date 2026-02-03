"""Shared extraction utilities for chunking and evidence spans."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Iterable, TypeVar

from src.orchestrator.state import EvidenceSpan, ParsedMessage


@dataclass(frozen=True)
class ContentChunk:
    """A content chunk mapped back to its source message."""

    content: str
    message_id: str | None
    message_index: int
    chunk_index: int
    chunk_start: int
    chunk_end: int


def build_extraction_chunks(
    messages: list[ParsedMessage],
    max_chunk_chars: int = 4000,
    overlap: int = 200,
) -> list[ContentChunk]:
    """Split messages into chunks for extraction while preserving message IDs."""
    chunks: list[ContentChunk] = []
    for message_index, message in enumerate(messages):
        text = (message.content or "").strip()
        if not text:
            continue
        if len(text) <= max_chunk_chars:
            chunks.append(
                ContentChunk(
                    content=text,
                    message_id=message.id,
                    message_index=message_index,
                    chunk_index=0,
                    chunk_start=0,
                    chunk_end=len(text),
                )
            )
            continue

        chunk_start = 0
        chunk_index = 0
        while chunk_start < len(text):
            target_end = min(chunk_start + max_chunk_chars, len(text))
            if target_end >= len(text):
                chunk_end = len(text)
            else:
                chunk_end = _find_breakpoint(text, chunk_start, target_end)
            chunk_content = text[chunk_start:chunk_end].strip()
            if chunk_content:
                chunks.append(
                    ContentChunk(
                        content=chunk_content,
                        message_id=message.id,
                        message_index=message_index,
                        chunk_index=chunk_index,
                        chunk_start=chunk_start,
                        chunk_end=chunk_end,
                    )
                )
                chunk_index += 1
            if chunk_end >= len(text):
                break
            chunk_start = max(chunk_end - overlap, 0)

    return chunks


def _find_breakpoint(text: str, start: int, target_end: int) -> int:
    """Find a reasonable breakpoint near target_end to avoid splitting mid-sentence."""
    if target_end >= len(text):
        return len(text)

    window_start = max(start, target_end - 300)
    window = text[window_start:target_end]
    for sep in ("\n\n", "\n", ". ", "? ", "! "):
        idx = window.rfind(sep)
        if idx != -1:
            return window_start + idx + len(sep)
    return target_end


def find_quote_span(text: str, quote: str | None) -> tuple[int | None, int | None]:
    """Locate a quoted span in text. Returns (start, end) or (None, None)."""
    if not text or not quote:
        return None, None

    direct_index = text.find(quote)
    if direct_index != -1:
        return direct_index, direct_index + len(quote)

    stripped = " ".join(quote.split())
    if not stripped:
        return None, None

    lowered_text = text.lower()
    lowered_quote = stripped.lower()
    lowered_index = lowered_text.find(lowered_quote)
    if lowered_index != -1:
        return lowered_index, lowered_index + len(lowered_quote)

    pattern = re.escape(stripped).replace("\\ ", r"\\s+")
    match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
    if match:
        return match.start(), match.end()

    return None, None


def normalize_key(value: str | None) -> str:
    """Normalize a text value for deduplication keys."""
    if not value:
        return ""
    lowered = value.lower()
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", lowered)
    return " ".join(cleaned.split())


T = TypeVar("T")


def merge_by_key(
    items: Iterable[T],
    key_fn: Callable[[T], str],
    merge_fn: Callable[[T, T], T],
) -> list[T]:
    """Merge items by key using merge_fn to combine duplicates."""
    merged: dict[str, T] = {}
    for item in items:
        key = key_fn(item)
        if not key:
            key = f"_none_{id(item)}"
        if key not in merged:
            merged[key] = item
        else:
            merged[key] = merge_fn(merged[key], item)
    return list(merged.values())


def build_supporting_evidence(
    messages: list[ParsedMessage],
    quoted_text: str | None,
    primary_message_id: str | None,
) -> list[EvidenceSpan]:
    """Find additional evidence spans for the same quote across other messages."""
    if not quoted_text:
        return []

    evidence: list[EvidenceSpan] = []
    for message in messages:
        if primary_message_id and message.id == primary_message_id:
            continue
        start, end = find_quote_span(message.content or "", quoted_text)
        if start is None or end is None:
            continue
        evidence.append(
            EvidenceSpan(
                quoted_text=quoted_text,
                source_message_id=message.id,
                quoted_text_start=start,
                quoted_text_end=end,
            )
        )
    return evidence
