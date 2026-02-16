# Imperium Local Development

## Phase 0-2 Baseline Commands

Start Imperium profile services:

```bash
bun run docker:imperium:up
```

Tail Imperium service logs:

```bash
bun run docker:imperium:logs
```

Stop Imperium profile services:

```bash
bun run docker:imperium:down
```

Run web app locally:

```bash
bun run dev:imperium
```

Run Rust API locally:

```bash
bun run imperium:api:dev
```

Run Rust workspace tests:

```bash
bun run imperium:api:test
```

Generate Imperium OpenAPI snapshot:

```bash
bun run imperium:openapi:generate
```

Database backup / rollback helpers:

```bash
bun run imperium:db:backup
# and
bun run imperium:db:restore -- backups/imperium/<file>.dump
```

Run integration harness tests (DB/Redis/NATS required):

```bash
IMPERIUM_INTEGRATION=1 bun run imperium:api:test
```

## Ports

- Imperium Web: `http://localhost:3010`
- Imperium API: `http://localhost:8010`
- NATS Client: `localhost:4222`
- NATS Monitor: `http://localhost:8222`

## Provider Configuration

- Default local mode is `IMPERIUM_DATA_MODE=synthetic`.
- `IMPERIUM_DATA_MODE=hybrid` now runs real adapter calls first for Polygon/Coinbase/Benzinga/Plaid and falls back to synthetic data if needed.
- Provider selection and credential readiness can be inspected at:
  - `GET http://localhost:8010/api/v1/imperium/meta`
  - `GET http://localhost:8010/api/v1/imperium/providers`
  - `GET http://localhost:8010/api/v1/imperium/providers/health`
  - `GET http://localhost:8010/metrics` (Prometheus metrics)
  - `GET http://localhost:8010/api/v1/imperium/ops/dlq` (dead-letter queue)
  - `POST http://localhost:8010/api/v1/imperium/ops/dlq/{event_id}/replay` (DLQ replay)
  - `GET http://localhost:8010/api/v1/imperium/ops/audit` (immutable audit feed)
- For provider matrix and required credentials, see:
  - `/Users/jeremyscatigna/project-memory/docs/imperium/provider-stack.md`

## Incident Runbooks

- `/Users/jeremyscatigna/project-memory/docs/imperium/runbooks/README.md`
