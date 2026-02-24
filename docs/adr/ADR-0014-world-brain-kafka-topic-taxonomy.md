# ADR-0014: World Brain Kafka Topic Taxonomy and Replay Semantics

## Status
Accepted

## Context
World Brain is event-native. Without explicit topic taxonomy and replay rules, ingestion and cognition pipelines cannot scale safely or recover deterministically.

## Decision
Adopt explicit topic families:
- `observation.raw.*`
- `observation.normalized.*`
- `belief.update.*`
- `hypothesis.generated.*`
- `causal.edge.update.*`
- `constraint.violation.candidate.*`
- `impact.edge.computed.*`
- `simulation.requested.*`
- `simulation.completed.*`
- `intervention.proposed.*`
- `intervention.executed.*`
- `outcome.realized.*`

Delivery and replay policy:
- idempotent producer and consumer contracts
- durable checkpoints per consumer group
- DLQ per topic family
- schema compatibility gate in CI

## Consequences
Positive:
- deterministic replay and backfill workflows
- clearer platform ownership and SLOs by topic family
- safer scaling and incident recovery

Tradeoffs:
- higher operational complexity in Kafka governance
- stricter schema management process required
