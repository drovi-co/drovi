# Imperium Backend (Rust Workspace)

This workspace hosts Imperium backend services and domain crates.

## Primary binary

- `crates/imperium-api`: Axum API and realtime edge.

## Local run

```bash
cargo run --manifest-path services/imperium-backend/crates/imperium-api/Cargo.toml
```

## Local test

```bash
cargo test --manifest-path services/imperium-backend/Cargo.toml
```

## Provider Metadata

- `GET /api/v1/imperium/meta`: service metadata + provider summary.
- `GET /api/v1/imperium/providers`: provider mode, primary/fallback vendors, credential readiness.
- `GET /api/v1/imperium/providers/health`: active market/news/banking provider probe.
- `GET /metrics`: Prometheus metrics export for API, connectors, workers, and NATS publish flow.
- `GET /api/v1/imperium/ops/dlq`: dead-letter queue inventory.
- `POST /api/v1/imperium/ops/dlq/{event_id}/replay`: replay dead-letter payloads.
- `GET /api/v1/imperium/ops/audit`: immutable audit stream feed.
