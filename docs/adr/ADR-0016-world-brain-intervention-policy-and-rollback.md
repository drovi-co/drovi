# ADR-0016: Intervention Policy Classes and Rollback Contract

## Status
Accepted

## Context
World Brain shifts from observation to intervention. Without strict policy classes and rollback guarantees, autonomous behavior can create unacceptable operational and compliance risk.

## Decision
Adopt intervention policy classes:
- P0 Observe-only (no side effects)
- P1 Draft and stage only
- P2 Human-approved execution required
- P3 Emergency auto-execution (explicit tenant opt-in only)

All P2/P3 interventions must include:
- expected utility and downside estimate
- evidence bundle and uncertainty statement
- executable rollback plan
- audit trail for request, approval, execution, and outcome

## Consequences
Positive:
- safer transition from intelligence to action
- deterministic accountability and easier incident response
- stronger enterprise trust posture

Tradeoffs:
- additional implementation overhead for rollback handlers
- slower autonomous throughput for high-risk workflows
