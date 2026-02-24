# World Brain Dashboards and Alerts Spec

## Dashboard Set

1. Ingestion Freshness
2. Pipeline Throughput
3. Queue Backlog and Retry
4. Failure Class and Tenant Impact
5. SLA and Error Budget

## Panel Requirements

### Ingestion Freshness

1. P50/P95 freshness lag by connector type from `source_sync_run.freshness_lag_minutes`.
2. Freshness SLO breach count over rolling 15m/1h windows.
3. Age of latest successful run by connector and by organization.

### Pipeline Throughput

1. Events/min by topic family (`observation.*`, `belief.*`, `impact.*`, `crawl.*`).
2. Normalized records persisted/min.
3. World-twin snapshot/update throughput.

### Queue Backlog and Retry

1. Queued/running/failed jobs by `background_job.job_type`.
2. Retry rate and DLQ ingress rate.
3. Backlog growth slope and estimated drain time.

### Failure Class and Tenant Impact

1. Error class buckets: auth/quota/transient/schema/permanent.
2. Affected tenant count by severity (`SEV-1`..`SEV-3`).
3. Open connector circuit-breakers by provider.

### SLA and Error Budget

1. Weekly error-budget burn by connector type.
2. Failure-rate heatmap by job type.
3. Status rollup (`healthy`, `warning`, `elevated`, `critical`).

## Alert Routing Baseline

1. `SEV-1`: high-risk tenant ingest blocked > 15m.
2. `SEV-2`: freshness lag over SLO for > 30m.
3. `SEV-3`: connector-specific degradation with fallback active.

## Data Sources

1. Postgres tables: `source_sync_run`, `background_job`, `sync_job_history`.
2. Prometheus metrics from workers/connectors.
3. Kafka lag exporter metrics by topic and consumer group.
4. World Brain weekly SLA report artifact.

## Implementation Notes

1. Dashboard JSON should be version-controlled with infra changes.
2. Any new high-risk connector requires alert mappings before enablement.
3. Alert noise controls must include dedupe windows and tenant-aware suppression.
