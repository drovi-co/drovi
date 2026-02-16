# ADR-0006: Imperium Realtime Transport Strategy (SSE + WebSocket)

## Status
Accepted

## Context

Imperium clients need realtime updates for market data and alerts while also supporting lower-complexity streaming flows for event timelines and incremental UI updates. A single transport is possible but not optimal for all use cases.

## Decision

Imperium uses a mixed transport strategy:

- WebSocket for high-frequency market and alert channels.
- Server-Sent Events (SSE) for lower-frequency timeline and state-feed updates.

Protocol mapping:

- `ws://.../api/v1/imperium/stream/market`
- `ws://.../api/v1/imperium/stream/alerts`
- `GET /api/v1/imperium/events/*` (SSE)

Authentication is token-based and connection-scoped. Subscription filters are explicit and per-session.

## Consequences

Positive:

- lower overhead for simple event feeds
- robust high-frequency transport for market surfaces
- clearer channel semantics in clients and backend

Tradeoffs:

- two transport clients to maintain in each app
- additional integration tests for parity and reconnection behavior
