# ADR-0010: Imperium Security Model Baseline

## Status
Accepted

## Context

Imperium handles financial and business operational data from multiple external providers. Security controls must be built into architecture, not bolted on later.

## Decision

Security baseline:

- Sign in with Apple and passkeys for first-party user auth
- OAuth-based third-party connector auth only
- no raw connector credentials persisted
- field-level encryption for sensitive account and balance data
- immutable audit logs for auth, data mutation, and alert actions
- device-bound sessions and token rotation

Operational controls:

- connector scope minimization
- role-based access for privileged actions
- periodic secret rotation support

## Consequences

Positive:

- stronger protection for high-sensitivity financial data
- traceability for operational and compliance review
- reduced credential leakage risk

Tradeoffs:

- increased implementation complexity for key management and audits
- additional test matrix for security-critical flows
