# DROVI World Brain Plan (Deep Research Edition)

**Date**: 2026-02-21
**Repository**: `/Users/jeremyscatigna/project-memory`
**Execution Home**: `/Users/jeremyscatigna/project-memory/drovi-intelligence`
**Objective**: Build a category-defining institutional cognition platform that maintains a live world model and continuously computes reality impact on each organization.

---

## 0) One-Line Product Contract

Drovi World Brain is a real-time institutional cognition system that transforms global + internal signals into evidence-backed beliefs, simulations, and actions, with full temporal accountability.

---

## 1) Category Thesis: From Memory Product to Cognitive Infrastructure

Most systems do one of these:
- store records
- summarize content
- surface alerts

Drovi World Brain does something fundamentally different:
- models reality as a changing belief system
- quantifies uncertainty
- learns causal structure
- predicts consequence
- recommends governed intervention

This is not "more tasks/claims/decisions".

This is a new category:
- **Institutional Cognition Infrastructure (ICI)**

### 1.1 Non-Negotiable Design Doctrine

1. **Reality over narratives**: output is state transition, not text summary.
2. **Belief over extraction**: every claim has epistemic status.
3. **Causality over correlation**: impact requires causal justification.
4. **Uncertainty over false certainty**: confidence is explicit and calibrated.
5. **Intervention over observation**: system must map insight to next action.
6. **Temporal accountability**: system must answer what was believed when.

---

## 2) The New Cognitive Primitives

Current objects (decision, commitment, risk, etc.) remain, but become subsets of a deeper schema.

### 2.1 Core Object Families

1. **Observation**
- atomic source-grounded facts from internal/external inputs

2. **Belief**
- computed proposition with epistemic state + probability + evidence set

3. **Hypothesis**
- alternative explanation for observations (competing interpretations)

4. **Causal Model Fragment**
- local cause-effect structure linking drivers to outcomes

5. **Constraint**
- legal/policy/contractual/operational bounds

6. **Intervention Plan**
- recommended action sequence with expected deltas and confidence

7. **Outcome Record**
- post-action reality change used for online learning

### 2.2 Epistemic State Model

Each belief gets one state:
- `asserted`
- `corroborated`
- `contested`
- `degraded`
- `retracted`
- `unknown`

This prevents narrative drift and hallucinated confidence.

### 2.3 Time Model

Every object has:
- `valid_from` / `valid_to` (world truth window)
- `believed_from` / `believed_to` (Drovi belief window)
- `observed_at` (evidence observation timestamp)

---

## 3) New Memory Architecture (Beyond Standard KG + Vector)

Drovi Brain uses multi-memory cognition, not one memory store.

## 3.1 Memory Layers

1. **Sensory Memory** (milliseconds to minutes)
- raw streaming event buffers
- high-throughput Kafka topics and ingestion queues

2. **Episodic Memory** (event sequences)
- timelines of what happened to entities/processes
- incident/matter/deal replay

3. **Semantic Memory** (concept graph)
- entities, relationships, taxonomy, ontologies

4. **Normative Memory** (rules and obligations)
- regulations, policy, contracts, compliance duties
- machine-checkable obligations and violation tests

5. **Causal Memory** (learned mechanism graph)
- directional relationships with strength, lag, and confidence

6. **Procedural Memory** (what works)
- playbooks, response policies, action templates, rollback plans

7. **Strategic Memory** (long-horizon intent)
- theses, objectives, risk appetite, board-level assumptions

8. **Adversarial Memory** (deception/threat patterns)
- misinformation signatures, manipulative source clusters, anomaly markers

9. **Meta-Memory** (system self-awareness)
- what the model is uncertain about, where it needs new evidence, where bias is likely

### 3.2 Why This Is Game-Changing

Most AI systems conflate memory into embeddings + context windows.

Drovi separates memory by cognition role and retrieval objective, enabling:
- lower hallucination
- stronger causality
- explainable belief updates
- actionable interventions

---

## 4) Live World View: The Institutional World Twin

Each tenant gets a continuously updated **Institutional World Twin (IWT)**.

### 4.1 Twin Composition

- Internal state graph: people, teams, commitments, assets, dependencies
- External state graph: law, market, science, geopolitics, supply chain, counterparties
- Exposure topology: where external changes can propagate into internal operations
- Constraint field: obligations, forbidden actions, hard deadlines
- Objective field: strategic goals and utility priorities

### 4.2 Twin Update Cycle

1. ingest new observations
2. resolve identities
3. update belief graph
4. recompute causal pressure
5. simulate near-term futures
6. issue intervention candidates
7. learn from realized outcomes

### 4.3 New “Live World” Surfaces

1. **World Pressure Map**
- where external pressure is rising against internal exposure

2. **Belief Drift Radar**
- where current assumptions are decaying against new evidence

3. **Counterfactual Lab**
- compare action paths before execution

4. **Obligation Sentinel**
- detect normative conflicts before breach or liability

---

## 5) Cognitive Engine Stack (Built in drovi-intelligence)

All core services live in `drovi-intelligence`, using existing Kafka/workers/graphdb/Postgres as substrate.

## 5.1 Engine Modules

1. **Reality Compiler** (`src/world_model/compiler/*`)
- converts raw data into canonical observations + typed events

2. **Epistemic Engine** (`src/epistemics/*`)
- belief state transitions and confidence calibration

3. **Hypothesis Engine** (`src/hypothesis/*`)
- generates competing explanations and ranks by evidence fit

4. **Causal Engine** (`src/causal/*`)
- learns/updates causal edges and lagged impact weights

5. **Constraint Engine** (`src/normative/*`)
- codifies obligations and violation logic from law/policy/contracts

6. **Simulation Engine v2** (`src/simulation/*`)
- scenario and intervention outcome simulation

7. **Attention Engine** (`src/attention/*`)
- value-of-information scheduler to decide what to ingest/process first

8. **Intervention Engine** (`src/intervention/*`)
- proposes governed actions with rollback and risk class

9. **Learning Loop** (`src/learning/*`)
- uses outcome feedback to recalibrate models and policies

---

## 6) Event-Native Infrastructure Design (Kafka + Workers + GraphDB + Postgres)

## 6.1 Kafka as Cognitive Nervous System

Topic families:
- `observation.raw.*`
- `observation.normalized.*`
- `belief.update.*`
- `hypothesis.generated.*`
- `causal.edge.update.*`
- `constraint.violation.candidate.*`
- `impact.edge.computed.*`
- `simulation.requested.*`
- `simulation.completed.*`
- `intervention.proposed.*`
- `intervention.executed.*`
- `outcome.realized.*`

## 6.2 Worker Topology (drovi-intelligence)

Use existing `src/jobs/worker.py` pattern and expand specialized workers:
- observation normalizer worker
- entity resolver worker
- epistemic updater worker
- causal updater worker
- constraint validator worker
- impact scorer worker
- simulation worker
- alert/materialization worker

## 6.3 Storage Split

1. **Postgres**
- temporal ledger, belief tables, constraints, interventions, outcomes, audits

2. **GraphDB (FalkorDB)**
- semantic + causal + exposure graph traversal

3. **Object/Evidence store**
- immutable source artifacts with custody chain

4. **Redis**
- low-latency state cache and short-lived simulation artifacts

## 6.4 Optional Polyglot Co-Processors (Still Under drovi-intelligence)

If needed for performance, add subservices under `drovi-intelligence/services/`:
- Rust reasoner for low-latency causal graph propagation
- Rust stream processor for high-cardinality scoring

These remain internal co-processors driven by Python orchestration + Kafka contracts.

---

## 7) New Data Model (Research-Grade)

## 7.1 Core Tables/Collections

- `observation`
- `observation_evidence_link`
- `belief`
- `belief_revision`
- `hypothesis`
- `hypothesis_score`
- `causal_edge`
- `causal_revision`
- `constraint`
- `constraint_violation_candidate`
- `impact_edge`
- `simulation_run`
- `simulation_outcome`
- `intervention_plan`
- `intervention_execution`
- `realized_outcome`
- `uncertainty_state`
- `source_reliability_profile`
- `world_twin_snapshot`

## 7.2 Key Schema Concepts

Belief:
- proposition
- epistemic_state
- probability
- calibration_bucket
- supporting_evidence_count
- contradiction_count
- temporal fields

CausalEdge:
- source_node
- target_node
- effect_sign
- lag_distribution
- strength
- confidence
- mechanism_note

Constraint:
- origin_type (`law|policy|contract|strategy`)
- machine_rule
- jurisdiction/scope
- severity_on_breach

InterventionPlan:
- target_belief_or_risk
- action graph
- expected utility delta
- downside risk estimate
- rollback strategy

---

## 8) AI/ML Architecture (Beyond Prompt Pipelines)

## 8.1 Multi-Model Cognitive Loop

1. extractor models (source-specific)
2. verifier models (evidence consistency)
3. contradiction models
4. entity link models
5. causal estimation models
6. simulator policy models
7. ranking/prioritization models

## 8.2 Online Learning

Update loops from:
- user corrections
- intervention outcomes
- contradiction resolutions
- false-positive/false-negative incident reviews

## 8.3 Value-of-Information (VOI) Attention

System decides additional ingestion/computation based on expected uncertainty reduction and business utility.

This makes the brain selective and strategic, not a passive aggregator.

---

## 9) Product Surfaces (Causality-First)

## 9.1 The Ledger (Truth Court)

- belief trails
- evidence bundles
- contradiction timeline
- "what did we know when" queries

## 9.2 The Tape (State Delta Film)

- only state changes, no raw headlines
- bridge tiles: external change -> internal consequence
- confidence + uncertainty + action recommendation in each tile

## 9.3 The Counterfactual Lab

- compare intervention A/B/C with expected utility and downside
- show assumption sensitivity

## 9.4 The Obligation Sentinel

- running violation monitor for law/policy/contract constraints
- pre-breach and post-breach pathways

## 9.5 Ask v2 (Truth then Reasoning)

response ordering:
1. verified belief payload
2. uncertainty + alternatives
3. narrative explanation
4. recommended intervention

---

## 10) Research Frontiers To Own

1. **Belief Consistency at Scale**
- ensure global coherence while processing high-throughput updates

2. **Causal + Symbolic Hybrid Reasoning**
- merge statistical causal learning with explicit rule systems

3. **Normative Intelligence**
- executable obligation graphs from legal/regulatory text

4. **Institutional Memory Compression**
- preserve high-value state with lossy-safe compression over long horizons

5. **Adversarial Signal Immunity**
- detect and downrank coordinated misinformation affecting decisions

---

## 11) Safety, Governance, and Civilizational Risk

Given category scope, Drovi must enforce:
- explicit uncertainty reporting
- provenance traceability for every high-impact suggestion
- policy gating for all side-effecting actions
- tenant and role-based isolation
- model behavior auditing with replay
- strict "no evidence, no high-stakes persist"

---

## 12) Phased Build Strategy

## Phase A - Cognitive Core Foundation

Deliver:
- observation/belief/hypothesis schemas
- epistemic transitions
- temporal ledger queries
- evidence-first persistence

## Phase B - Live World Twin v1

Deliver:
- external world packs
- exposure topology
- impact edge generation
- pressure map surface

## Phase C - Causal + Constraint Intelligence

Deliver:
- causal edge learning
- obligation sentinel
- contradiction-at-risk scoring

## Phase D - Counterfactual Operations

Deliver:
- simulation engine v2
- intervention planner
- expected utility comparison

## Phase E - Autonomous Learning System

Deliver:
- outcome feedback ingestion
- model recalibration automation
- VOI-driven attention loops

---

## 13) 12-Month North-Star Outcomes

1. 10x reduction in high-severity unseen external impact events.
2. 5x faster root-cause reconstruction for executive incidents.
3. >90% evidence coverage on high-stakes beliefs.
4. Significant decrease in contradiction recurrence after intervention.
5. Demonstrable pilot ROI via prevented liability/loss/opportunity decay.

---

## 14) Final Definition

Drovi World Brain is not a better assistant.

It is a living institutional cognition substrate that:
- senses reality
- encodes beliefs
- learns causality
- tracks obligations
- simulates futures
- governs interventions
- and continuously updates what is true.

That is the category-defining system.
