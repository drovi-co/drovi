# Drovi Intelligence: Gaps, Rework, and Expansion Plan (Draft for Approval)

Date: 2026-01-31
Owner: Drovi
Scope: Product + Intelligence + Infra

---

## 1) Executive Summary
Drovi already has strong building blocks (multi-source connectors, a LangGraph extraction pipeline, a graph store, and hybrid search). The biggest gaps are: (1) evidence-grade data foundation, (2) quality/evaluation feedback loops, (3) real-time streaming ingestion with deterministic pipelines, (4) enterprise security/compliance posture, and (5) a hardened infra architecture for scale and latency. Addressing these unlocks the “indispensable operating system” vision and enables the new live meeting + call ingestion capability.

This plan upgrades Drovi into a true intelligence OS by making **evidence-first memory** the core system, enabling **real-time transcription and graph updates**, and providing **trustworthy, measurable intelligence** with human-in-the-loop correction.

---

## 2) Current Strengths (Keep + Expand)
- **Extraction pipeline**: LangGraph orchestration with routing, multi-stage extraction, and post-processing.
- **Graph storage**: FalkorDB integration for knowledge graph and relationship intelligence.
- **Hybrid search**: vector + fulltext + graph query pipeline exists.
- **Streaming infra**: Kafka consumer/producer and worker pattern in place.
- **Connector framework**: calendar, email, Slack, WhatsApp, docs, CRM, etc.

These are solid foundations but need reliability, quality, and enterprise-grade enhancements to create a billion-dollar, durable product.

---

## 3) Critical Gaps & Rework Needed

### A) Evidence-Grade Data Foundation
**Problem**: Evidence is partially stored but not treated as a first-class immutable data store. There is no dedicated object store for raw artifacts (emails, attachments, transcripts, audio).

**Gaps**
- No durable, immutable evidence layer with retention, WORM-style integrity, and chain-of-custody.
- Inconsistent provenance/citation links across intelligence objects.
- Missing normalization for multi-modal sources (audio/video/transcripts).

**Rework**
- Introduce an **Evidence Store**: object storage for raw artifacts + a metadata index in Postgres.
- Standardize evidence references in all UIOs (message IDs, timestamps, content hash).
- Add immutable audit logs + retention policies.

### B) Real-Time Streaming & Incremental Intelligence
**Problem**: Streaming exists but is not optimized for real-time, chunked processing, and progressive enrichment (critical for live meetings/calls).

**Gaps**
- No real-time chunk ingestion API for audio/transcripts.
- No incremental graph updates for partial data with revision tracking.
- No priority-based scheduling for VIP threads or time-critical decisions.

**Rework**
- Build a **Streaming Ingestion API** (WebSocket/gRPC) for live transcripts and audio chunks.
- Implement **incremental intelligence updates** (partial transcripts -> refined summaries -> final UIOs).
- Add a **priority queue** and SLA tiers by user + source type.

### C) Intelligence Quality, Evaluation, and Trust
**Problem**: There is no formal evaluation harness or automated regression checks for extraction quality.

**Gaps**
- No gold dataset or scoring harness for claims/commitments/decisions.
- Limited confidence calibration tied to real performance metrics.
- Human corrections are stored but not systematically fed back into models.

**Rework**
- Build an **Evaluation Framework**: test sets, metrics (precision/recall, F1, latency, hallucination rate).
- Add **confidence calibration** by source type + model version.
- Create an **Active Learning Loop** to ingest corrections into prompts, rules, and fine-tuning.

### D) Architecture & Infra Hardening
**Problem**: The current architecture is functional but not yet enterprise-scale.

**Gaps**
- Single DB pool strategy (NullPool) and mixed SQLAlchemy/asyncpg can limit concurrency.
- Graph vector indexing is not fully realized (manual setup required).
- No explicit sharding or multi-tenant isolation plan.

**Rework**
- Separate **Read/Write DB pools** with a tuned async pool for production.
- Fully implement **FalkorDB vector + fulltext index management**.
- Add **multi-tenant isolation** patterns (schema-per-tenant or row-level + encrypted keys).

### E) Product Data Model Gaps
**Problem**: Transcripts, meeting artifacts, and call recordings are not fully represented in the graph and UIO schemas.

**Gaps**
- No canonical `Transcript` or `Call` entity with diarization + speaker identity.
- No model for “live context window” updates.
- No meeting/action item extraction specialized for real-time data.

**Rework**
- Add **UnifiedTranscript**, **MeetingSession**, **CallSession** schemas.
- Add new UIO types: `ActionItem`, `Decision`, `Risk`, `FollowUp` from live sources.
- Extend graph schema with `SPEAKER`, `UTTERED`, `IN_MEETING`, `CALL_WITH` relationships.

---

## 4) New Capability: Live Meeting & Call Ingestion (Design)

### A) Product Goal
Drovi becomes the **real-time organizational memory**. It captures live meetings and calls, transcribes with high accuracy, identifies speakers, and updates the knowledge graph in minutes or seconds.

### B) Ingestion Sources
1. **MacOS + iOS app**
   - Local capture of microphone + system audio (where allowed).
   - Real-time chunk streaming to Drovi backend.
   - On-device fallback for offline transcription.

2. **Calendar/Meeting Providers**
   - Zoom/Meet/Teams integrations to auto-ingest recordings + transcripts.
   - Automatic meeting metadata linking (topic, attendees, organizer, time).

3. **Phone Calls**
   - **VoIP bridge** (Drovi dialer) for full control + recording.
   - Optional integrations (Twilio/Zoom Phone) for consent + recording retrieval.

### C) Real-Time Pipeline (Conceptual)
```
[Device Capture] -> [Streaming Gateway] -> [ASR Engine] -> [Diarization + Speaker ID]
-> [Transcript Store + Evidence Store] -> [Incremental Intelligence Extraction]
-> [Graph Updates + Notifications]
```

### D) Requirements
- **Sub-5s latency** for partial transcript updates.
- **Speaker diarization** and identity resolution (linked to contacts/participants).
- **Evidence-first storage**: raw audio + transcript segments + timestamps.
- **Compliance**: consent prompts, configurable recording rules by region.

---

## 5) Proposed Architecture Upgrades

### A) Data Layer
- **Evidence Store**: S3-compatible object storage for raw audio, recordings, attachments.
- **Metadata Index**: Postgres table tracking evidence + hash + retention policies.
- **Graph Extensions**: transcript nodes, meeting sessions, call sessions.

### B) Processing Layer
- **Streaming Ingestion Service** (WebSocket/gRPC) for audio chunk uploads.
- **ASR Service** (pluggable): Whisper/Deepgram/other providers.
- **Diarization Service**: identify speakers and link to contact graph.
- **Incremental Intelligence Service**: partial summaries + action item detection.

### C) Orchestrator Enhancements
- Add **live transcript nodes** to LangGraph pipeline.
- Introduce **stateful revision tracking** (partial -> final).
- Add **event-based triggers** for high-confidence commitments.

### D) Product APIs
- `/ingest/live-session/start`
- `/ingest/live-session/chunk`
- `/ingest/live-session/end`
- `/transcripts/{session_id}`
- `/meetings/{session_id}/brief`

---

## 6) Additional Creative Ideas (Optional Expansion)

1. **Drovi “Decision Radar”**
   - Real-time detection of decision points in meetings and emails.
   - Prompts user: “This sounds like a decision. Confirm?”

2. **Commitment Auto-Closure**
   - Auto-mark commitments as resolved when evidence appears in later emails or meeting transcripts.

3. **Personalized Intelligence Score**
   - Tracks how often Drovi prevents contradictions or missed commitments.
   - Builds visible ROI for each user/organization.

---

## 7) Phased Execution Plan

### Phase 0 — Approval & Alignment (Week 0-1)
- Finalize scope + MVP success metrics.
- Confirm compliance requirements for recording/transcription.

### Phase 1 — Evidence Layer & Graph Rework (Weeks 2-6)
- Add Evidence Store + metadata index.
- Extend graph schema for transcript/call/meeting nodes.
- Add immutable provenance links to UIOs.

### Phase 2 — Live Ingestion Pipeline (Weeks 6-12)
- Build Streaming Ingestion API.
- Integrate ASR + diarization pipeline.
- Store transcript chunks + timestamps.
- Build incremental summarization + action item extraction.

### Phase 3 — Productization (Weeks 12-16)
- MacOS app (record + stream).
- iOS app (record + stream).
- Calendar integration for meeting linking.
- Notification + follow-up workflows.

### Phase 4 — Quality & Trust Expansion (Weeks 16-20)
- Build evaluation harness and gold datasets.
- Add confidence calibration dashboard.
- Launch human review + correction loop.

---

## 8) KPIs and Proof of “Indispensability”
- **Accuracy**: 90%+ precision on commitments/decisions.
- **Latency**: transcript updates <5s; meeting brief <2 min post-meeting.
- **Retention**: 40%+ weekly retention among execs.
- **ROI Signal**: reduced missed commitments, fewer contradictory emails.

---

## 9) Risks & Mitigations
- **Legal/Compliance Risk**: Call recording regulations vary by region.
  - Mitigation: explicit consent prompts, user-configurable recording rules.
- **Accuracy Risk**: ASR errors degrade trust.
  - Mitigation: multi-pass transcription + human correction, confidence scoring.
- **Scale Risk**: streaming audio increases infra costs.
  - Mitigation: tiered pricing + throttling + smart summarization.

---

## 10) Approval Checklist
- [ ] Confirm scope and priorities
- [ ] Approve architecture upgrades
- [ ] Greenlight live ingestion build
- [ ] Define compliance requirements

---

## Appendix: Key Files/Modules That Need Changes
- `drovi-intelligence/src/connectors/base/records.py` (new transcript/call records)
- `drovi-intelligence/src/orchestrator/graph.py` (new ingestion paths)
- `drovi-intelligence/src/graph/schema.py` (new node/relationship types)
- `drovi-intelligence/src/streaming/worker.py` (real-time session events)
- `drovi-intelligence/src/api/routes` (new ingestion endpoints)

