# World Brain Runbook: Provider Outage and Quota Exhaustion

Scope:
- Connectors: world news, regulatory, market, research, vulnerability feeds
- Systems: connector scheduler, source health monitor, job queue, world-brain worker pools

Severity:
- `SEV-1` if critical source family has no healthy fallback and freshness breach exceeds 15 minutes
- `SEV-2` if fallback exists but SLA breach exceeds 30 minutes

## 1. Detection Signals

1. Sustained 402/429/5xx spikes by connector type.
2. Quota headroom ratio below alert floor.
3. Freshness lag increases while scheduled sync jobs continue failing.

## 2. Immediate Containment

1. Enable surge controls for non-critical sources:
- increase `WORLD_INGEST_GLOBAL_THROTTLE_MULTIPLIER`
- elevate critical job priorities

2. Pause repeatedly failing low-priority sources.
3. Confirm connector circuit-breaker state and fallback routing.

## 3. Triage

1. Separate auth failures vs quota exhaustion vs provider outage.
2. Validate provider status pages and incident IDs.
3. Check per-tenant blast radius and affected source families.

## 4. Recovery Actions

1. Rotate/sync credentials from Secrets Manager if auth failure is suspected.
2. Reduce page size and backoff for quota recovery windows.
3. Force catch-up mode once provider recovers.
4. Monitor duplicate/no-gap invariants during catch-up replay.

## 5. Exit Criteria

1. Freshness lag returns to policy envelope.
2. Failure rates return to baseline and fallback dependency drops.
3. Quota burn rate stabilizes under plan.
4. Incident record includes long-term prevention actions.
