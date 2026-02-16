# Runbook: Market or News Provider Outage

## Trigger Conditions

- `ImperiumConnectorErrorRateHigh` alert firing.
- `/api/v1/imperium/providers/health` shows `healthy=false` for `markets` or `news`.
- User reports stale ticks or empty intelligence feed.

## Immediate Actions

1. Check provider status payload:
   - `curl -s http://localhost:8010/api/v1/imperium/providers/health | jq`
2. Confirm runtime mode:
   - `curl -s http://localhost:8010/api/v1/imperium/providers | jq '.mode'`
3. Inspect worker and API logs:
   - `bun run docker:imperium:logs`

## Mitigation

1. If in `live` mode and primary provider is degraded:
   - Switch to `hybrid` mode and restart Imperium services.
2. If credential issue:
   - Validate missing variables from `/api/v1/imperium/providers`.
   - Rotate credential and restart worker.
3. If sustained provider API 429/5xx:
   - Increase backoff:
     - `IMPERIUM_PROVIDER_MAX_RETRIES=4`
     - `IMPERIUM_PROVIDER_BACKOFF_MS=800`
   - Restart affected workers.

## Recovery Validation

1. Verify connector metrics:
   - `imperium_connector_requests_total{status="ok"}`
2. Confirm no new DLQ spikes:
   - `imperium_dead_letter_events_total{action="store"}`
3. Validate user-facing endpoints:
   - `GET /api/v1/imperium/markets/{symbol}/quote`
   - `GET /api/v1/imperium/intelligence/inbox`
