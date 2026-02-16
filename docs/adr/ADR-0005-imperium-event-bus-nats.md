# ADR-0005: Imperium Internal Event Bus Uses NATS

## Status
Accepted

## Context

Imperium needs low-latency fanout for market ticks, alert evaluations, and state-change notifications. The stack already includes Kafka-compatible infrastructure for other Drovi domains, but Imperium requires lightweight, high-frequency publish/subscribe behavior with simple operational semantics for internal service coordination.

## Decision

Imperium uses NATS (with JetStream) as its internal event bus for:

- realtime market and alert channels
- worker handoff events
- internal state change notifications

NATS topics are namespaced by domain:

- `imperium.market.*`
- `imperium.news.*`
- `imperium.brief.*`
- `imperium.portfolio.*`
- `imperium.business.*`
- `imperium.risk.*`
- `imperium.alerts.*`
- `imperium.notify.*`

At-least-once delivery semantics are handled with idempotent consumers and domain-level dedupe keys.

## Consequences

Positive:

- low-latency fanout for realtime surfaces
- straightforward subject-based routing
- decoupled workers with isolated failure domains

Tradeoffs:

- additional infrastructure component to operate
- explicit idempotency requirements in all consumers
