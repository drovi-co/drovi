# ADR-0015: Institutional World Twin Materialization Strategy

## Status
Accepted

## Context
A category-defining world model requires a continuously updated representation of external state, internal exposure, and constraints. On-demand graph joins alone are too slow and unstable for low-latency decisioning.

## Decision
Materialize an Institutional World Twin (IWT) per tenant with:
- internal state graph
- external state graph
- exposure topology
- constraint field
- objective field

Two update modes:
- streaming deltas for near-real-time updates
- periodic snapshot compaction for stable replay and diff

Twin outputs drive:
- world pressure map
- belief drift radar
- intervention candidate generation

## Consequences
Positive:
- low-latency cognition surfaces with deterministic state snapshots
- improved explainability for impact and contradiction chains
- stable baseline for simulation and intervention planning

Tradeoffs:
- additional storage and materialization compute costs
- eventual consistency windows must be explicitly managed
