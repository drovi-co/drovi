# AgentOS Operations Runbook

## Scope
This runbook covers incident response for AgentOS control plane, runtime execution, approvals, and quality safety gates.

## Primary SLOs
- Agent run success rate >= 90% (`drovi_agent_runs_status_total`)
- Agent run p95 latency < 120s (`drovi_agent_run_duration_seconds`)
- Approval backlog < 20 pending per org (`drovi_agent_approval_backlog`)
- Quality drift score < 0.8 (`drovi_agent_quality_drift_score`)

## Incident Severity
- `SEV-1`: Cross-org outage, policy bypass, or data isolation risk.
- `SEV-2`: Major latency/success degradation for multiple orgs.
- `SEV-3`: Single-org degradation with workaround.

## Triage Checklist (First 10 Minutes)
1. Confirm alert scope in Prometheus/Grafana:
   - `DroviAgentRunSuccessRateLow`
   - `DroviAgentRunLatencyP95High`
   - `DroviAgentApprovalBacklogHigh`
   - `DroviAgentQualityDriftHigh`
2. Check API and worker health:
   - `docker compose ps`
   - `docker logs drovi-intel-api --tail 200`
   - `docker logs drovi-temporal-worker --tail 200`
3. Identify blast radius:
   - single org, single deployment, or global.
4. If policy/control risk is suspected, activate emergency denylist immediately.

## Containment Actions

### A. Runtime Degradation (High Failures/Latency)
1. Pause affected deployment(s):
   - API: `POST /api/v1/agents/deployments/{id}/rollback` with target stable version.
2. Reduce trigger pressure:
   - disable noisy triggers via `PATCH /api/v1/agents/triggers/{id}` (`is_enabled=false`).
3. Scale worker capacity:
   - increase Temporal workers and ingestion workers.

### B. Approval Backlog Growth
1. Route pending approvals to backup approvers.
2. Raise approval SLA alert in channel inbox pages.
3. Temporarily lower autonomy tier to reduce new high-risk actions.

### C. Quality Drift Event
1. Freeze deployment promotion:
   - enforce regression gates (`/api/v1/agents/quality/gates`).
2. Run offline eval remediation (`/api/v1/agents/quality/offline-evals/run`).
3. Apply prompt/policy recommendations before re-enable.

## Rollback Procedure
1. Identify last known good deployment version.
2. Execute rollback endpoint and confirm status transitions.
3. Validate:
   - new run dispatch succeeds
   - run success rate recovers in 15 minutes
   - drift score trends downward.

## Failover Procedure
1. If API instance unhealthy:
   - restart `drovi-intel-api`.
2. If Temporal workers unhealthy:
   - restart `drovi-temporal-worker`.
3. If Kafka lag spikes:
   - restart `drovi-worker`, then verify lag drains.
4. If Postgres degraded:
   - move to read-only/degraded mode and initiate DB recovery workflow.

## Degraded Mode
When stability is at risk, switch to:
- `L1` recommendation-only mode for impacted deployments.
- Block external side effects via org emergency denylist.
- Keep evidence retrieval + chat enabled for continuity.
- Pause autonomous scheduled triggers until SLO recovery.

## Recovery Exit Criteria
- 60 minutes without recurring critical alerts.
- Success rate >= 90% and latency p95 < 120s.
- Approval backlog normalized for impacted orgs.
- Drift score below 0.8 for impacted role scopes.

## Post-Incident
1. Capture timeline with exact UTC timestamps.
2. Record root cause, mitigation, and permanent fix tasks.
3. Add regression tests for the failure path.
4. Update this runbook if any step was missing or inaccurate.
