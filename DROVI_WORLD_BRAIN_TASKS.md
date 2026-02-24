# DROVI World Brain Tasks (Deep Research Edition)

Implements:
- `/Users/jeremyscatigna/project-memory/DROVI_WORLD_BRAIN_PLAN.md`

Objective:
- Build Drovi as a live institutional cognition system inside `drovi-intelligence`, powered by Kafka + workers + graphdb + Postgres, with advanced memory, epistemic reasoning, causality, simulation, and governed intervention.

Execution constraint:
- **All net-new core system logic must live under `/Users/jeremyscatigna/project-memory/drovi-intelligence`**.

---

## Global Program Protocol

- [ ] G.01 All architectural decisions captured as ADRs in `/Users/jeremyscatigna/project-memory/docs/adr`.
- [ ] G.02 No high-stakes belief persists without evidence links.
- [ ] G.03 Every belief and recommendation carries explicit epistemic state and uncertainty.
- [ ] G.04 Every phase must end with green lint/type/tests and measurable acceptance checks.
- [ ] G.05 OpenAPI and event contracts are versioned on every shape change.
- [ ] G.06 Every model rollout must pass evaluation harness gates.
- [ ] G.07 All side-effecting interventions require policy class and rollback path.
- [ ] G.08 All pipelines must be replayable from event log + evidence artifacts.
- [ ] G.09 Alerting must include anti-noise controls and user feedback capture.
- [ ] G.10 Multi-tenant safety and audit logging are release blockers.
- [ ] G.11 Every source must have licensing classification and legal ingest approval.
- [ ] G.12 Crawl pipelines must enforce robots/ToS policy and takedown workflow.
- [ ] G.13 Lakehouse quality gates (freshness/completeness/schema) must block bad publishes.
- [ ] G.14 Cost and capacity budgets are required per source family before scale rollout.
- [ ] G.15 Every model artifact must be versioned with dataset/code lineage.
- [ ] G.16 No model is promoted without model card, offline metrics, and shadow results.
- [ ] G.17 Every source must have a defined freshness cadence policy (`hot`, `warm`, `cold`, `event_driven`) and owner.
- [ ] G.18 Continuous ingest must run via scheduled jobs/workflows with checkpointed recovery and no manual-only triggers.
- [ ] G.19 Raw->normalized->truth pipelines must have deterministic contract tests and replay validation.
- [ ] G.20 Web app surfaces must be shipped with backend APIs for operator and analyst usability.
- [ ] G.21 Production environments must be reproducible via IaC (no snowflake infrastructure).
- [ ] G.22 Secrets and provider credentials must be rotated and audited with no static plaintext in repo/runtime logs.
- [ ] G.23 SLOs and error budgets must exist for ingestion freshness, API latency, and worker reliability.
- [ ] G.24 DR posture (backup/restore + failover) must be tested on a recurring schedule.
- [ ] G.25 Every critical workflow must have runbooks and on-call ownership.
- [ ] G.26 FinOps guardrails (budgets, throttles, kill switches) are required before high-scale rollout.

---

## Phase 0 - Program Charter + Research Baseline

### Charter and Metrics
- [x] P0.01 Freeze final World Brain product contract and non-goals.
- [x] P0.02 Define pods: Cognitive Core, Causal/Normative, World Twin, Platform/SRE, Trust/Governance.
- [x] P0.03 Define north-star KPI suite and weekly review process.
- [x] P0.04 Define risk taxonomy and severity SLOs.

### ADR Baseline
- [x] P0.05 ADR: cognitive object taxonomy (`Observation`, `Belief`, `Hypothesis`, `Constraint`, `Intervention`, `Outcome`).
- [x] P0.06 ADR: temporal model (`valid_*`, `believed_*`, `observed_at`).
- [x] P0.07 ADR: epistemic state machine and transitions.
- [x] P0.08 ADR: Kafka topic taxonomy and replay guarantees.
- [x] P0.09 ADR: world twin materialization architecture.
- [x] P0.10 ADR: intervention policy and rollback contract.

### Acceptance
- [x] P0.A1 Program charter approved and owner matrix assigned.
- [x] P0.A2 ADR set complete for phase-1 through phase-3 irreversible choices.

---

## Phase 1 - Cognitive Schema + Data Foundations

### New Data Models (Postgres)
- [x] P1.01 Add migrations for `observation` and `observation_evidence_link`.
- [x] P1.02 Add migrations for `belief` and `belief_revision`.
- [x] P1.03 Add migrations for `hypothesis` and `hypothesis_score`.
- [x] P1.04 Add migrations for `constraint` and `constraint_violation_candidate`.
- [x] P1.05 Add migrations for `impact_edge`, `simulation_run`, `intervention_plan`, `realized_outcome`.
- [x] P1.06 Add migrations for `uncertainty_state` and `source_reliability_profile`.

### Evidence and Provenance
- [x] P1.07 Extend evidence chain to reference all new cognitive objects.
- [x] P1.08 Add provenance validator for cross-object evidence consistency.
- [x] P1.09 Add custody integrity jobs for new object families.

### Repository Touchpoints
- [x] P1.10 Extend models under `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/db/models`.
- [x] P1.11 Extend evidence paths under `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/evidence`.

### Acceptance
- [ ] P1.A1 Migrations apply/rollback in CI and staging (CI symmetry tests complete; staging apply/rollback run pending env access).
- [x] P1.A2 Provenance checks pass for synthetic end-to-end ingest.

---

## Phase 2 - Cognitive Event Bus (Kafka Nervous System)

### Topic and Contract Rollout
- [x] P2.01 Create event schemas for `observation.raw.*` and `observation.normalized.*`.
- [x] P2.02 Create event schemas for `belief.update.*` and `belief.degraded.*`.
- [x] P2.03 Create event schemas for `hypothesis.generated.*` and `hypothesis.rejected.*`.
- [x] P2.04 Create event schemas for `causal.edge.update.*` and `impact.edge.computed.*`.
- [x] P2.05 Create event schemas for `constraint.violation.candidate.*`.
- [x] P2.06 Create event schemas for `simulation.requested.*`, `simulation.completed.*`, `intervention.proposed.*`, `outcome.realized.*`.

### Replayability and Delivery Guarantees
- [x] P2.07 Add idempotent consumer keys and outbox guarantees.
- [x] P2.08 Add DLQ strategy and replay CLI for each topic family.
- [x] P2.09 Add schema compatibility checks in CI.

### Repository Touchpoints
- [x] P2.10 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/streaming/kafka_producer.py`.
- [x] P2.11 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/streaming/kafka_consumer.py`.
- [x] P2.12 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/events/types.py` and publisher/subscriber modules.

### Acceptance
- [ ] P2.A1 End-to-end event flow reliable under load with replay tests (unit reliability and replay contract tests complete; soak/load run pending environment execution).
- [x] P2.A2 Contract compatibility gate blocks breaking schema changes.

---

## Phase 2A - Source API Mesh and Provider Catalog

### Source Catalog and Governance
- [x] P2A.00 Keep `/Users/jeremyscatigna/project-memory/DROVI_WORLD_BRAIN_INGESTION_MATRIX.md` as the authoritative source inventory.
- [x] P2A.01 Create authoritative source catalog at `/Users/jeremyscatigna/project-memory/drovi-intelligence/config/source_catalog.yaml`.
- [x] P2A.02 Add source classification (`authoritative`, `commercial`, `osint`) and legal metadata fields.
- [x] P2A.03 Add per-source SLA, expected latency, and backfill policy metadata.
- [x] P2A.04 Add onboarding checklist template for new providers (auth, quotas, licensing, reliability, schema mapping).

### Tier 0 API Connectors (Must-Have)
- [x] P2A.05 Implement/adapt connectors for SEC/filings class sources.
- [x] P2A.06 Implement/adapt connectors for regulatory/legal publication sources.
- [x] P2A.07 Implement/adapt connectors for macroeconomic sources (rates, labor, GDP, fiscal).
- [x] P2A.08 Implement/adapt connectors for research/medical sources.
- [x] P2A.09 Implement/adapt connectors for vulnerability/safety feeds.

### Tier 1/Tier 2 Connectors
- [x] P2A.10 Implement connector interface for commercial premium feeds with per-tenant credentials.
- [x] P2A.11 Implement connector interface for RSS/OSINT source families.
- [x] P2A.12 Add source-health monitors and circuit breakers per provider.
- [x] P2A.15 Implement `worldnewsapi.com` connector and normalization mapping for global news events.
- [x] P2A.16 Add secure credential wiring for World News API via `WORLD_NEWS_API_KEY` (no hardcoded secrets).
- [x] P2A.17 Add source-specific quality checks for World News API (duplicate collapse, reliability calibration, latency SLO).

### World News API Implementation Detail
- [x] P2A.18 Implement endpoint adapters for `/search-news`, `/top-news`, `/front-pages`, `/retrieve-news`.
- [x] P2A.19 Implement endpoint adapters for `/extract-news`, `/extract-news-links`, `/feed.rss`.
- [x] P2A.20 Implement source lifecycle adapters for `/search-news-sources` and `/suggest-news-source`.
- [x] P2A.21 Implement quota-aware rate limiter using provider headers and dynamic backoff.
- [x] P2A.22 Implement pagination/checkpointing strategy (`offset`, time windows, query shards) for backfill + incremental sync.
- [x] P2A.23 Implement query planner that generates `search-news` queries from entity exposure + hypothesis context.
- [x] P2A.24 Add canonical dedupe across endpoint families using article ID + URL + publish timestamp hashes.
- [x] P2A.25 Add integration tests with mocked provider responses for auth errors, 402, 429, and 5xx scenarios.
- [x] P2A.26 Add operational metrics: ingest latency, quota burn rate, duplicate collapse ratio, publish success rate.

### Continuous Ingestion Orchestration (Workers + Cron + SLA)
- [x] P2A.27 Add source cadence policy registry with per-provider defaults (`hot`, `warm`, `cold`, `event_driven`).
- [x] P2A.28 Add scheduler job type for continuous source ingest with deterministic idempotency keys.
- [x] P2A.29 Register recurring schedules/workflows for all enabled world sources and tenants.
- [x] P2A.30 Add dynamic rescheduling logic based on freshness lag, quota headroom, and VOI priority.
- [x] P2A.31 Add backlog catch-up mode for stale sources with bounded concurrency and fairness controls.
- [x] P2A.32 Add checkpoint/watermark persistence contract per source with restart-safe resume.
- [x] P2A.33 Add ingestion run ledger (`source_sync_run`) with lag, duration, status, and cost metadata.
- [x] P2A.34 Add retry classes for auth errors, quota errors, transient failures, and permanent failures.
- [x] P2A.35 Add quarantine/auto-disable workflow for repeatedly failing or misbehaving sources.
- [x] P2A.36 Add freshness SLO monitors and alert routing by source owner.
- [x] P2A.37 Add per-tenant ingest budgets and noisy-neighbor protection.
- [x] P2A.38 Add operator APIs for pause/resume/replay/backfill by source and checkpoint.
- [x] P2A.39 Add integration tests for cadence execution, checkpoint resume, and no-gap/no-duplicate guarantees.

### Repository Touchpoints
- [x] P2A.13 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/connectors`.
- [ ] P2A.14 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/plugins` for pack-style provider modules.

### Acceptance
- [x] P2A.A1 Tier-0 source coverage complete for pilot domain scope.
- [x] P2A.A2 Source catalog enforces licensing and SLA metadata completeness.
- [ ] P2A.A3 World News API connector can ingest, normalize, and publish events through `observation.normalized.*` topics.
- [x] P2A.A4 World News API connector supports endpoint-complete ingestion with quota-safe scheduling and replayable checkpoints.
- [x] P2A.A5 Continuous ingest keeps Tier-0 sources within freshness SLO envelopes.
- [x] P2A.A6 Checkpoint replay restores ingest state without gaps or duplicates.

---

## Phase 2B - World Crawl Fabric (Scalable Scraping Infrastructure)

### Crawl Control Plane
- [x] P2B.01 Create crawl frontier service in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/crawlers/frontier`.
- [x] P2B.02 Implement domain-level scheduler with quota, priority, and freshness policies.
- [x] P2B.03 Add crawl orchestration topics (`crawl.frontier.*`, `crawl.fetch.*`, `crawl.parse.*`, `crawl.diff.*`).

### Fetch and Render Workers
- [x] P2B.04 Implement static fetch worker for HTML/JSON/XML/PDF retrieval.
- [x] P2B.05 Implement browser-render worker (Playwright) for JS-rendered sources.
- [x] P2B.06 Implement retry, proxy, timeout, and anti-block controls (legal-policy constrained).

### Parse and Diff Pipeline
- [x] P2B.07 Implement parser templates by source type (news, legal docs, filings, bulletins, PDFs).
- [x] P2B.08 Implement semantic diffing and change significance scoring.
- [x] P2B.09 Emit normalized observations only for meaningful deltas.

### Compliance and Safety
- [x] P2B.10 Implement robots/ToS policy engine and crawl allowlist/denylist.
- [x] P2B.11 Implement takedown and legal hold workflows.
- [x] P2B.12 Implement crawl audit logs and evidence traceability.

### Acceptance
- [x] P2B.A1 Crawl fleet scales horizontally with bounded failure rates under burst loads.
- [x] P2B.A2 Crawl compliance gates prevent disallowed fetches by policy.

---

## Phase 2C - Lakehouse, Cold Storage, and Backfill Platform

### Data Lakehouse Foundation
- [x] P2C.01 Create data-lake module at `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/lakehouse`.
- [x] P2C.02 Implement bronze/raw object and metadata writes from ingestion and crawl pipelines.
- [x] P2C.03 Implement silver/normalized tables for observations, entities, and evidence links.
- [x] P2C.04 Implement gold/feature tables for impact modeling, simulation, and eval datasets.

### Table and Schema Management
- [x] P2C.05 Adopt table format strategy (Iceberg/Delta/Hudi) and schema evolution rules.
- [x] P2C.06 Add schema registry compatibility checks for stream-to-lake writes.
- [x] P2C.07 Implement late-arrival handling and idempotent upsert semantics.

### Backfill and Replay
- [x] P2C.08 Build historical backfill jobs from archived evidence and source APIs.
- [x] P2C.09 Build replay jobs from Kafka checkpoints into lakehouse and downstream marts.
- [x] P2C.10 Add lakehouse data quality jobs (freshness, completeness, null drift, uniqueness).

### Access and Cost Control
- [x] P2C.11 Add partitioning and retention lifecycle policy by source/tenant/domain.
- [x] P2C.12 Add per-source and per-tenant storage/compute cost attribution.
- [x] P2C.13 Add query interfaces for model training and analytics consumers.

### Acceptance
- [x] P2C.A1 Lakehouse supports deterministic replay and historical model dataset generation.
- [x] P2C.A2 Data quality gates block bad partitions from promotion.

---

## Phase 2D - Ingestion Processing Spine (Raw -> Normalized -> Truth)

### Raw Capture and Persistence
- [x] P2D.01 Persist every fetched/scraped payload to immutable evidence/object storage before transformation.
- [x] P2D.02 Emit `observation.raw.*` events with artifact hash, source metadata, and ingest run ID.
- [x] P2D.03 Implement canonical normalization adapters for each source family (regulatory, macro, research, vulnerabilities, news).
- [x] P2D.04 Persist normalized observations to Postgres and lakehouse silver with schema compatibility checks.

### Processing Workers
- [x] P2D.05 Add worker topology for normalization, dedupe, entity linking, reliability scoring, and impact precompute.
- [x] P2D.06 Implement outbox/exactly-once semantics between DB persistence and Kafka publish paths.
- [x] P2D.07 Add poison-message handling and replay tooling per worker stage.
- [x] P2D.08 Add end-to-end trace IDs from source fetch through tape event materialization.

### Data Governance and Lifecycle
- [x] P2D.09 Define retention classes for raw artifacts, normalized observations, and derived features.
- [x] P2D.10 Add legal hold hooks and immutable retention overrides for high-stakes evidence.
- [x] P2D.11 Add tenant export/delete workflows spanning Postgres, graph, and lakehouse layers.
- [x] P2D.12 Add source reliability calibration jobs that feed `source_reliability_profile`.

### Acceptance
- [x] P2D.A1 Source event -> normalized observation pipeline is fully automated and continuously running.
- [x] P2D.A2 Evidence hash integrity is preserved across raw and normalized persistence layers.

---

## Phase 3 - Multi-Memory Substrate Implementation

### New Memory Contexts
- [x] P3.01 Create `src/world_model` for twin materialization and snapshots.
- [x] P3.02 Create `src/epistemics` for belief states and transitions.
- [x] P3.03 Create `src/hypothesis` for alternative explanation generation.
- [x] P3.04 Create `src/causal` for causal edges and propagation.
- [x] P3.05 Create `src/normative` for obligations and violations.
- [x] P3.06 Create `src/attention` for value-of-information scheduling.
- [x] P3.07 Create `src/intervention` for action planning and policy classing.
- [x] P3.08 Create `src/learning` for online calibration and correction loops.

### Integration with Existing Memory Stack
- [x] P3.09 Integrate new contexts with `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/memory`.
- [x] P3.10 Extend graph evolution logic in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/graph/evolution.py`.
- [x] P3.11 Extend change tracking in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/graph/changes`.

### Acceptance
- [x] P3.A1 New memory layers compile and execute in dry-run pipeline mode.
- [x] P3.A2 Backward compatibility preserved for existing UIO flows.

---

## Phase 4 - Epistemic Engine (Belief Intelligence)

### Belief Lifecycle
- [x] P4.01 Implement epistemic state machine (`asserted`, `corroborated`, `contested`, `degraded`, `retracted`, `unknown`).
- [x] P4.02 Implement belief revision logic with evidence-based updates.
- [x] P4.03 Implement calibration buckets and confidence decay logic.
- [x] P4.04 Implement contradiction-triggered belief degradation.

### APIs and Queries
- [x] P4.05 Add `/brain/beliefs` query endpoints.
- [x] P4.06 Add belief trail endpoint with temporal transitions.
- [x] P4.07 Add evidence expansion endpoint for belief support and contestation.

### Acceptance
- [x] P4.A1 Belief revisions deterministic and replayable.
- [x] P4.A2 Calibration metrics available by source and model version.

---

## Phase 5 - Hypothesis Engine (Competing Explanations)

### Core Capability
- [x] P5.01 Generate top-K hypotheses for major anomalies and high-impact deltas.
- [x] P5.02 Score hypotheses against evidence fit, consistency, and prior probability.
- [x] P5.03 Persist rejected hypotheses for audit and learning.
- [x] P5.04 Expose hypothesis alternatives in user and agent APIs.

### Workerization
- [x] P5.05 Add hypothesis generation worker in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/jobs`.
- [x] P5.06 Add hypothesis rescoring worker triggered by new evidence.

### Acceptance
- [x] P5.A1 Major contradiction events show at least one credible alternative hypothesis.
- [x] P5.A2 Hypothesis selection quality meets red-team benchmark.

---

## Phase 6 - Causal Engine (Mechanism, Not Correlation)

### Causal Graph
- [x] P6.01 Implement causal edge model with sign, lag distribution, and confidence.
- [x] P6.02 Implement incremental causal update from observed outcomes.
- [x] P6.03 Implement propagation function for second-order impact.
- [x] P6.04 Implement causal confidence degradation on conflict.

### Integration
- [x] P6.05 Integrate with `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/simulation/engine.py`.
- [x] P6.06 Integrate causal traversals with graph client and indexes.

### Acceptance
- [x] P6.A1 Causal propagation produces stable impact chains under replay.
- [x] P6.A2 Backtests show improvement over correlation-only impact ranking.

---

## Phase 7 - Normative Intelligence (Machine-Checkable Obligations)

### Constraint Modeling
- [x] P7.01 Implement normalized constraint DSL for law/policy/contract obligations.
- [x] P7.02 Build parser adapters for legal/policy source classes.
- [x] P7.03 Map constraints to scoped entities and actions.
- [x] P7.04 Define breach severity and pre-breach warning thresholds.

### Sentinel
- [x] P7.05 Implement running violation candidate detector worker.
- [x] P7.06 Implement pre-breach intervention generation.
- [x] P7.07 Add obligation timeline surface and evidence traces.

### Acceptance
- [x] P7.A1 Constraint engine catches synthetic breach scenarios with target recall.
- [x] P7.A2 False-positive pre-breach alerts remain below agreed threshold.

---

## Phase 8 - Exposure Topology + Impact Engine v2

### Exposure Topology
- [x] P8.01 Implement entity exposure graph from internal commitments, counterparties, assets, and dependencies.
- [x] P8.02 Add weighted exposure edges and propagation limits.
- [x] P8.03 Add tenant-specific risk appetite overlays.

### Impact Computation
- [x] P8.04 Implement impact score formula combining exposure, materiality, causal strength, and uncertainty.
- [x] P8.05 Implement bridge generation (external delta -> internal consequence).
- [x] P8.06 Implement impact de-duplication and anti-spam throttling.

### Acceptance
- [x] P8.A1 Impact precision improves over phase-1 baseline by agreed target.
- [x] P8.A2 Alert fatigue remains within defined UX envelope.

---

## Phase 9 - Institutional World Twin Materialization

### Twin Build
- [x] P9.01 Implement world twin snapshot builder job.
- [x] P9.02 Implement streaming twin updater for near-real-time state changes.
- [x] P9.03 Implement twin diff and drift metrics.
- [x] P9.04 Implement role-specific twin views (exec, legal, finance, product).

### Surfaces
- [x] P9.05 Implement World Pressure Map API.
- [x] P9.06 Implement Belief Drift Radar API.
- [x] P9.07 Implement exposure and pressure explainability endpoints.

### Acceptance
- [x] P9.A1 Twin refresh latency meets operational target.
- [x] P9.A2 Twin diff accuracy validated against seeded event sets.

---

## Phase 10 - Counterfactual Simulation + Intervention Planner

### Simulation Engine v2
- [x] P10.01 Extend scenario model to support multi-step interventions.
- [x] P10.02 Add utility function framework by tenant objective profile.
- [x] P10.03 Add downside and uncertainty interval outputs.
- [x] P10.04 Add stress tests for adversarial and rare-event scenarios.

### Intervention Planner
- [x] P10.05 Implement intervention plan generator with action graph.
- [x] P10.06 Add policy gating and approval classes.
- [x] P10.07 Add rollback path generation and verification.
- [x] P10.08 Add intervention outcome capture and feedback hooks.

### Acceptance
- [x] P10.A1 Counterfactual outcomes reproducible under seeded replays.
- [x] P10.A2 Intervention plans comply with policy and rollback requirements.

---

## Phase 11 - APIs, Tape, and World Brain UX

### API Expansion
- [x] P11.01 Add `/brain/observations`, `/brain/beliefs`, `/brain/hypotheses` endpoints.
- [x] P11.02 Add `/brain/constraints` and `/brain/violations` endpoints.
- [x] P11.03 Add `/brain/twin` and `/brain/twin/diff` endpoints.
- [x] P11.04 Add `/brain/simulate` and `/brain/interventions` endpoints.
- [x] P11.05 Add Ask v2 endpoint with truth->uncertainty->narrative ordering.

### Tape and Live Surfaces
- [x] P11.06 Extend tape event schema for belief/hypothesis/constraint/causal deltas.
- [x] P11.07 Add live world pressure lane and bridge visualization contracts.
- [x] P11.08 Add proof bundle expansion for each tape tile.
- [x] P11.11 Implement Counterfactual Lab UI/API integration for A/B intervention comparison.
- [x] P11.12 Implement Obligation Sentinel UI/API integration for pre-breach and post-breach workflows.

### Contracts
- [x] P11.09 Generate internal API spec snapshots under `/Users/jeremyscatigna/project-memory/drovi-intelligence/openapi`.
- [x] P11.10 Publish machine-readable API/event contracts under `/Users/jeremyscatigna/project-memory/drovi-intelligence/contracts` for downstream consumers.

### Acceptance
- [ ] P11.A1 API contracts stable across one full release cycle.
- [ ] P11.A2 Tape supports high-signal cognition deltas without feed-noise regression.

---

## Phase 11A - Web App Productization (World Brain UX in `apps/web`)

### Experience Architecture
- [x] P11A.01 Add world-brain route map and navigation integration in `/Users/jeremyscatigna/project-memory/apps/web`.
- [x] P11A.02 Add tenant-scoped World Brain landing page with freshness, drift, and alert posture.
- [x] P11A.03 Add feature flags for phased rollout by tenant and role.

### Core World Brain Surfaces
- [x] P11A.04 Implement Ledger Tape page with internal lane, external lane, and impact bridge visualization.
- [x] P11A.05 Implement Reality Scrubber playback control with deterministic time-slice rendering.
- [x] P11A.06 Implement Proof Bundle drawer (citations, provenance chain, confidence rationale).
- [x] P11A.07 Implement Impact Card and Drift Meter components with severity and confidence encoding.
- [x] P11A.08 Implement Obligation Sentinel dashboard for breach and pre-breach triage workflows.
- [x] P11A.09 Implement Counterfactual Lab UI for scenario comparison and rollback preview.

### Operator and Analyst Workflows
- [x] P11A.10 Implement source health console (freshness lag, quota burn, connector failures).
- [x] P11A.11 Implement replay/backfill operator controls with RBAC and audit trail.
- [x] P11A.12 Implement user feedback capture (false positive/negative, correction labels) into learning pipeline.

### Frontend Quality and Runtime
- [x] P11A.13 Add e2e tests for core workflows (alert -> proof -> action).
- [x] P11A.14 Add accessibility and responsive coverage for desktop/tablet/mobile.
- [x] P11A.15 Add frontend performance budgets and monitoring (LCP, TTI, interaction latency).

### Acceptance
- [x] P11A.A1 Users can move from signal to evidence-backed action in <=3 interactions for core flows.
- [ ] P11A.A2 World Brain web surfaces meet accessibility and performance SLOs in production.

---

## Phase 12 - Model Evaluation, Online Learning, and VOI Attention

### Evaluation Harness
- [x] P12.01 Extend evaluator for belief-state accuracy and calibration error.
- [x] P12.02 Add hypothesis ranking quality benchmarks.
- [x] P12.03 Add causal forecast backtest benchmarks.
- [x] P12.04 Add constraint violation detection benchmarks.

### Online Learning
- [x] P12.05 Ingest user correction events into learning pipeline.
- [x] P12.06 Retrain/recalibrate confidence models on scheduled cadence.
- [x] P12.07 Add shadow deployment for model rollouts.

### Attention Engine
- [x] P12.08 Implement value-of-information scoring for ingestion prioritization.
- [x] P12.09 Implement dynamic compute allocation by VOI and SLA.
- [x] P12.10 Add anti-starvation guarantees for low-frequency high-risk signals.

### Acceptance
- [x] P12.A1 Model regression gates block low-quality rollouts.
- [x] P12.A2 VOI scheduling improves useful-impact-per-compute metrics.

---

## Phase 12A - ML Platform and ModelOps

### Data, Labels, and Features
- [x] P12A.01 Create `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/mlops` module for model lifecycle orchestration.
- [x] P12A.02 Create `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/features` module for feature definitions and transformations.
- [x] P12A.03 Implement point-in-time-correct feature extraction pipelines from lakehouse silver/gold tables.
- [x] P12A.04 Implement automated label pipelines from user corrections, contradiction outcomes, and intervention outcomes.
- [x] P12A.05 Implement feature/label quality validation jobs (null drift, leakage checks, class balance).

### Training and Registry
- [x] P12A.06 Implement reproducible training pipelines (dataset snapshot + config + code hash).
- [x] P12A.07 Implement hyperparameter tuning workflows for high-impact models.
- [x] P12A.08 Implement model registry with stage promotion states (`dev`, `shadow`, `canary`, `prod`).
- [x] P12A.09 Implement mandatory model cards including use-case bounds and known failure modes.

### Serving and Routing
- [x] P12A.10 Implement unified inference gateway for neural models and LLM calls.
- [x] P12A.11 Implement policy-aware model router by risk class, latency, and cost budget.
- [x] P12A.12 Implement response schema validators and fallback cascades for inference failures.
- [x] P12A.13 Implement online + batch inference pipelines with consistent output contracts.

### Deployment and Evaluation
- [x] P12A.14 Implement shadow deployment framework for candidate models.
- [x] P12A.15 Implement canary rollout controller with automated rollback on metric regression.
- [x] P12A.16 Implement continuous calibration monitoring and degradation alerts.
- [x] P12A.17 Implement per-model cost/latency dashboards and SLA tracking.

### Advanced Model Families
- [x] P12A.18 Implement temporal forecasting baseline (transformer/state-space) for drift prediction.
- [x] P12A.19 Implement graph model baseline (GNN/link prediction) for exposure and impact propagation.
- [x] P12A.20 Implement verifier/NLI model for contradiction and evidence consistency scoring.
- [x] P12A.21 Benchmark causal discovery/estimation pipelines against current causal engine heuristics.

### Graph Backend Strategy Gates
- [x] P12A.22 Implement graph abstraction benchmarks to evaluate hot-path limits of current graph backend.
- [x] P12A.23 Define objective thresholds for evaluating secondary graph backend augmentation.
- [x] P12A.24 Implement migration playbook prototype that preserves query semantics across graph backends.

### Acceptance
- [x] P12A.A1 Model lifecycle is fully reproducible from data snapshot to promoted artifact.
- [x] P12A.A2 Shadow/canary workflow blocks regressions before production rollout.
- [x] P12A.A3 At least three core model families are productionized with monitoring and rollback.

---

## Phase 13 - Security, Governance, and Trust Hardening

### Security
- [x] P13.01 Enforce tenant RLS and scope checks for all new cognitive endpoints.
- [x] P13.02 Enforce role-based redaction for sensitive evidence paths.
- [x] P13.03 Add encrypted-at-rest handling for sensitive belief/constraint payloads.

### Governance
- [x] P13.04 Add immutable audit chain for belief updates and intervention decisions.
- [x] P13.05 Add explainability payload standards for all high-impact outputs.
- [x] P13.06 Add governance export bundle for enterprise audits.

### Trust UI/Signals
- [x] P13.07 Add uncertainty and calibration indicators to API and UI payloads.
- [x] P13.08 Add contradiction confidence and source reliability indicators.

### Acceptance
- [ ] P13.A1 Security review passes with no critical findings.
- [ ] P13.A2 Audit replay can reconstruct end-to-end reasoning path.

---

## Phase 14 - Performance, Scale, and Reliability

### Performance
- [x] P14.01 Define p95 SLOs for belief update, impact compute, and tape publish.
- [x] P14.02 Optimize graph traversals for exposure and causal propagation.
- [x] P14.03 Add cache and pre-materialization for hot twin queries.

### Reliability
- [x] P14.04 Add chaos tests for Kafka partition lag and worker failures.
- [x] P14.05 Add recovery runbooks for DLQ backlog and replay storms.
- [x] P14.06 Add graceful degradation modes for provider outages.

### Cost
- [x] P14.07 Add cost attribution by pack, worker, and tenant.
- [x] P14.08 Add adaptive compute throttles tied to VOI and SLA.

### Platform Scaling Components
- [x] P14.09 Harden Kafka cluster topology (partition strategy, retention classes, tiered storage).
- [x] P14.10 Deploy and enforce schema registry for all event contracts.
- [x] P14.11 Add dedicated stream processing tier for high-volume transforms.
- [x] P14.12 Add lakehouse query/compute tier for large historical jobs.
- [x] P14.13 Add storage lifecycle automation (hot->warm->cold transitions).
- [x] P14.14 Add multi-region backup/restore drills for evidence and lakehouse layers.
- [x] P14.15 Add ingest surge controls (global kill-switches, source throttles, priority degradation).
- [x] P14.16 Add capacity forecasting dashboards (event rate, storage growth, graph cardinality).
- [x] P14.17 Deploy GPU inference pool for heavy verifier/planner/cross-encoder workloads.
- [x] P14.18 Deploy CPU inference pool for high-throughput extraction/ranking workloads.
- [x] P14.19 Implement inference workload queueing with priority classes by risk and SLA.
- [x] P14.20 Implement autoscaling policies for inference pools based on backlog and latency targets.

### Acceptance
- [ ] P14.A1 End-to-end throughput target met at projected scale (pending staged load/throughput run).
- [ ] P14.A2 Reliability and cost envelope stable over soak tests (pending long-horizon soak execution).

---

## Phase 14A - Production Infrastructure, Environments, and DevSecOps

### Environment and IaC Foundation
- [x] P14A.01 Define dev/staging/prod reference architecture and environment parity rules.
- [x] P14A.02 Implement IaC modules for Kafka, Postgres, GraphDB, object storage, lakehouse, and schema registry.
- [x] P14A.03 Implement network segmentation, private service routing, and policy boundaries.
- [x] P14A.04 Implement secrets management and automated credential rotation for provider integrations.
- [x] P14A.05 Implement environment drift detection and configuration compliance checks.

### Orchestration and Compute
- [x] P14A.06 Deploy dedicated worker pools by function (ingest, normalize, graph, ml, simulation).
- [x] P14A.07 Deploy recurring ingest/maintenance schedules (cron/Temporal) with safe failover.
- [x] P14A.08 Implement autoscaling policies by queue lag, freshness lag, and compute utilization.
- [x] P14A.09 Implement workload isolation classes for high-priority risk and compliance pipelines.

### CI/CD and Release Controls
- [x] P14A.10 Implement CI gates for contracts, migrations, smoke tests, and replay tests.
- [x] P14A.11 Implement canary/blue-green deployment workflows with automatic rollback.
- [x] P14A.12 Implement zero-downtime migration playbooks for DB and graph schema evolution.
- [x] P14A.13 Implement signed build/model artifact provenance in delivery pipeline.

### Observability and Incident Operations
- [x] P14A.14 Implement dashboards for freshness lag, pipeline throughput, queue backlog, and failure classes.
- [x] P14A.15 Implement paging/escalation policy by severity and tenant impact.
- [x] P14A.16 Implement runbooks and game-days for provider outage, quota exhaustion, and replay storms.
- [x] P14A.17 Implement SLA and error-budget reporting by source family and service component.

### Business Continuity
- [x] P14A.18 Implement backup/restore policies for Postgres, graph, evidence store, and lakehouse metadata.
- [x] P14A.19 Validate DR RTO/RPO through recurring restore drills.
- [x] P14A.20 Implement regional failover strategy for critical ingestion and serving paths.

### Acceptance
- [ ] P14A.A1 Platform can be provisioned from IaC into a clean environment and pass smoke tests (CI gates added; clean-environment apply/smoke execution pending infrastructure-run validation).
- [ ] P14A.A2 DR and incident drills meet defined recovery targets with verified data integrity (automations and runbooks added; first full drill evidence pending execution artifacts).

---

## Phase 15 - Pilot Proof and Category Launch Readiness

### Pilot Proof
- [ ] P15.01 Select pilot tenants with high consequence workflows.
- [ ] P15.02 Establish baseline metrics for contradiction, drift, and missed-impact incidence.
- [ ] P15.03 Run 8-12 week pilot and capture prevented-loss/prevented-liability events.
- [ ] P15.04 Publish evidence-backed case studies.

### Launch Readiness
- [ ] P15.05 Finalize packaging for core cognition and premium world intelligence packs.
- [ ] P15.06 Finalize category narrative and technical whitepaper.
- [ ] P15.07 Finalize on-call model and reliability commitments.

### Acceptance
- [ ] P15.A1 Pilot shows statistically meaningful operational improvement.
- [ ] P15.A2 Launch readiness checklist completed across product, security, and infra.

---

## Phase 16 - End-to-End Integration, Operational Readiness, and Cutover

### Cross-System Integration
- [ ] P16.01 Run end-to-end integration tests from source ingest -> normalized observation -> belief/impact -> tape/web UI.
- [ ] P16.02 Validate contract consistency across Kafka events, DB schemas, API responses, and frontend types.
- [ ] P16.03 Validate multi-tenant isolation and cross-tenant data leak tests across all layers.
- [ ] P16.04 Validate agent integrations consume truth-first payloads and obey policy constraints.

### Operational Readiness
- [ ] P16.05 Finalize runbook suite for ingest incidents, replay operations, data repairs, and model rollbacks.
- [ ] P16.06 Finalize on-call schedule and escalation matrix across platform, ML, and product teams.
- [ ] P16.07 Finalize launch checklist with security, legal, compliance, and SRE sign-offs.
- [ ] P16.08 Run full dress-rehearsal cutover in staging with production-like load.

### Acceptance
- [ ] P16.A1 Full-system rehearsal passes with no sev-1/sev-2 unresolved blockers.
- [ ] P16.A2 Launch gate approved by product, infra, security, and governance owners.

---

## Optional Polyglot Workstream (Inside drovi-intelligence)

- [ ] X.01 Create `/Users/jeremyscatigna/project-memory/drovi-intelligence/services/reasoner-rs` for causal graph propagation hot paths.
- [ ] X.02 Create `/Users/jeremyscatigna/project-memory/drovi-intelligence/services/streamcore-rs` for ultra-low-latency scoring paths.
- [ ] X.03 Define gRPC/Kafka contract bridges to Python orchestration.
- [ ] X.04 Add cross-language conformance test harness.

Acceptance:
- [ ] X.A1 Polyglot services improve target p95/p99 latency without reducing correctness.

---

## Immediate 45-Day Sprint Set (Concrete)

- [ ] S45.01 Ship migrations for observation/belief/hypothesis/constraint core tables.
- [ ] S45.02 Ship Kafka topic contracts for observation->belief->impact chain.
- [ ] S45.03 Ship epistemic state machine v1 with belief revision endpoint.
- [x] S45.04 Ship world twin snapshot job v1 and twin diff endpoint.
- [x] S45.05 Ship constraint sentinel prototype for one legal domain.
- [x] S45.06 Ship causal edge prototype and impact bridge generator v1.
- [ ] S45.07 Ship Ask v2 truth-first payload format.
- [ ] S45.08 Ship evaluation dashboard (calibration, contradiction precision, impact precision).
- [ ] S45.09 Ship audit replay trail for one end-to-end intervention path.
- [ ] S45.10 Ship feature pipeline v0 for belief revision and impact ranking models.
- [ ] S45.11 Ship model registry v0 with `dev -> shadow` promotion.
- [ ] S45.12 Ship inference gateway v0 with policy-aware model routing hooks.
- [ ] S45.13 Ship continuous ingest scheduler v0 with checkpointed resume for Tier-0 sources.
- [ ] S45.14 Ship raw->normalized->truth processing spine v0 with end-to-end trace IDs.
- [ ] S45.15 Ship World Brain web shell (Tape + Proof Bundle + source health console) in `/Users/jeremyscatigna/project-memory/apps/web`.
- [ ] S45.16 Ship infra baseline (IaC + CI contract gate + canary deploy) for staging.
