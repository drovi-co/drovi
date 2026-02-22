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

---

## Phase 0 - Program Charter + Research Baseline

### Charter and Metrics
- [ ] P0.01 Freeze final World Brain product contract and non-goals.
- [ ] P0.02 Define pods: Cognitive Core, Causal/Normative, World Twin, Platform/SRE, Trust/Governance.
- [ ] P0.03 Define north-star KPI suite and weekly review process.
- [ ] P0.04 Define risk taxonomy and severity SLOs.

### ADR Baseline
- [ ] P0.05 ADR: cognitive object taxonomy (`Observation`, `Belief`, `Hypothesis`, `Constraint`, `Intervention`, `Outcome`).
- [ ] P0.06 ADR: temporal model (`valid_*`, `believed_*`, `observed_at`).
- [ ] P0.07 ADR: epistemic state machine and transitions.
- [ ] P0.08 ADR: Kafka topic taxonomy and replay guarantees.
- [ ] P0.09 ADR: world twin materialization architecture.
- [ ] P0.10 ADR: intervention policy and rollback contract.

### Acceptance
- [ ] P0.A1 Program charter approved and owner matrix assigned.
- [ ] P0.A2 ADR set complete for phase-1 through phase-3 irreversible choices.

---

## Phase 1 - Cognitive Schema + Data Foundations

### New Data Models (Postgres)
- [ ] P1.01 Add migrations for `observation` and `observation_evidence_link`.
- [ ] P1.02 Add migrations for `belief` and `belief_revision`.
- [ ] P1.03 Add migrations for `hypothesis` and `hypothesis_score`.
- [ ] P1.04 Add migrations for `constraint` and `constraint_violation_candidate`.
- [ ] P1.05 Add migrations for `impact_edge`, `simulation_run`, `intervention_plan`, `realized_outcome`.
- [ ] P1.06 Add migrations for `uncertainty_state` and `source_reliability_profile`.

### Evidence and Provenance
- [ ] P1.07 Extend evidence chain to reference all new cognitive objects.
- [ ] P1.08 Add provenance validator for cross-object evidence consistency.
- [ ] P1.09 Add custody integrity jobs for new object families.

### Repository Touchpoints
- [ ] P1.10 Extend models under `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/db/models`.
- [ ] P1.11 Extend evidence paths under `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/evidence`.

### Acceptance
- [ ] P1.A1 Migrations apply/rollback in CI and staging.
- [ ] P1.A2 Provenance checks pass for synthetic end-to-end ingest.

---

## Phase 2 - Cognitive Event Bus (Kafka Nervous System)

### Topic and Contract Rollout
- [ ] P2.01 Create event schemas for `observation.raw.*` and `observation.normalized.*`.
- [ ] P2.02 Create event schemas for `belief.update.*` and `belief.degraded.*`.
- [ ] P2.03 Create event schemas for `hypothesis.generated.*` and `hypothesis.rejected.*`.
- [ ] P2.04 Create event schemas for `causal.edge.update.*` and `impact.edge.computed.*`.
- [ ] P2.05 Create event schemas for `constraint.violation.candidate.*`.
- [ ] P2.06 Create event schemas for `simulation.requested.*`, `simulation.completed.*`, `intervention.proposed.*`, `outcome.realized.*`.

### Replayability and Delivery Guarantees
- [ ] P2.07 Add idempotent consumer keys and outbox guarantees.
- [ ] P2.08 Add DLQ strategy and replay CLI for each topic family.
- [ ] P2.09 Add schema compatibility checks in CI.

### Repository Touchpoints
- [ ] P2.10 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/streaming/kafka_producer.py`.
- [ ] P2.11 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/streaming/kafka_consumer.py`.
- [ ] P2.12 Extend `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/events/types.py` and publisher/subscriber modules.

### Acceptance
- [ ] P2.A1 End-to-end event flow reliable under load with replay tests.
- [ ] P2.A2 Contract compatibility gate blocks breaking schema changes.

---

## Phase 3 - Multi-Memory Substrate Implementation

### New Memory Contexts
- [ ] P3.01 Create `src/world_model` for twin materialization and snapshots.
- [ ] P3.02 Create `src/epistemics` for belief states and transitions.
- [ ] P3.03 Create `src/hypothesis` for alternative explanation generation.
- [ ] P3.04 Create `src/causal` for causal edges and propagation.
- [ ] P3.05 Create `src/normative` for obligations and violations.
- [ ] P3.06 Create `src/attention` for value-of-information scheduling.
- [ ] P3.07 Create `src/intervention` for action planning and policy classing.
- [ ] P3.08 Create `src/learning` for online calibration and correction loops.

### Integration with Existing Memory Stack
- [ ] P3.09 Integrate new contexts with `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/memory`.
- [ ] P3.10 Extend graph evolution logic in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/graph/evolution.py`.
- [ ] P3.11 Extend change tracking in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/graph/changes`.

### Acceptance
- [ ] P3.A1 New memory layers compile and execute in dry-run pipeline mode.
- [ ] P3.A2 Backward compatibility preserved for existing UIO flows.

---

## Phase 4 - Epistemic Engine (Belief Intelligence)

### Belief Lifecycle
- [ ] P4.01 Implement epistemic state machine (`asserted`, `corroborated`, `contested`, `degraded`, `retracted`, `unknown`).
- [ ] P4.02 Implement belief revision logic with evidence-based updates.
- [ ] P4.03 Implement calibration buckets and confidence decay logic.
- [ ] P4.04 Implement contradiction-triggered belief degradation.

### APIs and Queries
- [ ] P4.05 Add `/brain/beliefs` query endpoints.
- [ ] P4.06 Add belief trail endpoint with temporal transitions.
- [ ] P4.07 Add evidence expansion endpoint for belief support and contestation.

### Acceptance
- [ ] P4.A1 Belief revisions deterministic and replayable.
- [ ] P4.A2 Calibration metrics available by source and model version.

---

## Phase 5 - Hypothesis Engine (Competing Explanations)

### Core Capability
- [ ] P5.01 Generate top-K hypotheses for major anomalies and high-impact deltas.
- [ ] P5.02 Score hypotheses against evidence fit, consistency, and prior probability.
- [ ] P5.03 Persist rejected hypotheses for audit and learning.
- [ ] P5.04 Expose hypothesis alternatives in user and agent APIs.

### Workerization
- [ ] P5.05 Add hypothesis generation worker in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/jobs`.
- [ ] P5.06 Add hypothesis rescoring worker triggered by new evidence.

### Acceptance
- [ ] P5.A1 Major contradiction events show at least one credible alternative hypothesis.
- [ ] P5.A2 Hypothesis selection quality meets red-team benchmark.

---

## Phase 6 - Causal Engine (Mechanism, Not Correlation)

### Causal Graph
- [ ] P6.01 Implement causal edge model with sign, lag distribution, and confidence.
- [ ] P6.02 Implement incremental causal update from observed outcomes.
- [ ] P6.03 Implement propagation function for second-order impact.
- [ ] P6.04 Implement causal confidence degradation on conflict.

### Integration
- [ ] P6.05 Integrate with `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/simulation/engine.py`.
- [ ] P6.06 Integrate causal traversals with graph client and indexes.

### Acceptance
- [ ] P6.A1 Causal propagation produces stable impact chains under replay.
- [ ] P6.A2 Backtests show improvement over correlation-only impact ranking.

---

## Phase 7 - Normative Intelligence (Machine-Checkable Obligations)

### Constraint Modeling
- [ ] P7.01 Implement normalized constraint DSL for law/policy/contract obligations.
- [ ] P7.02 Build parser adapters for legal/policy source classes.
- [ ] P7.03 Map constraints to scoped entities and actions.
- [ ] P7.04 Define breach severity and pre-breach warning thresholds.

### Sentinel
- [ ] P7.05 Implement running violation candidate detector worker.
- [ ] P7.06 Implement pre-breach intervention generation.
- [ ] P7.07 Add obligation timeline surface and evidence traces.

### Acceptance
- [ ] P7.A1 Constraint engine catches synthetic breach scenarios with target recall.
- [ ] P7.A2 False-positive pre-breach alerts remain below agreed threshold.

---

## Phase 8 - Exposure Topology + Impact Engine v2

### Exposure Topology
- [ ] P8.01 Implement entity exposure graph from internal commitments, counterparties, assets, and dependencies.
- [ ] P8.02 Add weighted exposure edges and propagation limits.
- [ ] P8.03 Add tenant-specific risk appetite overlays.

### Impact Computation
- [ ] P8.04 Implement impact score formula combining exposure, materiality, causal strength, and uncertainty.
- [ ] P8.05 Implement bridge generation (external delta -> internal consequence).
- [ ] P8.06 Implement impact de-duplication and anti-spam throttling.

### Acceptance
- [ ] P8.A1 Impact precision improves over phase-1 baseline by agreed target.
- [ ] P8.A2 Alert fatigue remains within defined UX envelope.

---

## Phase 9 - Institutional World Twin Materialization

### Twin Build
- [ ] P9.01 Implement world twin snapshot builder job.
- [ ] P9.02 Implement streaming twin updater for near-real-time state changes.
- [ ] P9.03 Implement twin diff and drift metrics.
- [ ] P9.04 Implement role-specific twin views (exec, legal, finance, product).

### Surfaces
- [ ] P9.05 Implement World Pressure Map API.
- [ ] P9.06 Implement Belief Drift Radar API.
- [ ] P9.07 Implement exposure and pressure explainability endpoints.

### Acceptance
- [ ] P9.A1 Twin refresh latency meets operational target.
- [ ] P9.A2 Twin diff accuracy validated against seeded event sets.

---

## Phase 10 - Counterfactual Simulation + Intervention Planner

### Simulation Engine v2
- [ ] P10.01 Extend scenario model to support multi-step interventions.
- [ ] P10.02 Add utility function framework by tenant objective profile.
- [ ] P10.03 Add downside and uncertainty interval outputs.
- [ ] P10.04 Add stress tests for adversarial and rare-event scenarios.

### Intervention Planner
- [ ] P10.05 Implement intervention plan generator with action graph.
- [ ] P10.06 Add policy gating and approval classes.
- [ ] P10.07 Add rollback path generation and verification.
- [ ] P10.08 Add intervention outcome capture and feedback hooks.

### Acceptance
- [ ] P10.A1 Counterfactual outcomes reproducible under seeded replays.
- [ ] P10.A2 Intervention plans comply with policy and rollback requirements.

---

## Phase 11 - APIs, Tape, and World Brain UX

### API Expansion
- [ ] P11.01 Add `/brain/observations`, `/brain/beliefs`, `/brain/hypotheses` endpoints.
- [ ] P11.02 Add `/brain/constraints` and `/brain/violations` endpoints.
- [ ] P11.03 Add `/brain/twin` and `/brain/twin/diff` endpoints.
- [ ] P11.04 Add `/brain/simulate` and `/brain/interventions` endpoints.
- [ ] P11.05 Add Ask v2 endpoint with truth->uncertainty->narrative ordering.

### Tape and Live Surfaces
- [ ] P11.06 Extend tape event schema for belief/hypothesis/constraint/causal deltas.
- [ ] P11.07 Add live world pressure lane and bridge visualization contracts.
- [ ] P11.08 Add proof bundle expansion for each tape tile.

### Contracts
- [ ] P11.09 Generate internal API spec snapshots under `/Users/jeremyscatigna/project-memory/drovi-intelligence/openapi`.
- [ ] P11.10 Publish machine-readable API/event contracts under `/Users/jeremyscatigna/project-memory/drovi-intelligence/contracts` for downstream consumers.

### Acceptance
- [ ] P11.A1 API contracts stable across one full release cycle.
- [ ] P11.A2 Tape supports high-signal cognition deltas without feed-noise regression.

---

## Phase 12 - Model Evaluation, Online Learning, and VOI Attention

### Evaluation Harness
- [ ] P12.01 Extend evaluator for belief-state accuracy and calibration error.
- [ ] P12.02 Add hypothesis ranking quality benchmarks.
- [ ] P12.03 Add causal forecast backtest benchmarks.
- [ ] P12.04 Add constraint violation detection benchmarks.

### Online Learning
- [ ] P12.05 Ingest user correction events into learning pipeline.
- [ ] P12.06 Retrain/recalibrate confidence models on scheduled cadence.
- [ ] P12.07 Add shadow deployment for model rollouts.

### Attention Engine
- [ ] P12.08 Implement value-of-information scoring for ingestion prioritization.
- [ ] P12.09 Implement dynamic compute allocation by VOI and SLA.
- [ ] P12.10 Add anti-starvation guarantees for low-frequency high-risk signals.

### Acceptance
- [ ] P12.A1 Model regression gates block low-quality rollouts.
- [ ] P12.A2 VOI scheduling improves useful-impact-per-compute metrics.

---

## Phase 13 - Security, Governance, and Trust Hardening

### Security
- [ ] P13.01 Enforce tenant RLS and scope checks for all new cognitive endpoints.
- [ ] P13.02 Enforce role-based redaction for sensitive evidence paths.
- [ ] P13.03 Add encrypted-at-rest handling for sensitive belief/constraint payloads.

### Governance
- [ ] P13.04 Add immutable audit chain for belief updates and intervention decisions.
- [ ] P13.05 Add explainability payload standards for all high-impact outputs.
- [ ] P13.06 Add governance export bundle for enterprise audits.

### Trust UI/Signals
- [ ] P13.07 Add uncertainty and calibration indicators to API and UI payloads.
- [ ] P13.08 Add contradiction confidence and source reliability indicators.

### Acceptance
- [ ] P13.A1 Security review passes with no critical findings.
- [ ] P13.A2 Audit replay can reconstruct end-to-end reasoning path.

---

## Phase 14 - Performance, Scale, and Reliability

### Performance
- [ ] P14.01 Define p95 SLOs for belief update, impact compute, and tape publish.
- [ ] P14.02 Optimize graph traversals for exposure and causal propagation.
- [ ] P14.03 Add cache and pre-materialization for hot twin queries.

### Reliability
- [ ] P14.04 Add chaos tests for Kafka partition lag and worker failures.
- [ ] P14.05 Add recovery runbooks for DLQ backlog and replay storms.
- [ ] P14.06 Add graceful degradation modes for provider outages.

### Cost
- [ ] P14.07 Add cost attribution by pack, worker, and tenant.
- [ ] P14.08 Add adaptive compute throttles tied to VOI and SLA.

### Acceptance
- [ ] P14.A1 End-to-end throughput target met at projected scale.
- [ ] P14.A2 Reliability and cost envelope stable over soak tests.

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
- [ ] S45.04 Ship world twin snapshot job v1 and twin diff endpoint.
- [ ] S45.05 Ship constraint sentinel prototype for one legal domain.
- [ ] S45.06 Ship causal edge prototype and impact bridge generator v1.
- [ ] S45.07 Ship Ask v2 truth-first payload format.
- [ ] S45.08 Ship evaluation dashboard (calibration, contradiction precision, impact precision).
- [ ] S45.09 Ship audit replay trail for one end-to-end intervention path.
