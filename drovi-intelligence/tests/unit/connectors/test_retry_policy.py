from __future__ import annotations

from src.connectors.scheduling.retry_policy import RetryClass, classify_failure


def test_classify_failure_auth() -> None:
    failure = classify_failure("World News API authentication failed (401)")
    assert failure.retry_class == RetryClass.AUTH
    assert failure.retryable is False


def test_classify_failure_quota() -> None:
    failure = classify_failure("World News API quota exhausted (402)")
    assert failure.retry_class == RetryClass.QUOTA
    assert failure.retryable is True


def test_classify_failure_transient() -> None:
    failure = classify_failure("Connection timeout while reading provider")
    assert failure.retry_class == RetryClass.TRANSIENT
    assert failure.retryable is True


def test_classify_failure_permanent() -> None:
    failure = classify_failure("unsupported payload schema from provider")
    assert failure.retry_class == RetryClass.PERMANENT
    assert failure.retryable is False
