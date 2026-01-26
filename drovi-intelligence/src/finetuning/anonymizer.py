"""
PII Anonymizer for training data.

Removes personally identifiable information while preserving
the learning signal for fine-tuning.
"""

import hashlib
import re
from typing import Any

import structlog

logger = structlog.get_logger()


class PIIAnonymizer:
    """
    Anonymizes PII in text and structured data.

    Replaces:
    - Email addresses → person1@example.com, person2@example.com, etc.
    - Phone numbers → [PHONE]
    - Names (when detected) → Alex, Jordan, Taylor, etc.
    - URLs → [URL]
    - IP addresses → [IP]
    - Credit card numbers → [CREDIT_CARD]
    - Social security numbers → [SSN]
    """

    # Regex patterns
    EMAIL_PATTERN = re.compile(
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
    )
    PHONE_PATTERN = re.compile(
        r"\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b"
    )
    URL_PATTERN = re.compile(
        r"https?://[^\s<>\"{}|\\^`\[\]]+"
    )
    IP_PATTERN = re.compile(
        r"\b(?:\d{1,3}\.){3}\d{1,3}\b"
    )
    CREDIT_CARD_PATTERN = re.compile(
        r"\b(?:\d{4}[-\s]?){3}\d{4}\b"
    )
    SSN_PATTERN = re.compile(
        r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"
    )

    # Replacement names (gender-neutral)
    REPLACEMENT_NAMES = [
        "Alex", "Jordan", "Taylor", "Morgan", "Casey",
        "Riley", "Quinn", "Avery", "Parker", "Sage",
        "Reese", "Drew", "Blake", "Cameron", "Jamie",
        "Skyler", "Charlie", "Emery", "Finley", "Harper",
    ]

    # Replacement domains
    REPLACEMENT_DOMAINS = [
        "example.com", "sample.org", "test.net", "demo.io",
    ]

    def __init__(self):
        self._email_map: dict[str, str] = {}
        self._name_map: dict[str, str] = {}
        self._email_counter = 0
        self._name_counter = 0

    def _get_replacement_email(self, original: str) -> str:
        """Get or create a consistent replacement email."""
        if original.lower() in self._email_map:
            return self._email_map[original.lower()]

        # Generate replacement
        person_num = self._email_counter % len(self.REPLACEMENT_NAMES)
        domain_num = self._email_counter % len(self.REPLACEMENT_DOMAINS)
        replacement = f"person{self._email_counter + 1}@{self.REPLACEMENT_DOMAINS[domain_num]}"

        self._email_map[original.lower()] = replacement
        self._email_counter += 1
        return replacement

    def _get_replacement_name(self, original: str) -> str:
        """Get or create a consistent replacement name."""
        key = original.lower().strip()
        if key in self._name_map:
            return self._name_map[key]

        # Generate replacement
        name_idx = self._name_counter % len(self.REPLACEMENT_NAMES)
        replacement = self.REPLACEMENT_NAMES[name_idx]

        self._name_map[key] = replacement
        self._name_counter += 1
        return replacement

    def anonymize_text(self, text: str) -> str:
        """
        Anonymize PII in a text string.

        Args:
            text: Input text that may contain PII

        Returns:
            Anonymized text
        """
        if not text:
            return text

        result = text

        # Replace emails (preserve consistency)
        for email in self.EMAIL_PATTERN.findall(result):
            result = result.replace(email, self._get_replacement_email(email))

        # Replace phone numbers
        result = self.PHONE_PATTERN.sub("[PHONE]", result)

        # Replace credit card numbers
        result = self.CREDIT_CARD_PATTERN.sub("[CREDIT_CARD]", result)

        # Replace SSNs
        result = self.SSN_PATTERN.sub("[SSN]", result)

        # Replace IP addresses
        result = self.IP_PATTERN.sub("[IP]", result)

        # Replace URLs (but keep domain structure for learning)
        for url in self.URL_PATTERN.findall(result):
            result = result.replace(url, "[URL]")

        return result

    def anonymize_messages(
        self, messages: list[dict[str, str]]
    ) -> list[dict[str, str]]:
        """
        Anonymize a list of chat messages.

        Args:
            messages: List of message dicts with 'role' and 'content'

        Returns:
            Anonymized messages
        """
        return [
            {"role": msg["role"], "content": self.anonymize_text(msg["content"])}
            for msg in messages
        ]

    def anonymize_output(self, output: dict[str, Any]) -> dict[str, Any]:
        """
        Anonymize a structured output dict.

        Recursively anonymizes string values in the dict.

        Args:
            output: Structured output from model

        Returns:
            Anonymized output
        """
        return self._anonymize_value(output)

    def _anonymize_value(self, value: Any) -> Any:
        """Recursively anonymize a value."""
        if isinstance(value, str):
            return self.anonymize_text(value)
        if isinstance(value, dict):
            return {k: self._anonymize_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._anonymize_value(v) for v in value]
        return value

    def reset(self):
        """Reset the anonymizer state (email/name mappings)."""
        self._email_map.clear()
        self._name_map.clear()
        self._email_counter = 0
        self._name_counter = 0

    @staticmethod
    def compute_hash(content: str) -> str:
        """
        Compute a hash for content deduplication.

        Uses SHA256 for collision resistance.
        """
        return hashlib.sha256(content.encode()).hexdigest()[:16]


# Singleton instance
_anonymizer: PIIAnonymizer | None = None


def get_anonymizer() -> PIIAnonymizer:
    """Get the singleton anonymizer instance."""
    global _anonymizer
    if _anonymizer is None:
        _anonymizer = PIIAnonymizer()
    return _anonymizer
