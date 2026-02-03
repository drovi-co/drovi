# Drovi Memory & Intelligence Rebuild — Remaining Tasks

## Status Key
- [x] Done
- [ ] Not started / remaining
- [~] Partial / needs hardening

---

## Phase 0: Groundwork
- [x] UEM schema + storage tables (unified_event)
- [x] Evidence storage policy (S3/MinIO wired + object lock/retention enabled in local MinIO)
- [x] Observability baseline (Prometheus metrics + alerts + dashboards)
- [x] Quality dataset v1 (goldset expanded to 100 samples; ready for annotation iteration)

## Phase 1: Ingestion Fabric + Conversation Model
- [x] Connectors emit UEM via pipeline (persist_raw + live_sessions)
- [x] Conversation threading beyond source IDs (related_conversation heuristics + cross‑channel links)
- [x] Live streaming ingestion (chunking + diarization + SLA enforcement)
- [x] Unified conversation timeline model (cross‑source linking + backfill tooling)

## Phase 2: Identity Resolution
- [x] Deterministic linking (contact_identity + graph identities)
- [x] Probabilistic matching tuned + verified (heuristic match + domain/name scoring)
- [x] Human merge UI / overrides (admin UI + merge API)
- [x] Identity audit trail (audit export API)

## Phase 3: Fast Signal Extraction
- [x] Candidate store (signal_candidate)
- [x] Candidate persistence node in pipeline
- [x] Candidate processing worker (synthesis into UIOs)
- [x] Back‑pressure + priority queues (Kafka priority queue + pause/resume)

## Phase 4: Memory Truth Engine
- [x] Bi‑temporal fields added to UIOs
- [x] Evidence‑weighted clustering (cluster + merge logic + similarity tuning)
- [x] Conflict & supersession rules beyond decisions (commitment/task/risk supersession)
- [x] Confidence calibration across versions (lightweight boost via evidence count)

## Phase 5: Graph + Query + Agent APIs
- [x] Graph schema + indexes
- [x] Query APIs + streaming endpoints
- [x] Temporal graph queries + time‑slice semantics (UIO list + graph UIO search)
- [x] Full tenant isolation verification (RLS smoke test script added)

## Phase 6: Feedback Loops + Scaling
- [x] Human feedback UI for corrections (UIO correction UI + API)
- [x] Automated retraining pipeline + data sampling (corrections export script + workflow)
- [x] Drift monitoring (script + scheduled workflow)
- [x] Load testing at scale (script + workflow)

---

## Infra / Production Readiness
- [x] Kafka + MinIO + Postgres + FalkorDB stack
- [x] Backup + restore verification jobs (scheduled workflow template added)
- [x] Disaster recovery runbooks
- [x] SLOs + alerting + dashboards (alerts + Grafana dashboard)

---

## Immediate Build Queue (Next Actions)
1) Add UIO timeline entries on create/update for all UIO types. (done)
2) Implement candidate clustering + merge (evidence‑weighted) before UIO creation. (done)
3) Add conversation linking heuristics (related_conversation population). (done)
4) Add internal backfill tooling into Docker image for prod use. (done)
5) Add RLS/tenant isolation tests and smoke checks. (done)
6) Add backup scheduling + restore verification job. (done)
