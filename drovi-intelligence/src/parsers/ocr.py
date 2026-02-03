"""OCR utilities for image and PDF extraction with layout metadata."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import io

import structlog

logger = structlog.get_logger()


@dataclass
class OCRResult:
    text: str
    blocks: list[dict[str, Any]]
    page_count: int


def build_line_layout(text: str, page_index: int = 0) -> list[dict[str, Any]]:
    """Build simple layout blocks from text lines when bounding boxes are unavailable."""
    blocks: list[dict[str, Any]] = []
    for line_index, line in enumerate([l.strip() for l in text.splitlines() if l.strip()]):
        blocks.append(
            {
                "page_index": page_index,
                "line_index": line_index,
                "block_index": line_index,
                "text": line,
                "left": 0,
                "top": 0,
                "width": 0,
                "height": 0,
                "confidence": None,
            }
        )
    return blocks


def _extract_ocr_from_image(image, page_index: int = 0) -> OCRResult | None:
    try:
        import pytesseract  # type: ignore
        from pytesseract import Output  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("pytesseract not available for OCR", error=str(exc))
        return None

    try:
        data = pytesseract.image_to_data(image, output_type=Output.DICT)
    except Exception as exc:  # pragma: no cover - OCR failures
        logger.warning("OCR extraction failed", error=str(exc))
        return None

    line_map: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    text_items = data.get("text", [])
    for idx, text in enumerate(text_items):
        if not text or not str(text).strip():
            continue
        key = (
            int(data.get("block_num", [0])[idx]),
            int(data.get("par_num", [0])[idx]),
            int(data.get("line_num", [0])[idx]),
        )
        line_map.setdefault(key, []).append(
            {
                "text": str(text).strip(),
                "left": int(data.get("left", [0])[idx]),
                "top": int(data.get("top", [0])[idx]),
                "width": int(data.get("width", [0])[idx]),
                "height": int(data.get("height", [0])[idx]),
                "conf": float(data.get("conf", [0])[idx]) if data.get("conf") else None,
            }
        )

    blocks: list[dict[str, Any]] = []
    for block_index, ((block_num, _par_num, line_num), words) in enumerate(
        sorted(
            line_map.items(),
            key=lambda item: (min(w["top"] for w in item[1]), min(w["left"] for w in item[1])),
        )
    ):
        line_text = " ".join(word["text"] for word in words)
        left = min(word["left"] for word in words)
        top = min(word["top"] for word in words)
        right = max(word["left"] + word["width"] for word in words)
        bottom = max(word["top"] + word["height"] for word in words)
        confidences = [word["conf"] for word in words if word.get("conf") is not None and word["conf"] >= 0]
        avg_conf = sum(confidences) / len(confidences) if confidences else None

        blocks.append(
            {
                "page_index": page_index,
                "line_index": line_num,
                "block_index": block_index,
                "text": line_text,
                "left": left,
                "top": top,
                "width": max(right - left, 0),
                "height": max(bottom - top, 0),
                "confidence": avg_conf,
            }
        )

    blocks.sort(key=lambda block: (block["page_index"], block["top"], block["left"]))
    text = "\n".join(block["text"] for block in blocks if block.get("text"))
    return OCRResult(text=text.strip(), blocks=blocks, page_count=1)


def extract_ocr_from_image_bytes(data: bytes, page_index: int = 0) -> OCRResult | None:
    """Run OCR on image bytes with layout metadata."""
    try:
        from PIL import Image  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("Pillow not available for OCR", error=str(exc))
        return None

    try:
        image = Image.open(io.BytesIO(data))
    except Exception as exc:
        logger.warning("Failed to load image for OCR", error=str(exc))
        return None

    return _extract_ocr_from_image(image, page_index=page_index)


def extract_ocr_from_pdf_bytes(data: bytes) -> OCRResult | None:
    """Run OCR on a PDF by converting pages to images."""
    try:
        from pdf2image import convert_from_bytes  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        logger.warning("pdf2image not available for OCR", error=str(exc))
        return None

    try:
        pages = convert_from_bytes(data)
    except Exception as exc:  # pragma: no cover - OCR failures
        logger.warning("Failed to convert PDF to images for OCR", error=str(exc))
        return None

    full_text: list[str] = []
    all_blocks: list[dict[str, Any]] = []
    for idx, page in enumerate(pages):
        result = _extract_ocr_from_image(page, page_index=idx)
        if not result:
            continue
        if result.text:
            full_text.append(result.text)
        all_blocks.extend(result.blocks)

    if not full_text and not all_blocks:
        return None

    return OCRResult(
        text="\n\n".join(full_text).strip(),
        blocks=all_blocks,
        page_count=len(pages),
    )
