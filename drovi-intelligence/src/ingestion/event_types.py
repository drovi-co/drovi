"""Unified Event types for Reality Instrumentation."""

from enum import Enum


class UnifiedEventType(str, Enum):
    MESSAGE = "message"
    MEETING = "meeting"
    CALL = "call"
    RECORDING = "recording"
    TRANSCRIPT = "transcript"
    DOCUMENT = "document"
    DOC_DIFF = "doc_diff"
    APPROVAL = "approval"
    CODE_MERGE = "code_merge"
    DECISION = "decision"
    COMMITMENT = "commitment"
    DELIVERY = "delivery"
    DRIFT = "drift"
    CONTRADICTION = "contradiction"
    RISK = "risk"
    NOTE = "note"
    DESKTOP_CONTEXT = "desktop_context"
    SCREEN_CAPTURE = "screen_capture"
    OCR_TEXT = "ocr_text"
    OTHER = "other"


def normalize_event_type(value: str | None) -> str:
    if not value:
        return UnifiedEventType.OTHER.value
    value = value.strip().lower()
    for event_type in UnifiedEventType:
        if event_type.value == value:
            return event_type.value
    return UnifiedEventType.OTHER.value
