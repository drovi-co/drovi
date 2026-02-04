"""Pydantic schemas for guardrail checks."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


PIIType = Literal["email", "phone", "ssn", "credit_card"]
GuardrailAction = Literal["allow", "require_approval", "block"]
SeverityLevel = Literal["low", "medium", "high", "critical"]


class EvidenceSnippet(BaseModel):
    evidence_id: str | None = None
    message_id: str | None = None
    source_type: str | None = None
    source_timestamp: str | None = None
    quoted_text: str | None = None


class PIIFinding(BaseModel):
    type: PIIType
    start: int
    end: int
    masked_value: str
    allowed: bool
    severity: SeverityLevel


class FraudSignal(BaseModel):
    type: Literal["impersonation", "payment_request", "credential_phishing", "urgent_request", "other"]
    score: float = Field(ge=0.0, le=1.0)
    severity: SeverityLevel
    description: str
    evidence: str | None = None


class ContradictionFinding(BaseModel):
    uio_id: str
    uio_type: str
    title: str | None = None
    contradiction_type: str
    severity: SeverityLevel
    reasoning: str | None = None
    draft_snippet: str | None = None
    evidence: list[EvidenceSnippet] = Field(default_factory=list)


class PolicyDecision(BaseModel):
    rule_id: str
    action: GuardrailAction
    severity: SeverityLevel
    reason: str


class ComposeGuardrailRequest(BaseModel):
    organization_id: str
    content: str
    channel: str = "email"
    recipients: list[str] = Field(default_factory=list)
    actor_role: str | None = None
    sensitivity: str | None = None
    action_tier: str | None = None
    action_type: str | None = None


class ComposeGuardrailResponse(BaseModel):
    contradictions: list[ContradictionFinding] = Field(default_factory=list)
    pii_findings: list[PIIFinding] = Field(default_factory=list)
    policy_decisions: list[PolicyDecision] = Field(default_factory=list)
    overall_action: GuardrailAction = "allow"


class DataMinimizationRequest(BaseModel):
    organization_id: str
    content: str
    channel: str | None = None
    redact: bool | None = None


class DataMinimizationResponse(BaseModel):
    redacted_content: str
    findings: list[PIIFinding] = Field(default_factory=list)
    applied: bool = False


class InboundGuardrailRequest(BaseModel):
    organization_id: str
    sender_email: str | None = None
    sender_name: str | None = None
    subject: str | None = None
    content: str
    known_domains: list[str] = Field(default_factory=list)
    actor_role: str | None = None


class InboundGuardrailResponse(BaseModel):
    fraud_signals: list[FraudSignal] = Field(default_factory=list)
    policy_decisions: list[PolicyDecision] = Field(default_factory=list)
    overall_action: GuardrailAction = "allow"
