from types import SimpleNamespace
from unittest.mock import patch

from src.guardrails.pii import apply_data_minimization


def test_apply_data_minimization_redacts_blocked_pii():
    settings = SimpleNamespace(
        dlp_enabled=True,
        dlp_redact=True,
        dlp_mask_char="█",
        dlp_allow_emails=False,
        dlp_allow_phone_numbers=True,
    )
    content = "Contact jane@example.com and SSN 123-45-6789."

    with patch("src.guardrails.pii.get_settings", return_value=settings):
        redacted, findings, applied = apply_data_minimization(content)

    assert applied is True
    assert "jane@example.com" not in redacted
    assert "123-45-6789" not in redacted
    assert findings


def test_apply_data_minimization_respects_override():
    settings = SimpleNamespace(
        dlp_enabled=True,
        dlp_redact=True,
        dlp_mask_char="█",
        dlp_allow_emails=False,
        dlp_allow_phone_numbers=False,
    )
    content = "Contact jane@example.com."

    with patch("src.guardrails.pii.get_settings", return_value=settings):
        redacted, findings, applied = apply_data_minimization(content, override_redact=False)

    assert applied is False
    assert redacted == content
    assert findings
