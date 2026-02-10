# Temporal (Workflow Plane) Operations

Drovi uses Temporal to orchestrate long-running, restart-safe workflows (connector sync/backfill, cron-style maintenance, and future derived index builds).

This is the "workflow plane". The "command plane" is still the Postgres-backed durable job queue (`background_job`) executed by `drovi-jobs-worker`.

## Local Dev (Docker Compose)

Bring up the full stack:

```bash
docker compose up -d --build
```

Temporal services in `docker-compose.yml`:

- `temporal-postgres`: Temporal persistence
- `temporal`: Temporal server (gRPC) on `localhost:7233`
- `temporal-ui`: Web UI on `http://localhost:8088`
- `drovi-temporal-worker`: Drovi workflows + activities worker

The worker is started with:

- `TEMPORAL_ENABLED=true`
- `TEMPORAL_ADDRESS=temporal:7233`
- `TEMPORAL_NAMESPACE=default`
- `TEMPORAL_TASK_QUEUE=drovi-workflows`

## What Temporal Does (Current)

The Temporal worker bootstraps a small set of cron workflows on startup. These replace the legacy in-memory APScheduler process.

- `cron:scheduled_sync_sweep`
  - Runs every minute.
  - Lists active connections and enqueues idempotent `connector.sync` jobs (scheduled mode).
- `cron:webhook_outbox_flush` (Kafka only)
  - Runs every minute.
  - Enqueues `webhook.outbox.flush`.
- `cron:candidates_process`
  - Runs every minute (Temporal cron granularity).
  - Enqueues `candidates.process` with bucket-based idempotency using `candidate_processing_interval_seconds`.
- `cron:reports_weekly`
  - Runs on `weekly_reports_cron`.
  - Enqueues `reports.weekly`.
- `cron:reports_daily`
  - Runs on `daily_reports_cron`.
  - Enqueues `reports.daily`.
- `cron:memory_decay`
  - Runs on `memory_decay_cron`.
  - Enqueues `memory.decay`.
- `cron:evidence_retention`
  - Runs on `evidence_retention_cleanup_cron`.
  - Enqueues `evidence.retention`.

Note: All of these workflows delegate execution to the durable jobs plane. Temporal provides orchestration guarantees; Postgres provides job durability and introspection.

## Failure Modes and Guarantees

- If `drovi-temporal-worker` is down:
  - No new cron enqueues happen.
  - Existing durable jobs in Postgres still execute (via `drovi-jobs-worker`).
- If `drovi-jobs-worker` is down:
  - Temporal will enqueue jobs successfully, but they will remain queued in Postgres until a worker comes back.
- If Postgres is down:
  - Temporal activities that enqueue or poll jobs will fail and retry according to activity retry policy.
- If Temporal server is down:
  - Workflows and cron schedules do not progress.

## Replay Safety

Temporal workflows must be deterministic.

Rules we follow:

- Workflow code uses `workflow.now()` instead of `datetime.utcnow()`.
- IO and non-deterministic operations are performed in activities.
- Any configuration needed inside a workflow is passed as workflow input from the worker bootstrap.

## Legacy Scheduler

The old APScheduler-based process is still present but is not started by default:

- `drovi-scheduler` is behind the `legacy` compose profile.

To run it explicitly:

```bash
docker compose --profile legacy up -d drovi-scheduler
```

The goal is to keep it available only as a temporary dev tool until it is fully removed.

