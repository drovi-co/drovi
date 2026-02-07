# ADR-0001: Execution Plane (Kafka Event Fabric + Postgres Durable Jobs)

## Status
Accepted

## Context
Drovi’s intelligence stack has two distinct classes of asynchronous work:

1. **Event-driven ingestion and pipeline processing**
   - connector records and webhooks
   - normalization and enrichment
   - intelligence extraction
   - graph change streaming to UIs

2. **Command-driven background work**
   - connector sync/backfill orchestration
   - periodic maintenance jobs (decay, retention, reports, candidates)
   - replay / reconciliation tasks

The repo currently contains multiple async mechanisms:
- Kafka/Redpanda topics (event plane)
- APScheduler (scheduling + executing long-running work)
- Redis (ephemeral coordination, OAuth state, SSE fanout utilities)
- Celery code paths exist but are not deployed in docker compose

At pilot scale (250+ seat firms), we need predictable behavior under:
- restarts
- poison messages
- partial failures
- high backfill volume
- operator-driven replays

## Decision
We standardize on a **two-plane model**:

### 1) Kafka is the Event Plane
Kafka/Redpanda is the canonical buffer/event log for ingestion and the intelligence pipeline.

Topics (conceptual):
- `raw.connector.events` -> `normalized.records` -> `intelligence.pipeline.input` -> `graph.changes`

We will add:
- bounded retries
- DLQs
- replay tooling
- metrics for lag and failure rates

### 2) Postgres-backed Durable Jobs are the Command Plane
Long-running work that needs durability, retry, leases, and operator controls will run as jobs stored in Postgres and executed by workers.

This includes:
- connector sync jobs
- backfill plans (windowed)
- periodic reports
- decay and retention maintenance
- webhook outbox retries

The “scheduler” becomes a lightweight service that:
- enqueues due work
- reconciles desired schedules from DB
- does not execute the heavy work directly

### Explicit non-decision: No BullMQ
We will not introduce BullMQ (Node/Redis job queue). It would create a parallel job system, duplicate retry semantics, and split observability, while the backend execution stack is Python + Postgres + Kafka.

### Celery
Celery remains optional code but is treated as deprecated until/unless we deliberately switch the command plane to Celery as the single runner.

## Consequences
Positive:
- restarts do not drop schedules or in-flight work (leases + persisted state)
- poison messages do not wedge consumer groups (DLQ + bounded retries)
- operators can inspect/retry/cancel/replay deterministically
- clearer scaling boundaries (Kafka partitions + job worker concurrency)

Tradeoffs:
- we implement and maintain a small durable-job framework (unless we later adopt Temporal)
- additional schema/migrations for job persistence and leases

## Future Considerations
If continuums and long-running workflows become more complex, we may adopt Temporal for workflow semantics and visibility. The event plane remains Kafka.

