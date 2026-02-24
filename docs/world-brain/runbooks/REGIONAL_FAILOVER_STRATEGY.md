# World Brain Runbook: Regional Failover Strategy

Scope:
- Critical ingestion and serving paths
- Primary/secondary AWS region pair

## 1. Failover Modes

1. Read-only failover:
- serve latest durable world-twin/tape data from secondary
- pause non-critical ingestion writes

2. Full failover:
- promote secondary control plane and ingestion workers
- resume critical connector schedules first

## 2. Preconditions

1. Cross-region backups and replication are healthy.
2. Recovery credentials and kube access validated.
3. RTO/RPO targets approved for current quarter.

## 3. Trigger Conditions

1. Primary region control plane unavailable > 10 minutes.
2. Data plane outage blocks critical SLA paths.
3. Security or integrity incident requires regional isolation.

## 4. Execution

1. Freeze deployments and schema changes.
2. Restore/attach latest Postgres and graph snapshots in secondary.
3. Validate evidence/lakehouse checksum integrity.
4. Promote secondary ingress and DNS routing.
5. Start world-brain critical workers first, then normal pools.

## 5. Back-to-Primary

1. Reconcile delta events generated in secondary.
2. Validate contract and checkpoint continuity.
3. Shift DNS traffic back gradually.
4. Keep secondary warm standby after cutback.

## 6. Verification

1. Critical APIs pass smoke checks.
2. Freshness lag, queue backlog, and error budgets are stable.
3. Audit trail confirms no cross-tenant leakage during failover.
