"""Fraud and impersonation heuristics for inbound messages."""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from .schemas import FraudSignal, SeverityLevel


_URGENCY_TERMS = {
    "urgent",
    "immediately",
    "asap",
    "right away",
    "today",
    "now",
}
_PAYMENT_TERMS = {
    "wire transfer",
    "bank transfer",
    "payment",
    "invoice",
    "gift card",
    "crypto",
    "bitcoin",
    "account number",
}
_CREDENTIAL_TERMS = {
    "password",
    "login",
    "verify account",
    "mfa",
    "2fa",
    "reset your password",
    "security code",
}
_EXEC_TITLES = {
    "ceo",
    "cfo",
    "coo",
    "chief",
    "president",
    "founder",
}


@dataclass
class FraudAssessment:
    signals: list[FraudSignal]
    overall_score: float


def _severity(score: float) -> SeverityLevel:
    if score >= 0.85:
        return "critical"
    if score >= 0.65:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"


def _domain_similarity(domain: str, known_domains: list[str]) -> float:
    if not known_domains:
        return 0.0
    scores = [SequenceMatcher(None, domain, known).ratio() for known in known_domains]
    return max(scores) if scores else 0.0


def assess_inbound_risk(
    content: str,
    subject: str | None = None,
    sender_email: str | None = None,
    sender_name: str | None = None,
    known_domains: list[str] | None = None,
) -> FraudAssessment:
    """Assess inbound messages for fraud/impersonation signals."""
    known_domains = known_domains or []
    signals: list[FraudSignal] = []
    text = " ".join(filter(None, [subject, content])).lower()

    if any(term in text for term in _URGENCY_TERMS):
        signals.append(
            FraudSignal(
                type="urgent_request",
                score=0.35,
                severity=_severity(0.35),
                description="Urgent language detected in message",
                evidence="urgent language",
            )
        )

    if any(term in text for term in _PAYMENT_TERMS):
        signals.append(
            FraudSignal(
                type="payment_request",
                score=0.7,
                severity=_severity(0.7),
                description="Payment or transfer request detected",
                evidence="payment keywords",
            )
        )

    if any(term in text for term in _CREDENTIAL_TERMS):
        signals.append(
            FraudSignal(
                type="credential_phishing",
                score=0.75,
                severity=_severity(0.75),
                description="Credential or login request detected",
                evidence="credential keywords",
            )
        )

    if sender_email:
        domain = sender_email.split("@")[-1].lower()
        if known_domains and domain not in known_domains:
            score = 0.55
            if sender_name and any(title in sender_name.lower() for title in _EXEC_TITLES):
                score = 0.7
            similarity = _domain_similarity(domain, known_domains)
            if similarity >= 0.8:
                score = max(score, 0.8)
            signals.append(
                FraudSignal(
                    type="impersonation",
                    score=score,
                    severity=_severity(score),
                    description="Sender domain does not match known domains",
                    evidence=domain,
                )
            )

    overall_score = max((signal.score for signal in signals), default=0.0)
    return FraudAssessment(signals=signals, overall_score=overall_score)
