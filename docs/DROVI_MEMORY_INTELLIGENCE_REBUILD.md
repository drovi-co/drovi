# Drovi Memory & Intelligence Rebuild (From Scratch)

## Purpose
Design a next‑generation memory and intelligence system for Drovi that is fast, reliable, and “wow” for companies and AI agents. This document ignores the current implementation and rebuilds from the business vision: persistent memory for work that transforms unstructured activity into living intelligence objects (decisions, commitments, tasks, risks, relationships), evidence‑backed, identity‑resolved, bi‑temporal, and continuously updated.

---

## North‑Star Requirements
**Outcomes the system must deliver**
- Trustworthy memory: always show why something is believed, with evidence and provenance.
- Fast: sub‑second responses for common queries, <2 minutes for new session ingestion.
- Accurate: decisions/commitments/tasks must feel correct and specific.
- Evolvable: memory updates and contradictions must be handled over time.
- Agent‑ready: APIs designed for tool use + MCP, with guarantees on freshness.

**Non‑negotiables**
- Bi‑temporal history (what was known vs what is true now).
- Evidence chains for every extracted object.
- Identity first: people/companies are primary entities, tools are contexts.
- Observability: quality, latency, and drift are measurable.

---

## Core Insight: Separate “Signal Capture” from “Memory Truth”
Most systems fail because they try to extract final truth in one pass. Instead:

1. Signal Capture Layer (fast, lossless)  
   Ingest everything, normalize into a unified conversation/event model, attach minimal metadata.

2. Memory Truth Layer (slow, careful, iterative)  
   Build living objects from captured signals, continuously revising as new evidence arrives.

This gives both speed and reliability.

---

## System Architecture (From Scratch)

### 1) Ingestion Fabric
Goal: zero‑loss, real‑time ingestion across tools.

**Sources**
- Email, chat, meetings, docs, CRM, calendars, phone calls, recordings
- Live streams: meeting/voice with chunked transcription

**Mechanisms**
- Webhooks + polling + streaming gateways
- Chunked ingestion for live sessions
- Metadata capture: timestamps, source app, channel, participants, thread context

**Outputs**
- Unified Event Model (UEM) records (immutable)
  - `event_id`, `source`, `participants`, `content`, `timestamps`, `thread_id`, `attachments`

**Key design**
- All raw events are stored immutably (WORM mode optional).
- Every event gets a canonical session/thread mapping.

---

### 2) Unified Conversation Model
Goal: normalize “what happened” across channels into a consistent structure.

**Normalize into**
- Conversation thread (email chain, meeting, Slack channel, CRM thread)
- Participant roles (speaker, attendee, author)
- Segment timeline (utterance blocks with timestamps)

**Outputs**
- `conversation_id` with timeline of segments
- Each segment links back to immutable evidence

---

### 3) Identity Resolution (Person‑First)
Goal: unify people and companies across tools.

**Strategy**
- Deterministic keys (email, phone, calendar identity)
- Probabilistic matching (name + org + role + context)
- Human‑verified merges

**Outputs**
- `person_id` and `org_id` are primary keys for all memory objects

---

### 4) Signal Extraction (Fast Pass)
Goal: quickly extract candidate facts, without claiming final truth.

**Method**
- Lightweight extraction models per object type
- Surface candidate objects with low/medium confidence

**Candidates produced**
- `decision_candidate`, `commitment_candidate`, `task_candidate`, `risk_candidate`, `relationship_signal`
- Each candidate links to evidence segments

**Guarantee**
- Fast, parallel, non‑blocking; no long chains of LLM calls

---

### 5) Memory Synthesis (Truth Engine)
Goal: consolidate candidates into real, evolving objects.

**Key mechanics**
- Evidence‑weighted merging: cluster candidates by entity + topic + time
- Versioning: every update creates a new state version with timestamps
- Conflict & supersession: detect contradictions and mark outdated versions

**Outputs**
- `Decision`, `Commitment`, `Task`, `Risk`, `Relationship` objects
- Each object has:
  - Status, owner(s), due date (if any)
  - Evidence chain
  - Version history
  - Confidence score

---

### 6) Bi‑Temporal Memory Store
Goal: track what was believed when.

**Model**
- `valid_time`: when it was true in the real world
- `system_time`: when Drovi recorded it

**Benefits**
- Explains why a past action was taken
- Supports rollback and audits

---

### 7) Graph Memory + Query
Goal: an intelligence graph that is queryable by humans and agents.

**Graph schema**
- `Person`, `Org`, `Conversation`, `Decision`, `Commitment`, `Task`, `Risk`, `Relationship`
- `EVIDENCE_OF`, `SUPERCEDES`, `OWNS`, `INVOLVES`, `INFLUENCES`

**Indexes**
- Full‑text on content and summaries
- Vector embeddings for semantic retrieval
- Time‑slice query support for temporal queries

---

### 8) Exposure Layer
Goal: make memory accessible and trustworthy.

**APIs**
- Query API: “What was decided?”, “What’s open?”
- Agent API: tools for MCP usage
- Streaming updates: push object changes in real time

**UI**
- Exploration and verification
- Show evidence for every object
- Allow human corrections (feedback loop)

---

## Why This Will Be “Wow”
**For teams**
- “We have a memory, not a tool.”
- The system catches contradictions and missed commitments.

**For agents**
- Agents don’t repeat work.
- Agents know current truth and have evidence trails.

---

## Key Technical Innovations
1. Two‑stage architecture: fast signal capture + slow truth synthesis.
2. Evidence‑first memory objects: always show why.
3. Bi‑temporal graph: enables state over time.
4. Identity‑first design: people and organizations are primary.

---

## Product/Business Alignment
This memory layer is the core asset.
- The UI is a surface.
- The graph + APIs are the business.
- Drovi becomes the memory backbone for agents and tools.

---

## Execution Priorities (Order)
1. Build the ingestion fabric and unified conversation model.
2. Deliver identity resolution as a core service.
3. Deploy signal extraction for candidate generation.
4. Build the memory truth engine with versioning and evidence.
5. Launch the graph and agent APIs.
6. Iterate with feedback loops and quality evals.

---

## What Makes This Defensible
- The graph is a living intelligence layer, not a storage layer.
- Bi‑temporal + evidence + identity resolution yields trust.
- Long‑lived memory becomes a moat.

---

## Final Summary
Drovi should not try to extract truth in one pass.  
Instead: capture all signals fast, then build living truth slowly, with evidence and versioning.  
This turns Drovi into the memory backbone for humans and AI agents—fast, trustworthy, and indispensable.

---

## Concrete Implementation Plan

### Phase 0: Groundwork (2 weeks)
**Goal:** create the foundation for speed, reliability, and measurement.

**Deliverables**
- Canonical Unified Event Model (UEM) schema + storage tables
- Evidence storage policy (immutable by default)
- Observability baseline (latency, quality, throughput dashboards)
- Quality dataset v1 (50-100 annotated conversations)

**Success metrics**
- 100% of ingested items stored as UEM
- Ingestion throughput >= 50 events/sec on dev
- End-to-end observability dashboards live

---

### Phase 1: Ingestion Fabric + Conversation Model (4 weeks)
**Goal:** real-time ingestion for all sources with consistent normalization.

**Deliverables**
- Source connectors upgraded to emit UEM
- Conversation threading (email chains, meeting sessions, chat threads)
- Streaming ingestion for live meetings and calls (chunked + diarized)
- Unified conversation timeline and participants model

**Success metrics**
- 95%+ of events mapped into conversation threads
- Live session transcript delay < 3s
- No lost events in 24h soak test

---

### Phase 2: Identity Resolution Service (4 weeks)
**Goal:** person-first entity resolution across tools.

**Deliverables**
- Deterministic identity linking (email, phone, calendar)
- Probabilistic matching (name/org/role/context)
- Human merge UI + override system
- Identity audit trail

**Success metrics**
- 90%+ identity resolution on pilot dataset
- False merge rate < 1%

---

### Phase 3: Fast Signal Extraction (4 weeks)
**Goal:** fast candidate generation without blocking ingestion.

**Deliverables**
- Lightweight extraction models per object type
- Candidate object store with evidence links
- Parallel extraction pipeline (queue + worker pool)

**Success metrics**
- Candidate generation < 30s per conversation
- 80%+ recall on gold dataset

---

### Phase 4: Memory Truth Engine (6 weeks)
**Goal:** turn candidates into living objects with versioning.

**Deliverables**
- Evidence-weighted clustering engine
- Versioned memory objects with bi-temporal fields
- Conflict detection and supersession rules
- Object confidence scoring

**Success metrics**
- 85%+ precision on decisions/commitments/tasks
- Clear supersession on contradictory evidence
- Median query latency < 300ms

---

### Phase 5: Graph + Query + Agent APIs (4 weeks)
**Goal:** production-ready memory graph and interfaces.

**Deliverables**
- Full graph schema + indexes (fulltext + vector)
- Query API and agent tools
- Streaming updates for object changes
- Access control and tenant isolation

**Success metrics**
- 99th percentile query latency < 1s
- Tenant data isolation verified

---

### Phase 6: Feedback Loops + Scaling (Ongoing)
**Goal:** close the loop and make memory improve continuously.

**Deliverables**
- Human feedback UI for correction
- Automated retraining pipeline
- Drift monitoring and active learning
- Load testing at scale

**Success metrics**
- 30%+ quality improvement over 2 quarters
- Latency stable under 10x load

---

## Technical Specs Checklist

**Infrastructure**
- Kafka for ingestion + extraction queues
- Object storage for raw evidence (MinIO/S3)
- Graph DB + Postgres for metadata
- Streaming gateway for live calls/meetings
- Observability stack (metrics, tracing, logs)

**Data model**
- Immutable event store (UEM)
- Versioned memory objects with bi-temporal history
- Evidence chains stored as first-class links

**Quality**
- Gold dataset with weekly regression
- Model evaluation harness (precision, recall, latency)
- Human review UI for low-confidence objects

---

## Staffing Plan (Initial 6 months)
- 1x Senior Infra Eng (streaming + ingestion)
- 1x Senior Data/ML Eng (extraction + evals)
- 1x Backend Eng (graph + APIs)
- 1x Product Eng (feedback UI + workflow tools)

---

## Risks + Mitigations
**Risk:** noisy data floods the system  
**Mitigation:** strong signal filtering + confidence gating

**Risk:** identity merges wrong  
**Mitigation:** deterministic keys + human overrides

**Risk:** latency too high  
**Mitigation:** separate fast candidate extraction from truth synthesis

**Risk:** quality regression  
**Mitigation:** gold dataset + automated eval gating

---

## Timeline Snapshot (24 weeks)
- Weeks 1-2: Phase 0
- Weeks 3-6: Phase 1
- Weeks 7-10: Phase 2
- Weeks 11-14: Phase 3
- Weeks 15-20: Phase 4
- Weeks 21-24: Phase 5

Phase 6 runs continuously after week 24.
