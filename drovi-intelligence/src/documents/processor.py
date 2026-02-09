"""Document parsing and chunking for Smart Drive.

This module intentionally favors "evidence-first" outputs:
- every chunk includes stable IDs
- every chunk includes a layout index (line blocks + optional bounding boxes)
- PDFs additionally produce per-page PNG images for UI highlighting
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Any

import structlog

logger = structlog.get_logger()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def guess_file_type(file_name: str, mime_type: str | None) -> str:
    name = (file_name or "").lower()
    if name.endswith(".pdf") or (mime_type and "pdf" in mime_type):
        return "pdf"
    if name.endswith(".docx") or (mime_type and "word" in mime_type):
        return "docx"
    if name.endswith(".txt") or (mime_type and mime_type.startswith("text/")):
        return "txt"
    if name.endswith(".md"):
        return "markdown"
    if name.endswith(".csv"):
        return "csv"
    if name.endswith(".pptx"):
        return "pptx"
    if name.endswith(".xlsx"):
        return "xlsx"
    return "unknown"


@dataclass(frozen=True)
class ParsedChunk:
    page_index: int | None
    text: str
    layout_blocks: list[dict[str, Any]]
    page_png_bytes: bytes | None = None


async def parse_document_bytes(
    *,
    file_name: str,
    mime_type: str | None,
    data: bytes,
) -> tuple[str, int | None, list[ParsedChunk], dict[str, Any]]:
    """
    Parse a document into chunks.

    Returns:
    - file_type: normalized type (pdf, docx, txt, ...)
    - page_count: optional
    - chunks: list of parsed chunks (PDF -> per-page chunks)
    - metadata: parser metadata (best-effort)
    """
    file_type = guess_file_type(file_name, mime_type)
    metadata: dict[str, Any] = {"file_type": file_type}

    if file_type == "pdf":
        chunks, page_count, meta = await _parse_pdf_with_ocr(data)
        metadata.update(meta or {})
        return file_type, page_count, chunks, metadata

    # Non-PDF: fall back to existing connector parsers for broad format support.
    try:
        from src.connectors.sources.files.documents import DocumentConnector
    except Exception as exc:  # pragma: no cover
        logger.warning("DocumentConnector unavailable", error=str(exc))
        return file_type, None, [], metadata

    connector = DocumentConnector()
    content, _page_count, meta = await connector._extract_content_from_bytes(data, file_type)  # type: ignore[attr-defined]
    if not content or not str(content).strip():
        return file_type, None, [], metadata

    # Layout blocks for non-PDF are line-based (no bounding boxes).
    from src.parsers.ocr import build_line_layout

    blocks = build_line_layout(str(content), page_index=0)
    chunk = ParsedChunk(page_index=None, text=str(content), layout_blocks=blocks, page_png_bytes=None)
    metadata.update(meta or {})
    return file_type, None, [chunk], metadata


async def _parse_pdf_with_ocr(pdf_bytes: bytes) -> tuple[list[ParsedChunk], int | None, dict[str, Any]]:
    """
    Parse a PDF into per-page chunks using OCR.

    This yields layout blocks with bounding boxes aligned to the rendered PNG images.
    """
    try:
        from pdf2image import convert_from_bytes  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("pdf2image not available; falling back to pypdf", error=str(exc))
        return _parse_pdf_text_only(pdf_bytes)

    pages = convert_from_bytes(pdf_bytes, dpi=150)
    page_count = len(pages)

    chunks: list[ParsedChunk] = []
    for idx, image in enumerate(pages):
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        layout_blocks: list[dict[str, Any]] = []
        text = ""
        try:
            from src.parsers.ocr import extract_ocr_from_image_bytes

            result = extract_ocr_from_image_bytes(png_bytes, page_index=idx)
            if result:
                text = result.text or ""
                layout_blocks = result.blocks or []
        except Exception as exc:  # pragma: no cover - OCR can fail on some pages
            logger.warning("OCR failed for PDF page", page_index=idx, error=str(exc))

        # As a fallback, build line layout so citations still have anchors.
        if not layout_blocks and text.strip():
            from src.parsers.ocr import build_line_layout

            layout_blocks = build_line_layout(text, page_index=idx)

        chunks.append(
            ParsedChunk(
                page_index=idx,
                text=text,
                layout_blocks=layout_blocks,
                page_png_bytes=png_bytes,
            )
        )

    return chunks, page_count, {"ocr_used": True, "dpi": 150}


def _parse_pdf_text_only(pdf_bytes: bytes) -> tuple[list[ParsedChunk], int | None, dict[str, Any]]:
    """Fallback PDF parsing without OCR (no bounding boxes)."""
    try:
        from pypdf import PdfReader
        from src.parsers.ocr import build_line_layout
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("pypdf not available for PDF parsing", error=str(exc))
        return [], None, {"ocr_used": False}

    reader = PdfReader(io.BytesIO(pdf_bytes))
    chunks: list[ParsedChunk] = []
    for idx, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        blocks = build_line_layout(text, page_index=idx) if text.strip() else []
        chunks.append(ParsedChunk(page_index=idx, text=text, layout_blocks=blocks, page_png_bytes=None))
    return chunks, len(reader.pages), {"ocr_used": False}

