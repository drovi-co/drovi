# World Brain Runbook: DLQ Backlog and Replay Storm

Scope:
- Kafka topic families: `observation.*`, `belief.*`, `impact.*`, `crawl.*`
- Systems: `drovi-worker`, `drovi-jobs-worker`, schema registry, Postgres run ledger

Severity:
- `SEV-1` if high-risk tenant streams are blocked > 15 minutes
- `SEV-2` if backlog growth rate is positive for > 30 minutes

## 1. Detection Signals

1. Kafka consumer lag on primary topics exceeds alert threshold.
2. DLQ write rate spikes while success publish rate drops.
3. Replay jobs increase failure rate or repeatedly requeue.

## 2. Immediate Containment

1. Enable ingest surge controls:
- set `WORLD_INGEST_KILL_SWITCH_ENABLED=true` (drop non-critical)
- set `WORLD_INGEST_GLOBAL_THROTTLE_MULTIPLIER=1.5` or higher

2. Pause non-critical replay workloads:
- disable replay jobs for low-priority source families first

3. Confirm schema compatibility:
- verify no breaking event contract was deployed
- if contract drift exists, rollback producer deployment

## 3. Triage Procedure

1. Identify top failing subjects and connector types.
2. Split failures into:
- permanent payload poison messages
- transient infra failures (broker, network, timeout)
- schema mismatch / deserialization failures

3. For poison messages:
- move to quarantine stream
- create remediation task with sample payload + contract diff

4. For transient failures:
- validate broker health and partition leadership
- increase retry backoff to prevent storm amplification

## 4. Replay Recovery

1. Replay in bounded batches by topic and tenant.
2. Enforce idempotency keys and checkpoint resume for each batch.
3. Verify:
- no duplicate normalized observations
- monotonic checkpoint progression
- DLQ intake rate is decreasing

## 5. Exit Criteria

1. Consumer lag returns to SLO envelope for 30 consecutive minutes.
2. DLQ inflow is at baseline.
3. Replay queue depth stable and draining.
4. Post-incident report includes root cause, blast radius, and prevention actions.

