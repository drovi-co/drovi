# ADR-0007: Imperium Citation and Claim Policy

## Status
Accepted

## Context

Imperium briefings and intelligence surfaces affect financial and operating decisions. Uncited model output is unacceptable for this product class and creates trust and liability risk.

## Decision

Imperium enforces a citation-first policy:

- no published brief claim without at least one source citation
- each citation must include provider/source metadata and excerpt reference
- claims below confidence threshold are excluded from publish path
- claims failing citation validation are rejected and logged

Data model requirements:

- `brief_claim` rows cannot be published without linked `brief_citation` rows
- citation validation is part of brief publish transaction

Client requirements:

- any claim rendered in UI must expose a citation drawer or equivalent interaction

## Consequences

Positive:

- stronger user trust in generated intelligence
- auditable reasoning paths for each claim
- reduced hallucination blast radius

Tradeoffs:

- stricter generation failures when source coverage is weak
- more complex briefing pipeline validation and retries
