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

## 6.5 External Ingestion API Universe (Production Catalog)

Do not treat this as one undifferentiated feed. Build a tiered ingestion catalog with explicit ownership, licensing, and SLOs.

Operational source matrix:
- `/Users/jeremyscatigna/project-memory/DROVI_WORLD_BRAIN_INGESTION_MATRIX.md`

### Tier 0 (Authoritative, Must-Have)

1. Regulatory and legal
- Federal Register API
- Regulations.gov API
- Congress API
- govinfo API
- SEC EDGAR submissions/XBRL APIs
- CourtListener API (opinions/dockets where available)
- OFAC sanctions datasets

2. Macro and public economic
- FRED API
- BLS Public Data API
- BEA Data API
- U.S. Treasury Fiscal Data API

3. Research and medical
- PubMed E-utilities
- ClinicalTrials.gov API v2
- openFDA APIs
- Crossref REST API
- OpenAlex API
- Semantic Scholar API

4. Cyber and safety
- NVD CVE API
- CISA KEV catalog

### Tier 1 (High-Value Commercial Feeds)

1. Market microstructure and corporate intelligence
- exchange direct feeds or premium aggregators
- earnings transcript providers
- premium filings enrichers

2. Legal/compliance premium feeds
- commercial legal databases and enforcement trackers

3. Newswire-grade sources
- licensed enterprise feeds (global and sector-specific)
- World News API (`https://worldnewsapi.com/docs/`) as a rapid-start global news provider

### Tier 2 (Complementary Open/OSINT)

- GDELT
- RSS/Atom ecosystems
- sector-specific portals and watchdog publications
- public procurement datasets (for supply and counterparty signals)

### Per-Source Metadata (Mandatory)

Every source adapter must declare:
- licensing class and allowed use
- expected latency and update frequency
- reliability baseline and confidence priors
- legal constraints (ToS, redistribution restrictions, retention)
- backfill policy and replay method
- credential sourcing strategy (env var or secret manager path)

### World News API Integration Contract (Detailed)

Provider:
- `https://worldnewsapi.com/docs/`

Auth and base URL:
- base: `https://api.worldnewsapi.com`
- auth modes supported by provider:
  - query param `api-key=...`
  - header `x-api-key: ...`
- Drovi standard: use header auth with `WORLD_NEWS_API_KEY` from secret manager/env.

Primary endpoints and roles in World Brain:
1. `GET /search-news`
- targeted entity/event search for exposure-driven discovery
- key filters: `text`, `language`, `source-country`, `news-sources`, `categories`, `entities`,
  `earliest-publish-date`, `latest-publish-date`, `min-sentiment`, `max-sentiment`, `offset`, `number`

2. `GET /top-news`
- high-signal rolling headline intake by country/language/day
- use for pulse and anomaly detection, not as sole truth source

3. `GET /front-pages`
- source front-page clustering and priority story detection

4. `GET /retrieve-news`
- hydration endpoint for article IDs returned by search/top/front-pages

5. `GET /extract-news`
- URL-to-article extraction when article data is incomplete or external URL is primary signal

6. `GET /extract-news-links`
- source URL expansion and link discovery for crawl seeding

7. `GET /search-news-sources`
- source directory lookup and source canonicalization

8. `POST /suggest-news-source`
- source coverage expansion workflow for missing publishers

9. `GET /feed.rss`
- RSS generation for non-feed websites to unify downstream ingestion

10. `GET /geo-coordinates`
- location normalization for geospatial filters and entity linkage

Rate-limit and quota handling:
- enforce provider rate and concurrency limits in connector scheduler
- monitor quota headers (`X-API-Quota-Request`, `X-API-Quota-Used`, `X-API-Quota-Left`)
- treat `429` as retry/backoff, `402` as quota/billing escalation signal
- implement adaptive polling to stay within budget by tenant priority and VOI score
- initialize scheduler defaults from provider plan limits (documented examples):
  - free: `60 req/min`, `1` concurrent
  - reporter: `2 req/s`, `5` concurrent
  - journalist: `10 req/s`, `10` concurrent
  - editor: `20 req/s`, `10` concurrent

Ingestion strategy in Drovi:
- run `top-news` and `front-pages` on short rolling intervals for broad awareness
- run `search-news` as exposure-conditioned queries from entity graph and active hypotheses
- run `retrieve-news` for full hydration before belief promotion
- run `extract-news`/`extract-news-links` for source expansion and crawl handoff

Normalization and quality:
- canonical keys: provider article ID + URL + publish timestamp + source
- cross-endpoint dedupe before observation persistence
- confidence priors adjusted by source history and corroboration count
- map provider output to `Observation -> Belief` pipeline with full evidence trace

## 6.6 Scraping and Crawl Fabric (When APIs Are Missing)

Yes, a production scraping stack is required. Many critical domains are not API-first.

Build a **World Crawl Fabric** in `drovi-intelligence`:

1. Frontier and scheduling
- distributed URL frontier with domain-level budgets
- freshness-aware recrawl policy
- priority based on exposure and VOI score

2. Fetch execution
- static fetch workers for HTML/JSON/XML/PDF
- browser-render workers (Playwright) for JS-heavy pages
- proxy and anti-block strategy for reliability where legally permitted

3. Parsing and extraction
- boilerplate removal
- structured parser templates by domain/source type
- OCR/table extraction for scanned PDFs and image-heavy docs
- document fingerprinting and canonicalization

4. Compliance and governance
- robots/ToS policy engine
- source allowlist/denylist and legal review workflow
- crawl audit trail and takedown handling

5. Change intelligence
- semantic diffing between snapshots
- delta extraction and event emission only for meaningful changes

6. Output contracts
- `observation.raw.web.*` and `observation.normalized.web.*` topics
- immutable evidence artifact and parse trace per crawl

## 6.7 Data Lakehouse and Storage Architecture (Production Requirement)

For world-scale ingest, Postgres + graphdb alone is insufficient. You need a lakehouse.

Adopt a three-plane architecture:

1. Hot plane (operational)
- Kafka, Postgres, FalkorDB, Redis
- powers real-time cognition and user APIs

2. Warm plane (analytical serving)
- denormalized feature/mart tables for fast model and dashboard access

3. Cold plane (lakehouse)
- object storage + table format (Iceberg/Delta/Hudi)
- raw and normalized event history
- simulation/research datasets and model training corpora

Recommended lakehouse layout:
- Bronze: immutable raw source captures
- Silver: normalized observations/entities/evidence links
- Gold: domain features, aggregated signals, and training-ready tables

Critical lakehouse capabilities:
- schema evolution with versioning
- partitioning by source/date/tenant/domain
- dedupe and late-arrival handling
- data quality expectations and quarantine flows
- replay and backfill at scale

## 6.8 New Platform Components Needed For Scale

To be production-ready at massive ingest volume, add:

1. Kafka platform hardening
- multi-broker cluster sizing and partition strategy
- schema registry and contract enforcement
- tiered storage and retention classes

2. Stream processing
- dedicated stream compute (Flink/Spark Structured Streaming or equivalent)
- exactly-once or idempotent semantics per sink

3. Lakehouse compute
- batch and ad-hoc query engines for backfills, model prep, and audits

4. Crawl fleet control plane
- orchestrator, autoscaling workers, backpressure control, failure budgets

5. Data quality and observability
- freshness, completeness, and drift monitors
- source-level SLA dashboards

6. Cost governance
- per-source ingest cost attribution
- per-tenant storage and compute accounting

7. Disaster recovery
- cross-region artifact replication
- event-log checkpoint and replay recovery drills

## 6.9 Capacity Planning Baseline

Define explicit capacity tiers early:

- event ingest per second (steady + burst)
- documents/pages/PDFs per day
- evidence storage growth per month
- graph edge growth and traversal latency
- model inference budget by pipeline stage

Then bind each tier to:
- autoscaling policies
- retention lifecycle
- latency SLOs
- cost ceilings

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

## 8.4 Model Families and Deep Algorithms

Use specialized models per cognition function instead of one generic model.

1. Neural models:
- temporal transformers/state-space models for event sequence modeling and drift forecasting
- graph neural networks for exposure propagation and link prediction
- dual-encoder entity linking models for candidate generation
- cross-encoder NLI/verifier models for contradiction and evidence consistency

2. Probabilistic and causal models:
- Bayesian belief updates for confidence revision under new evidence
- conformal uncertainty bands for calibrated risk bounds
- causal discovery/structure learning with domain constraints
- counterfactual estimators for intervention impact estimation

3. Ranking and retrieval models:
- multi-stage rankers (candidate retrieval + cross-encoder rerank)
- source reliability and novelty scoring models
- de-duplication/similarity models for event collapse

4. Anomaly and regime models:
- change-point and anomaly detection over market/legal/operational streams
- regime state classifiers for macro and sector condition shifts

## 8.5 ML Pipelines and ModelOps Architecture

World Brain requires full MLOps, not ad-hoc prompts.

1. Data pipelines:
- lakehouse bronze/silver/gold pipelines feeding model datasets
- automated label pipelines from corrections, contradiction resolutions, and outcomes

2. Feature pipelines:
- offline feature generation for training
- online feature serving for low-latency inference
- point-in-time correct feature retrieval for leakage-safe training

3. Training pipelines:
- scheduled retraining and event-triggered retraining
- hyperparameter search for high-impact model families
- reproducible training artifacts with dataset snapshots

4. Model registry and promotion:
- versioned model registry with lineage (data, code, metrics)
- stage promotion (`dev -> shadow -> canary -> prod`) with approval gates

5. Evaluation gates:
- offline benchmark gates by task
- online shadow comparison against incumbent models
- rollback on calibration or precision regressions

6. Serving and inference:
- unified inference gateway for model + LLM calls
- batch inference jobs for backfills and large recomputes
- online inference for event-time cognition updates

7. Monitoring:
- feature drift, concept drift, and calibration drift monitors
- latency, error, and cost telemetry per model
- automated retraining triggers tied to monitored degradation

## 8.6 Multi-LLM Mesh (Specialized Roles)

Use multiple LLM families with a policy-aware router:

1. Extractor LLMs:
- low-latency structured extraction for high-volume inputs

2. Verifier LLMs:
- high-accuracy claim checking, contradiction validation, and evidence adjudication

3. Planner LLMs:
- intervention proposal and explanation synthesis with policy constraints

4. Router policy:
- route by risk class, latency budget, token budget, and required confidence
- enforce structured JSON outputs and schema validation
- require explicit fallback chains and failure behavior

## 8.7 Graph Platform Strategy (Current + Future)

Current operational graph:
- FalkorDB remains primary hot-path graph for live cognition workloads

Required abstraction:
- add graph access abstraction so query/compute logic is backend-agnostic
- keep graph semantics portable across potential future engines

When to evaluate additional graph backends:
- sustained traversal latency misses under production load
- storage/cardinality limits impacting impact-propagation quality
- requirement for graph algorithms not performant in current engine

Candidate augmentation path:
- retain FalkorDB for hot operations
- add specialized graph analytics backend only when objective triggers are met
- avoid premature graph migration without benchmark evidence

## 8.8 Compute and Hardware Strategy

For deep models and high-throughput inference, add:
- GPU inference pool for heavy verifier/planner/cross-encoder models
- CPU-optimized pool for lightweight extraction/ranking workloads
- workload queueing and priority classes by risk and SLA
- autoscaling policies tied to backlog and latency objectives

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

## Phase A0 - Acquisition and Data Platform Foundation

Deliver:
- tiered source catalog (API + scrape + licensed feeds)
- crawl fabric v1 with compliance guardrails
- lakehouse bronze/silver/gold pipelines
- Kafka schema contracts and replay guarantees

## Phase A1 - Cognitive Core Foundation

Deliver:
- observation/belief/hypothesis schemas
- epistemic transitions
- temporal ledger queries
- evidence-first persistence

## Phase A2 - ML Platform and ModelOps Foundation

Deliver:
- feature and label pipelines on lakehouse
- model registry and promotion workflow
- unified inference gateway and model router
- shadow/canary deployment gates with rollback automation

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
