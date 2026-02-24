"""Retry classification policy for connector ingestion failures."""

from __future__ import annotations

from enum import Enum


class RetryClass(str, Enum):
    AUTH = "auth"
    QUOTA = "quota"
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    UNKNOWN = "unknown"


class ClassifiedFailure:
    def __init__(self, retry_class: RetryClass, retryable: bool) -> None:
        self.retry_class = retry_class
        self.retryable = retryable


def classify_failure(error_message: str | None) -> ClassifiedFailure:
    message = (error_message or "").lower()
    if not message:
        return ClassifiedFailure(RetryClass.UNKNOWN, True)

    auth_markers = (
        "401",
        "403",
        "unauthorized",
        "authentication failed",
        "invalid api key",
        "token expired",
        "auth",
    )
    if any(marker in message for marker in auth_markers):
        return ClassifiedFailure(RetryClass.AUTH, False)

    quota_markers = (
        "402",
        "429",
        "quota",
        "rate limit",
        "too many requests",
        "throttle",
    )
    if any(marker in message for marker in quota_markers):
        return ClassifiedFailure(RetryClass.QUOTA, True)

    transient_markers = (
        "timeout",
        "temporarily unavailable",
        "connection reset",
        "connection refused",
        "server error",
        "5xx",
        "503",
        "502",
        "504",
    )
    if any(marker in message for marker in transient_markers):
        return ClassifiedFailure(RetryClass.TRANSIENT, True)

    permanent_markers = (
        "404",
        "not found",
        "unsupported",
        "invalid payload",
        "schema",
        "bad request",
        "unprocessable",
    )
    if any(marker in message for marker in permanent_markers):
        return ClassifiedFailure(RetryClass.PERMANENT, False)

    return ClassifiedFailure(RetryClass.UNKNOWN, True)
