# AgentOS Production Readiness Checklist

## Runtime + Reliability
- [ ] API health and worker health stable for 7 consecutive days.
- [ ] Agent run success rate >= 90%.
- [ ] Agent run p95 latency < 120s.
- [ ] Approval backlog alert tested and routed.

## Governance + Security
- [ ] Service principal and delegated authority flows validated.
- [ ] Policy simulation and red-team harness run on target roles.
- [ ] Emergency denylist + kill switch exercised in staging.
- [ ] Threat model reviewed (`docs/agentos/threat-model.md`).

## Data + Recovery
- [ ] Backups configured and verified nightly.
- [ ] AgentOS backup drill completed (`deploy/backup/AGENTOS_BACKUP_DRILL.md`).
- [ ] RTO/RPO targets achieved in latest restore rehearsal.

## Observability
- [ ] Alert rules loaded from `deploy/monitoring/alerts.yml`.
- [ ] AgentOS panels live in Grafana (run success, run latency, approvals, drift).
- [ ] SLO burn alerts validated in dry-run mode.

## Pilot Enablement
- [ ] Starter packs installed for target pilot domains.
- [ ] Demo data seeded via `scripts/seed_agentos_demo.py`.
- [ ] Pilot guide reviewed (`docs/agentos/pilot-enablement.md`).
- [ ] Rollback and incident runbook reviewed with on-call team.
