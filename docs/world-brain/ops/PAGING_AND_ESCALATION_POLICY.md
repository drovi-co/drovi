# World Brain Paging and Escalation Policy

## Severity Model

1. `SEV-1`: critical integrity, compliance, or high-risk tenant outage.
2. `SEV-2`: major degradation of freshness, throughput, or correctness.
3. `SEV-3`: localized connector degradation with fallback still working.

## Initial Routing

1. Platform SRE on-call receives all infra and deployment incidents.
2. Data/ML on-call receives contract, model, and replay integrity incidents.
3. Connector owner receives source-specific quota/auth failures.

## Escalation Windows

1. `SEV-1`: acknowledge in 5 minutes, escalate to incident commander at 10 minutes.
2. `SEV-2`: acknowledge in 15 minutes, escalate to pod lead at 30 minutes.
3. `SEV-3`: acknowledge in 60 minutes, escalate to backlog owner after 24 hours unresolved.

## Tenant-Impact Escalation Overrides

1. Any incident affecting legal/compliance critical tenants is upgraded by one severity level.
2. Multi-tenant blast radius > 10 active tenants escalates directly to `SEV-1`.
3. Repeated failures on critical connector families trigger immediate incident bridge.

## Required Incident Artifacts

1. Timeline with exact UTC timestamps.
2. Affected topics/connectors/deployments.
3. Evidence links for root-cause and remediation verification.
4. Rollback or mitigation record with owner and completion timestamp.

## Recovery Exit Criteria

1. Error rate and freshness lag return to SLO envelope for 30 minutes.
2. Backlog slope is flat or draining.
3. No unresolved data-integrity checks remain.
4. Incident summary published within 24 hours.
