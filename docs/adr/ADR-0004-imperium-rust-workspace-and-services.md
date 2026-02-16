# ADR-0004: Imperium Rust Workspace and Service Boundaries

## Status
Accepted

## Context

Imperium requires low-latency market processing, deterministic alerting, and strict control over data transformation pipelines. The existing monorepo is Bun/TypeScript-first for web surfaces, but Imperium backend requirements favor Rust for throughput and predictable concurrency behavior.

Without explicit boundaries, service growth will create a tightly coupled backend that is difficult to scale, test, and operate.

## Decision

Imperium backend is implemented as a Rust workspace under:

- `services/imperium-backend`

Initial crates are:

- `imperium-api` (Axum API and realtime edge)
- `imperium-domain` (core entities and rules)
- `imperium-infra` (database, cache, event bus, telemetry)
- `imperium-market` (market ingestion and candles)
- `imperium-news` (news ingestion and clustering)
- `imperium-brief` (daily briefing pipeline)
- `imperium-portfolio` (holdings and exposures)
- `imperium-business` (business metrics and connectors)
- `imperium-risk` (risk and regime modeling)
- `imperium-alerts` (alert rules and dispatch policy)
- `imperium-notify` (push and outbound notifications)
- `imperium-journal` (decision memory and playbooks)
- `imperium-connectors` (provider adapters)

`imperium-api` orchestrates domain services but does not embed provider-specific logic.

## Consequences

Positive:

- clear compilation and ownership boundaries
- easier per-domain testing and rollout
- predictable runtime behavior with Tokio

Tradeoffs:

- more crate interfaces to maintain
- initial setup overhead for internal contracts
