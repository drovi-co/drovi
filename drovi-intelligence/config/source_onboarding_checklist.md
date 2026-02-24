# Source Onboarding Checklist

Use this template for every new external provider before production ingest is enabled.

## 1. Auth and Access
- [ ] Authentication mode identified (`api_key`, `oauth2`, `rss`, `customer_feed`, or `none`)
- [ ] Required secrets/env vars documented
- [ ] Secret rotation policy defined and tested
- [ ] Tenant credential ownership mode defined (Drovi-managed vs customer-supplied)
- [ ] Least-privilege scopes/permissions confirmed

## 2. Quotas and Rate Limits
- [ ] Rate-limit headers documented
- [ ] Burst and sustained throughput limits documented
- [ ] Retry/backoff policy approved
- [ ] Quota exhaustion behavior and escalation path defined
- [ ] Cost guardrails and budget alert thresholds defined

## 3. Licensing and Legal
- [ ] Terms of use reviewed by legal
- [ ] Redistribution/storage constraints documented
- [ ] Data retention constraints documented
- [ ] Jurisdiction constraints documented
- [ ] Data residency or cross-border restrictions documented

## 4. Reliability and Operations
- [ ] Expected freshness and latency SLOs defined
- [ ] Provider health probes implemented
- [ ] Circuit-breaker thresholds configured
- [ ] Backfill policy (window, checkpointing, replay) defined
- [ ] Incident runbook and on-call ownership assigned

## 5. Schema and Mapping
- [ ] Canonical source schema documented
- [ ] Mapping to `UnifiedExternalEvent`/observation payload validated
- [ ] Entity-linking fields identified
- [ ] Dedupe keys defined
- [ ] Evidence/provenance fields verified

## 6. Validation and Go-Live
- [ ] Sandbox/integration tests passing
- [ ] Failure-mode tests passing (`401/403/429/5xx`, malformed payloads)
- [ ] Data quality checks passing (null rate, timestamp quality, duplicate ratio)
- [ ] Security review completed
- [ ] Production rollout and rollback plan approved
