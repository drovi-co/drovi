**Purpose**
This document synthesizes `APP.md`, the drovi‑intelligence codebase, and all other project docs. It provides a deep analysis of the intelligence layer and a transformative, production‑grade roadmap to make Drovi the indispensable memory and decision infrastructure for enterprises.

**Core North‑Star (From Docs + Code)**
Drovi is not an email app. It is an evidence‑anchored, bi‑temporal, identity‑first memory system that transforms unstructured activity into living intelligence objects. The system must be fast, provable, and continuously learning.

**Non‑Negotiables**
- Evidence chains for every intelligence object.
- Unified Event Model (UEM) as the immutable record of everything ingested.
- Bi‑temporal history: what was true vs what was believed at any time.
- Identity resolution as a first‑class service.
- Observability and quality metrics as a hard gate, not a nice‑to‑have.

**What the Docs Add Beyond the Code**
- **Signal Capture vs Memory Truth**: The platform must split fast, lossless capture from slower, verified synthesis.
- **UEM + Candidates + Bi‑Temporal**: The migration plan explicitly mandates unified_event, signal_candidate, and bitemporal UIOs.
- **Evidence Store**: S3/MinIO with object lock, retention policies, and auditable provenance.
- **Live Ingestion**: Low‑latency meeting/call pipelines and streaming endpoints are explicitly part of the product.
- **Risk & Policy**: Pre‑send contradiction checks, fraud detection, and policy enforcement are essential to enterprise trust.
- **Product UX**: Evidence must be visible in one click. Confidence must be explicit. Ask‑experience must feel magical.
- **SLOs**: Concrete latency and freshness targets are already defined in ops docs.

**Architecture Snapshot (As‑Is)**
- Ingestion: Connectors (Gmail, Slack, Teams, WhatsApp, Notion, Google Docs, Calendar, CRM, DBs) → Scheduler/backfill → Normalize → Pipeline.
- Pipeline: LangGraph (source triage → parse → classify → extract → verify → dedup → persist → evolve memory → enrich contacts).
- Storage: PostgreSQL (UIO + evidence + timeline), FalkorDB (graph + vector), Graphiti (temporal memory).
- Retrieval: Hybrid search, GraphRAG, fast memory tiers.
- Live Sessions: Whisper + diarization + transcript storage + UEM.

**Critical Gaps and Bugs (From Code + Docs)**
- `pipeline_router` is defined but not used; routing logic is bypassed.
- `content_zones` cleans content but is not applied to parsing.
- `summarize_long_content` writes invalid trace data.
- Dedup expects vector search results with top‑level `id`, but vector search returns `{node, score}`.
- Kafka worker imports a non‑existent orchestrator entrypoint.
- Embedding dimensions are inconsistent with index settings.
- Connector outputs are inconsistent (Record vs dict) and config models diverge.
- Incremental state is not persisted reliably; scheduler is in‑memory only.
- Webhooks call scheduler APIs with mismatched parameters.
- UEM is present, but UEM is not treated as the canonical, immutable source of truth in every pipeline step.

**Transformative Vision: Drovi Intelligence OS**
Drovi becomes the evidence‑grade operating system for organizational memory by combining lossless capture with an evolving truth engine. Every intelligence object is evidence‑anchored, time‑bounded, and explainable. The system is fast enough for real‑time usage and rigorous enough for audit‑grade trust.

**Transformative Upgrades (Integrated Plan)**
1. Evidence‑First Storage and UEM Enforcement
- Make UEM the canonical event log for all ingestion sources.
- Store raw evidence in an object store with retention and object lock.
- Require evidence links for all high‑stakes UIOs (commitments, decisions, risks).

2. Signal Capture vs Memory Truth Engine
- Fast layer: extract candidates without claiming truth.
- Truth layer: cluster, merge, supersede, and contradict with evidence weighting.
- Bi‑temporal versioning for every UIO and relationship.

3. Multi‑Pass Extraction + Verification
- Pass 1: classifier for routing and scope.
- Pass 2: extractor with structured output and quotes.
- Pass 3: verifier that rejects unsupported items and recalibrates confidence.
- Pass 4: contradiction scan against historical graph.

4. Identity‑First Intelligence
- Identity resolution before extraction.
- Evidence links reference contact identities, not just raw emails.
- Enrich contact intelligence in the background, not blocking extraction latency.

5. Real‑Time and Backfill Ingestion at Scale
- Kafka‑centric ingestion plane with normalization workers.
- Backfill orchestrator with time‑window chunking and rate‑limit policies.
- Idempotent ingestion using content hashes + provider IDs.

6. Memory Graph 2.0
- Standardize on one memory backbone with adapters for others.
- Time‑slice queries to answer “what did we know on X date?”
- Decision trails and commitment trails as first‑class views.

7. Trust, UX, and “Show Me”
- Evidence popovers and inline quotes for every intelligence item.
- Confidence visible by default, not buried in metadata.
- Ask experience with citations, follow‑ups, and fallback suggestions.

8. Risk & Policy Guardrails
- Pre‑send contradiction checks and policy enforcement.
- Fraud and PII detection paths.
- Audit‑grade logging for every risk alert.

9. User Memory and Personalization
- RAM‑layer user profiles (static + dynamic context).
- Hybrid retrieval that prioritizes memory objects, then raw chunks.
- Automatic memory decay and relevance scoring.

10. Observability and Quality Gates
- Quality eval harness with regression gates for every pipeline change.
- SLO dashboards for ingestion latency, extraction latency, and freshness.

**Phased Execution Plan (Updated)**

Phase 0 — Correctness + Consistency (Immediate)
- Fix pipeline routing, content cleaning, trace timing, dedup parsing, and Kafka worker import.
- Align connector outputs with canonical Record schema.
- Enforce embedding dimension alignment and index versioning.

Phase 1 — Evidence + UEM as Canonical Source
- Make unified_event the primary record for all ingested items.
- Evidence store with immutable storage, hashes, retention, and audit trails.
- Evidence links required for high‑stakes UIOs.

Phase 2 — Ingestion Fabric + Backfill at Scale
- Kafka‑centric ingestion with normalization workers.
- Backfill orchestrator with windowing, retries, rate limits, and persisted state.
- Webhook inbox/outbox with idempotency and partial sync params.

Phase 3 — Truth Engine + Temporal Memory
- Candidate clustering + evidence‑weighted merges.
- Supersession and contradiction logic for all UIO types.
- Time‑slice queries and knowledge evolution views.

Phase 4 — Trust + UX + Risk Layer
- Evidence‑first UI surfaces and confidence tiers.
- Pre‑send contradiction checks and policy warnings.
- Ask‑experience upgrades with conversational follow‑ups.

Phase 5 — Production Hardening
- SLO enforcement, load testing, DR drills, backup automation.
- Multi‑tenant isolation checks and security reviews.

**Why This Becomes “Obligatory”**
- It never loses or misrepresents commitments or decisions.
- It explains itself with evidence, timelines, and provenance.
- It becomes a durable memory substrate for agents and people.

**Immediate Next Actions (Top 12)**
- Wire `content_zones` output into parsing.
- Activate `pipeline_router` or remove it.
- Fix `summarize_long_content` trace handling.
- Fix dedup vector result parsing.
- Fix Kafka worker to call real orchestrator entrypoint.
- Enforce embedding dimension alignment and index versioning.
- Normalize all connectors to output `Record` and canonical content.
- Persist connector state in DB with durable cursors.
- Make UEM the default read path for downstream intelligence.
- Require evidence for commitments/decisions/risks.
- Add extraction verification for tasks/claims/risks.
- Add pre‑send contradiction checks in compose flows.
