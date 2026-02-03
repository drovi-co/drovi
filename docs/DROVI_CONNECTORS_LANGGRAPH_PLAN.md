# Drovi Connectors + LangGraph Deep Analysis & Production Plan

Date: 2026-02-02

This document consolidates (1) deep analysis of the current connector system and pipeline implementation, (2) the concrete gaps blocking production‑grade reliability, and (3) a phased, testable plan to reach best‑in‑class ingestion + intelligence.

---

## 1) Connectors: Current State & Gaps

### 1.1 Architectural / Consistency Gaps
- **Config model is inconsistent across connectors.**
  - Some connectors use `ConnectorConfig.auth` (Gmail, Slack), while others use `config.credentials` and `config.settings` (Outlook, Teams, Notion, Google Docs, HubSpot). `ConnectorConfig` does not define `credentials` or `settings`.
  - `connection_service.get_connection_config()` returns `ConnectorConfig` with `auth`, but Celery tasks build a separate `ConnectorConfig` with `credentials/settings`, so behavior differs depending on execution path.

- **Connector outputs are inconsistent with `Record` model.**
  - Gmail/Slack return `Record` objects; Notion/Teams/Outlook/HubSpot return dicts.
  - `RecordBatch` expects `list[Record]` but many connectors feed raw dicts.
  - `record_type`, `cursor_value`, and `raw_data_hash` are missing on most non‑Gmail/Slack records.

- **No durable state persistence for incremental cursors.**
  - Scheduler uses in‑memory `_connection_states` only.
  - Webhook handlers use `sync_states` table but reference `state` field that does not exist (actual column is `cursor_state`).
  - Incremental cursor updates are not persisted to DB, so restarts lose state and cause re‑sync or missed data.

- **Scheduler / job system is not production‑safe.**
  - APScheduler runs inside API process; no distributed locking, no horizontal scaling, no job persistence.
  - In‑memory job history only, but DB has `sync_job_history` table that is unused.
  - No per‑tenant backpressure or priority queueing.

- **Webhook handlers call non‑existent scheduler APIs.**
  - Slack/Gmail/Teams handlers call `trigger_sync_by_id(..., incremental=True, sync_params=...)` but `trigger_sync_by_id` doesn’t accept those parameters.
  - No actual implementation to “sync only channel X since TS Y” despite webhook intent.

- **Token refresh is not reliably integrated.**
  - `ConnectorConfig.token_needs_refresh` exists but scheduler never calls `refresh_token`.
  - OAuth token manager/store is partial; connectors do not share a consistent refresh path.

### 1.2 Backfill Gaps (First Connection)
- **Backfill logic is partial or missing.**
  - Gmail supports `backfill_start_date` but no `backfill_end_date`, no rate‑controlled backfill scheduling.
  - Slack, Teams, Outlook, HubSpot, Notion, Google Docs do not implement robust backfill windowing (date partitions, per‑stream cursors, or paged batching by time).
  - No “initial full sync” workflow that incrementally populates historical data without saturating APIs.

### 1.3 Live / Real‑Time Ingestion Gaps
- **Webhooks do not feed a real‑time ingestion pipeline.**
  - Webhooks are processed synchronously or in Celery tasks without Kafka.
  - No durable inbox/outbox, no de‑duplication, no ordering guarantees.

- **Connector webhooks do not map to canonical “message/document” ingestion.**
  - Slack/Teams/Gmail webhook events do not produce `UnifiedMessage` or `Record` objects; they attempt to trigger a sync instead.

### 1.4 Data Quality & Extraction Mapping Gaps
- **The intelligence pipeline expects “email‑like” fields.**
  - `_default_sync_execution` constructs `content` from `subject/body_text/snippet` only. Slack, Teams, Notion, Google Docs, HubSpot records use different fields, so content is often empty.
  - Result: many connectors effectively feed blank content to the pipeline.

- **Canonical schema (`UnifiedMessage` / `UnifiedDocument`) is unused.**
  - There’s no normalization layer that translates connector records into canonical format for stable extraction.

### 1.5 Reliability & Scalability Gaps
- **No rate‑limit & retry strategy.**
  - Connectors use raw HTTP clients without standardized retry/backoff handling for 429/5xx.

- **No idempotency or dedupe.**
  - `raw_data_hash` exists but is not consistently set or used to avoid re‑processing.

- **No central backpressure or job queue.**
  - High‑volume connectors (Slack, Gmail, HubSpot) can overwhelm the pipeline.

---

## 2) LangGraph Pipeline: Current State & Gaps

### 2.1 Functional Gaps
- **Pipeline content input is not normalized.**
  - Pipeline expects a single “content” string from sources; connectors don’t reliably provide it.
  - No multi‑source merger (email thread + Slack context + meeting transcript) before extraction.

- **No retrieval‑augmented context.**
  - The pipeline doesn’t retrieve relevant prior UIOs or conversation context before extraction.
  - No “memory‑grounded extraction” to reduce hallucinations and improve correctness.

- **Insufficient validation and confidence calibration.**
  - LLM outputs are accepted without strong post‑validation or cross‑checks.
  - No constraint‑based verifier / policy for commitments or decisions.

- **No explicit “chunking + summarization” stage for long content.**
  - Large docs/threads go through a single prompt path, reducing accuracy and increasing cost.

### 2.2 Operational Gaps
- **No strong regression gates tied to LangGraph outputs.**
  - Eval harness exists but is not used as a hard CI gate for pipeline updates.

- **No structured error taxonomy.**
  - LLM failures are logged but not classified or routed for remediation.

- **No per‑source specialized prompts.**
  - Slack vs email vs meeting transcripts all use the same general prompts.

---

## 3) Target Architecture (Best‑in‑Class)

### 3.1 Connector Ingestion Plane (Kafka‑centric)
1) **Connector Gateway**
   - Webhooks and polling connectors push raw events into Kafka topics (per provider and per tenant).
   - Durable “inbox” with idempotency keys per event (source id + provider + org).

2) **Normalization Workers**
   - Convert provider‑specific payloads into canonical schemas:
     - `UnifiedMessage`
     - `UnifiedDocument`
     - `UnifiedEvent`
     - `UnifiedTranscript`
   - Store raw payloads in S3/MinIO evidence store + record metadata in Postgres.

3) **Enrichment Workers**
   - Resolve contacts and identity.
   - Add channel/thread context.
   - Attach metadata (source, participants, timestamps, region, consent).

4) **Pipeline Workers**
   - Feed normalized content into LangGraph pipeline.
   - Use queue‑based backpressure + priority tiers (webhook vs backfill vs nightly).

### 3.2 Backfill Orchestrator
- Dedicated backfill scheduler to chunk historical syncs by time windows.
- Rate‑limit aware job scheduler with per‑provider quotas.
- State persisted in `sync_states` table with versioned schema.

### 3.3 Job Control / Observability
- Sync and pipeline jobs persisted in DB (job history table), emitted to Kafka events, exposed via API.
- SLOs, dashboards, and alerting integrated for connector latency and extraction error rates.

---

## 4) Plan: Production‑Ready Execution

### Phase 0 — Consistency & Safety (Critical Fixes)
1) **Unify ConnectorConfig**
   - Remove `credentials`/`settings` usages; standardize on `auth` + `provider_config`.
   - Update all connectors (Outlook, Teams, Notion, Google Docs, HubSpot, WhatsApp) to use `config.auth` and `config.provider_config`.

2) **Normalize connector outputs**
   - All connectors must emit `Record` objects (not dicts).
   - Ensure `record_type`, `raw_data_hash`, `cursor_value` are populated.

3) **Persist incremental state**
   - Implement `ConnectorStateRepository` for `sync_states` table.
   - Replace in‑memory `_connection_states` with DB‑backed state.

4) **Fix webhook → scheduler API mismatch**
   - Add explicit support for `sync_params` (channel_id, since_ts, start_history_id).
   - Implement partial‑stream sync path in connectors.

5) **Fix sync_states schema mismatch**
   - Update webhook handlers to use `cursor_state` field.

6) **Use canonical normalization in pipeline entry**
   - Create `normalize_record()` to map Record → UnifiedMessage/UnifiedDocument/etc.
   - Update `_default_sync_execution` to use normalized schema for content.

### Phase 1 — Backfill & Real‑Time Reliability
1) **Backfill Orchestrator**
   - Backfill jobs with chunked time windows (per connector stream).
   - API to set backfill range + throttle.

2) **Rate‑limit + retry layer**
   - Implement standardized HTTP retry/backoff for 429/5xx.
   - Provider‑specific throttles (Slack, Gmail, HubSpot, Graph API).

3) **Webhook inbox/outbox**
   - Persist inbound webhooks with idempotency keys.
   - Process via Kafka → workers (not inline).

4) **Streaming ingestion**
   - Use Kafka topics:
     - `raw.connector.events` (per provider)
     - `normalized.records`
     - `intelligence.pipeline.input`
     - `graph.changes`

### Phase 2 — LangGraph Quality Improvements
1) **Context‑aware extraction**
   - Pre‑node: `retrieve_context` from UIO graph + recent transcripts.
   - Add context to extraction prompts.

2) **Long‑content chunking**
   - Chunk documents/threads into sections, run extraction, then merge with cross‑checks.

3) **Specialized prompt variants**
   - Source‑specific prompt templates (email vs Slack vs meeting transcript).

4) **Multi‑pass validation**
   - Add a verifier node to validate commitments/decisions against source text.

5) **Confidence calibration**
   - Post‑node to normalize confidence to consistent scale.

### Phase 3 — Production‑Grade Observability & Quality Gates
1) **Connector SLOs**
   - Latency, error rate, freshness per connector.

2) **Pipeline eval gates**
   - CI gated on gold dataset regression metrics.
   - Auto‑rollback on degraded precision/recall.

3) **Audit & compliance**
   - Full audit trail for connector runs (job history, record counts, errors).
   - Consent + region enforcement per ingestion.

### Phase 4 — Scaling & Enterprise Features
1) **Multi‑tenant isolation**
   - Dedicated Kafka topics or partitions per tenant.
   - Per‑tenant encryption keys (KMS).

2) **High‑volume connectors**
   - Streaming fan‑out with dynamic throttling.
   - Priority queue (webhook live > scheduled > backfill).

---

## 5) Deliverables (Concrete Implementation Checklist)

### Connector Layer
- [ ] Standardize `ConnectorConfig` usage across all connectors.
- [ ] Replace raw dict outputs with `Record` objects everywhere.
- [ ] Implement DB‑backed sync state repository.
- [ ] Implement webhook‑triggered incremental sync params per connector.
- [ ] Add rate‑limit + retry middleware for all HTTP connectors.

### Backfill & Scheduler
- [ ] Backfill scheduler with time‑window chunking.
- [ ] Persist job history to `sync_job_history`.
- [ ] Migrate APScheduler to dedicated worker service with distributed locks.

### Normalization & Pipeline
- [ ] Normalize to canonical schemas before LangGraph.
- [ ] Add context retrieval node.
- [ ] Add verifier + confidence calibration nodes.
- [ ] Add chunker for long content.

### Observability & Quality
- [ ] Per‑connector dashboards and alerts.
- [ ] Regression eval gating in CI for pipeline.
- [ ] Audit trail + retention policy for raw data.

---

## 6) Acceptance Criteria

- **Connector ingestion**: All connectors consistently emit canonical `Record` objects and persist cursor state in DB.
- **Backfill**: First connection backfill completes reliably with rate‑limit compliance and resumable checkpoints.
- **Webhooks**: All webhook events trigger real‑time ingestion without requiring full re‑sync.
- **Pipeline accuracy**: Documented improvement in precision/recall from eval harness; regression gates enforced.
- **Reliability**: Sync jobs are durable across restarts, horizontally scalable, and observable.

---

## 7) Immediate Next Actions (Suggested)
1) Implement config + record normalization fixes (Phase 0).
2) Persist connector states and job history (Phase 0).
3) Stand up Kafka topics + normalization workers (Phase 1).
4) Add context retrieval and validation nodes to LangGraph (Phase 2).

