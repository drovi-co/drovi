"""Parser templates for crawl source families."""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
import re
from typing import Any
from urllib.parse import urlparse


TAG_RE = re.compile(r"<[^>]+>")
SCRIPT_RE = re.compile(r"<(script|style)[^>]*>.*?</\\1>", flags=re.I | re.S)
WHITESPACE_RE = re.compile(r"\s+")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", flags=re.I | re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", flags=re.I | re.S)


@dataclass(frozen=True)
class ParsedDocument:
    template_type: str
    title: str | None
    text: str
    metadata: dict[str, Any]


def _clean_html_text(html: str) -> str:
    without_script = SCRIPT_RE.sub(" ", html or "")
    text = TAG_RE.sub(" ", without_script)
    text = unescape(text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    return text


def _extract_title(html: str) -> str | None:
    for pattern in (TITLE_RE, H1_RE):
        match = pattern.search(html or "")
        if match:
            cleaned = _clean_html_text(match.group(1))
            if cleaned:
                return cleaned[:500]
    return None


def _decode_payload(payload: bytes, content_type: str | None) -> str:
    text_like = not content_type or any(
        token in content_type.lower()
        for token in ("text/", "json", "xml", "html")
    )
    if text_like:
        try:
            return payload.decode("utf-8", errors="replace")
        except Exception:
            return payload.decode("latin-1", errors="replace")
    return ""


def detect_template_type(*, url: str, content_type: str | None) -> str:
    lower_content_type = (content_type or "").lower()
    host = (urlparse(url).hostname or "").lower()
    path = (urlparse(url).path or "").lower()

    if "pdf" in lower_content_type or path.endswith(".pdf"):
        return "pdf"
    if any(token in path for token in ("/case", "/cases", "/opinion", "/court")):
        return "legal_doc"
    if any(token in path for token in ("/filing", "/edgar", "/sec")):
        return "filing"
    if any(token in path for token in ("/bulletin", "/notice", "/gazette")):
        return "bulletin"
    if any(token in host for token in ("news", "reuters", "bloomberg", "ft.com")):
        return "news"
    if "html" in lower_content_type:
        return "html"
    if "json" in lower_content_type:
        return "json"
    if "xml" in lower_content_type:
        return "xml"
    return "generic"


def parse_payload(
    *,
    url: str,
    content_type: str | None,
    payload: bytes,
    response_headers: dict[str, str] | None = None,
) -> ParsedDocument:
    template_type = detect_template_type(url=url, content_type=content_type)
    text_payload = _decode_payload(payload, content_type)
    response_headers = response_headers or {}

    if template_type in {"news", "html", "legal_doc", "filing", "bulletin"}:
        title = _extract_title(text_payload)
        text = _clean_html_text(text_payload)
    elif template_type == "json":
        title = None
        # Keep compact deterministic text view for downstream diffing.
        text = WHITESPACE_RE.sub(" ", text_payload.replace("\n", " ")).strip()
    elif template_type == "xml":
        title = None
        text = _clean_html_text(text_payload)
    elif template_type == "pdf":
        # PDF OCR/extraction can be delegated to future workers. Keep traceable marker.
        title = None
        text = ""
    else:
        title = None
        text = text_payload[:20000]

    metadata = {
        "template_type": template_type,
        "content_type": content_type,
        "payload_size_bytes": len(payload or b""),
        "headers": response_headers,
        "title": title,
    }
    return ParsedDocument(
        template_type=template_type,
        title=title,
        text=text,
        metadata=metadata,
    )
