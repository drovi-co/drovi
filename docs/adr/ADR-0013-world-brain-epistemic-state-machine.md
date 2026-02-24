# ADR-0013: World Brain Epistemic State Machine

## Status
Accepted

## Context
Confidence scores alone are insufficient for governing belief lifecycle and intervention safety. The system needs explicit epistemic states to express certainty quality and revision semantics.

## Decision
All Belief objects must carry one epistemic state:
- asserted
- corroborated
- contested
- degraded
- retracted
- unknown

Allowed transitions are policy-controlled and evidence-triggered.
High-stakes workflows require minimum state thresholds before action:
- recommendation-only: asserted+
- high-impact intervention: corroborated only

## Consequences
Positive:
- clearer trust semantics for users and agents
- explicit downgrade path when contradiction appears
- stronger policy gating and auditability

Tradeoffs:
- additional state-transition logic and validation burden
- potential user education needed for epistemic labels
