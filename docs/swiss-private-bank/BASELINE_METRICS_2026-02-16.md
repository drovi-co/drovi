# Baseline Metrics Snapshot

Date: `2026-02-16`
Environment: `docker compose local stack`
Capture scope: `Phase 0 baseline for Swiss Private Bank transformation`

## Summary
| Metric | Baseline value | Method |
|---|---:|---|
| Page load p95 | `0.000412 s` | 60 local probes against `drovi-web` root (`http://127.0.0.1/`) |
| Ask latency p95 | `0.014360 s` | 25 authenticated POST probes to `/api/v1/ask` using dev internal token |
| Ingestion lag p95 | `603615.08 s` (~7.0 days) | SQL percentile over `now() - sync_states.last_sync_completed_at` |
| Contradiction rate | `1.26%` | `open uio_contradiction / active unified_intelligence_object` |
| Records with evidence links | `90.77%` | `% active UIOs with at least one unified_object_source row` |

## Raw stats
### Page load probe stats
- sample size: `60`
- p50: `0.000131 s`
- p95: `0.000412 s`
- max: `0.001346 s`
- mean: `0.000202 s`

### Ask probe stats
- sample size: `25`
- p50: `0.007572 s`
- p95: `0.014360 s`
- max: `0.046852 s`
- mean: `0.009824 s`

## SQL snapshot values
- Open contradictions: `9`
- Active UIO count: `715`
- Contradiction rate: `1.26%`
- Evidence-linked coverage: `90.77%`
- Sync lag p95: `603615.08 seconds`

## Notes
- Page load baseline is server-side shell return time; browser render and authenticated route hydration are not included.
- Ask baseline is API response latency for a deterministic query path in current local data shape.
- Ingestion lag p95 indicates stale connector states are present and should be addressed in reliability phases.

## Repro details
- Web latency probes executed inside `drovi-web` container.
- Ask probes executed inside `drovi-intel-api` container with:
  - `X-Internal-Service-Token: dev-test-token-drovi-2024`
  - `X-Organization-ID: org_d02b644b2c56dec1`
- DB metrics queried from `drovi-postgres` (`drovi` database).
