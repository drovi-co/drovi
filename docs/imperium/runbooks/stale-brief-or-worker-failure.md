# Runbook: Stale Brief or Worker Failure

## Trigger Conditions

- `imperium_worker_cycles_total{status="error"}` rising.
- Morning brief not updated by 05:00 local schedule window.
- Alerts feed stops updating while API remains healthy.

## Immediate Actions

1. Check worker health via logs:
   - `bun run docker:imperium:logs`
2. Inspect dead-letter queue:
   - `curl -s http://localhost:8010/api/v1/imperium/ops/dlq | jq`
3. Verify latest brief timestamp:
   - `curl -s http://localhost:8010/api/v1/imperium/brief/today | jq '.generated_at'`

## Mitigation

1. Replay failed DLQ items (authenticated context required):
   - `POST /api/v1/imperium/ops/dlq/{event_id}/replay`
2. Restart stuck worker containers:
   - `docker compose --profile imperium restart imperium-brief-worker imperium-news-worker`
3. If replay repeatedly fails:
   - Inspect `error_message` and update provider credentials/runtime mode.

## Recovery Validation

1. Confirm DLQ entry status transitions to `replayed`.
2. Confirm audit stream has replay trace:
   - `GET /api/v1/imperium/ops/audit`
3. Confirm fresh brief publish event:
   - Check `imperium_worker_cycles_total{role="brief",status="ok"}` movement.
