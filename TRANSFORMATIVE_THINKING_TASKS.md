**Goal**
Execute this list end‑to‑end to make Drovi’s intelligence layer production‑ready, evidence‑grade, and demo‑worthy for enterprise pilots. Tasks are grouped by phase with clear acceptance criteria.

**Legend**
- [ ] Not started
- [~] In progress
- [x] Done

**Phase 0 — Correctness and Consistency (Immediate, Must‑Fix Bugs)**
- [x] Wire `content_zones` output into parsing so cleaned content is actually used. Acceptance: `parse_messages` consumes cleaned content; unit test verifies signatures and quoted replies are removed.
- [x] Activate `pipeline_router` in the LangGraph flow or delete the dead node. Acceptance: routing logic is exercised in at least one test case and metrics show skip/minimal/full branching.
- [x] Fix `summarize_long_content` trace data to use `Trace.node_timings` and the correct `NodeTiming` schema. Acceptance: trace serialization passes with no validation errors for long content.
- [x] Fix dedup parsing to use `match["node"]["id"]` instead of `match["id"]`. Acceptance: dedup merges are triggered in a test where existing UIOs are similar.
- [x] Fix Kafka worker import to call the real orchestrator entrypoint. Acceptance: worker can process a raw event and produce intelligence without crashing.
- [x] Enforce embedding dimension alignment with vector indexes. Acceptance: embeddings stored match index dimensions and vector search returns results for new items.
- [x] Add a guard that prevents vector search on labels without embeddings. Acceptance: no runtime errors when embeddings are missing and logs show graceful degradation.
- [x] Add regression tests for source triage routing paths (`skip`, `minimal`, `full`). Acceptance: tests validate pipeline routing from `source_intelligence`.

**Phase 1 — UEM as Canonical Source + Evidence Store**
- [x] Make `unified_event` the canonical ingest record for all sources. Acceptance: every connector ingestion path writes to `unified_event` with content hash and org scope.
- [x] Add a required evidence link for commitments, decisions, and risks. Acceptance: persistence rejects high‑stakes UIOs without evidence references.
- [x] Implement evidence hash validation on ingestion. Acceptance: duplicate `content_hash` is ignored per org.
- [x] Standardize evidence storage metadata fields. Acceptance: evidence records include source, timestamps, hash, and storage URI.
- [x] Wire evidence store to object lock and retention settings. Acceptance: retention policy can be verified via config and test run in MinIO.
- [x] Add evidence audit log entries for all UIO creation and updates. Acceptance: timeline entries link to evidence IDs.
- [x] Add `unified_event` to API read paths for evidence in UI and GraphRAG. Acceptance: read endpoints can serve evidence directly from UEM.
- [x] Implement a single evidence retrieval API endpoint with access control. Acceptance: user can fetch evidence artifact metadata and signed URLs.

**Phase 2 — Connector Normalization and State Durability**
- [x] Standardize `ConnectorConfig` usage across all connectors. Acceptance: `auth` and `provider_config` are the only supported config paths.
- [x] Update all connectors to emit `Record` objects. Acceptance: no connector returns raw dicts in `RecordBatch.records`.
- [x] Populate `record_type`, `cursor_value`, and `raw_data_hash` for all connectors. Acceptance: ingestion logs show non‑null fields across providers.
- [x] Add canonical normalization for messages, docs, and events. Acceptance: `normalize_record_for_pipeline` produces consistent `NormalizedRecord` for all connector types.
- [x] Implement DB‑backed connector state repository for incremental cursors. Acceptance: state persists across restarts and backfill resumes correctly.
- [x] Replace in‑memory scheduler state with persisted `sync_states`. Acceptance: scheduler resumes from DB on boot.
- [x] Fix webhook handler parameter mismatches (`sync_params`, `incremental`). Acceptance: webhook sync triggers operate with partial parameters.
- [x] Implement idempotent webhook inbox/outbox with dedupe keys. Acceptance: duplicate webhooks do not trigger repeated syncs.
- [x] Add rate‑limit and retry middleware for connector HTTP calls. Acceptance: 429/5xx retries are logged and bounded.
- [x] Add per‑provider backfill windowing and throttles. Acceptance: backfill runs in windows and respects API limits.

**Phase 3 — Ingestion Fabric and Streaming Reliability**
- [x] Kafka topics for `raw.connector.events`, `normalized.records`, `intelligence.pipeline.input`, `graph.changes`. Acceptance: events flow through all topics in staging.
- [x] Normalization workers to convert provider payloads to canonical formats. Acceptance: normalized events persist and are usable by pipeline.
- [x] Enrichment workers to attach participant context and identity resolution. Acceptance: identity resolution success rate logged per batch.
- [x] Live session streaming API hardening. Acceptance: chunk ingestion to transcript in under 5s median.
- [x] Incremental intelligence updates for partial transcripts. Acceptance: partial summaries update and converge to final UIOs.
- [x] Priority queueing by source and VIP status. Acceptance: webhook events preempt backfill jobs.
- [x] Idempotent ingestion by `content_hash` and source IDs. Acceptance: no duplicate UEM entries under replay.

**Phase 3.5 — High‑Throughput Ingestion + Missed Track Items**
- [x] Introduce a dedicated ingestion worker using Go for connector throughput. Acceptance: Go ingestion worker processes records at target throughput.
- [x] Use Kafka as the canonical event log; pipeline consumes events, not connector calls. Acceptance: connectors publish to Kafka and pipeline reads only from Kafka.
- [x] Implement automatic replay + idempotent ingestion by content hash + source IDs. Acceptance: replays do not duplicate UEM entries.
- [x] Introduce evidence nodes that bind every extracted item to a precise quoted span or segment hash. Acceptance: every UIO has at least one evidence link with `quoted_text` or `segment_hash`.
- [x] Show evidence inline in APIs and UI surfaces. Acceptance: UIO responses include evidence metadata and UI renders evidence with one click.

**Phase 4 — Signal Capture vs Truth Engine**
- [x] Enforce candidate‑first persistence for all UIO types. Acceptance: pipeline persists `signal_candidate` before final UIO.
- [x] Evidence‑weighted candidate clustering. Acceptance: clustering merges similar candidates with higher evidence counts.
- [x] Bi‑temporal fields for all UIOs and relationships. Acceptance: `valid_from`, `valid_to`, `system_from`, `system_to` populated.
- [x] Supersession logic for commitments, tasks, and risks. Acceptance: superseded items show links and `valid_to` set.
- [x] Contradiction detection integrated into truth engine. Acceptance: contradictions generate `Risk` with evidence and relationships.
- [x] Memory evolution logs written to UIO timeline. Acceptance: each update adds a timeline record.

**Phase 5 — Extraction Quality and Verification**
- [x] Implement Pass 1 lightweight classifier for routing and prioritization. Acceptance: classifier determines extraction path and priority tier for every input.
- [x] Implement Pass 2 extractor LLM with structured output and quote spans. Acceptance: extractor returns structured JSON with quoted spans for all high‑stakes items.
- [x] Implement Pass 3 verifier LLM to reject unsupported items and rescale confidence. Acceptance: verifier reduces confidence or rejects unsupported items with logged reasons.
- [x] Add source‑specific prompts for email, Slack, meetings, docs. Acceptance: prompt routing matches source type.
- [x] Add extraction verification for tasks, risks, and claims. Acceptance: verifier rejects unsupported items.
- [x] Add cross‑message evidence for commitments and decisions. Acceptance: items can link to multiple evidence segments.
- [x] Calibrate confidence using evidence weight, model tier, and source reliability. Acceptance: confidence distribution remains stable across sources.
- [x] Add long‑content chunking and merging. Acceptance: large docs produce consolidated outputs with de‑duped evidence.
- [x] Add model fallback routing with circuit breaker. Acceptance: extraction proceeds if primary model fails.
- [x] Output “Why this matters” and “What changed since last time” in every brief. Acceptance: briefs include rationale and delta sections.
- [x] Provide “Confidence Reasoning” for every UIO. Acceptance: confidence includes signal sources and adjustments.
- [x] Use a formal confidence calibration model (not just source weights). Acceptance: calibration uses evidence, model tier, and historical accuracy.

**Phase 6 — Memory Graph 2.0**
- [x] Choose a single memory backbone and formalize adapters. Acceptance: only one canonical memory API is used by pipeline.
- [x] Add time‑slice query API endpoints. Acceptance: queries return historical truth at a given timestamp.
- [x] Implement “Decision Trails” and “Commitment Trails.” Acceptance: API returns ordered evolution timeline.
- [x] Add entity and relationship decay rules. Acceptance: stale info is deprioritized in retrieval.
- [x] Add temporal consistency checks in GraphRAG queries. Acceptance: answers cite current truth and note past superseded info.

**Phase 7 — Retrieval and Ask Experience**
- [x] Improve hybrid retrieval fusion with weighted ranks. Acceptance: search relevance improves on gold set.
- [x] Add “explain why” citations in Ask responses. Acceptance: answers show evidence and timeline references.
- [x] Add follow‑up conversational queries with context memory. Acceptance: follow‑ups resolve pronouns and references.
- [x] Replace “last 90 days UIOs” with hybrid retrieval (graph + vector + temporal memory). Acceptance: context retrieval shows relevant entities across time.
- [x] Retrieve only high‑relevance context (topic + participant + time proximity). Acceptance: context size is bounded and relevance‑ranked.
- [x] Cache per‑conversation context to keep extraction under 300ms. Acceptance: repeated thread extractions hit cache and meet latency targets.

**Phase 8 — Active Learning + Pattern Intelligence**
- [x] Convert all user corrections into labeled training data. Acceptance: corrections are exported in a structured dataset with labels and evidence.
- [x] Build a feedback‑to‑model pipeline that updates prompts and supports optional fine‑tuning. Acceptance: pipeline can replay corrections into updated extraction configs.
- [x] Personalize extraction per org (language, jargon, roles, project names). Acceptance: per‑org prompt/context rules improve precision on eval sets.
- [x] Auto‑discover patterns via embedding clustering of commitments/decisions. Acceptance: pattern candidates are generated automatically with stats.
- [x] Let users promote clusters into patterns with expected actions and confidence boosts. Acceptance: UI/API supports promotion and pattern lifecycle.
- [x] Use patterns as a fast‑path for high‑precision extraction and prioritization. Acceptance: pattern match boosts confidence and routing decisions.

**Phase 9 — Multimodal Intelligence**
- [x] Process attachments, PDFs, slides, and images with OCR + layout awareness. Acceptance: extracted content is indexed and evidence‑linked.
- [x] Meeting audio: diarization + speaker resolution with evidence‑level timestamps. Acceptance: transcript segments include speaker IDs and timestamps.
- [x] Link every transcript segment to UIOs it supports. Acceptance: each UIO references specific transcript segments.
- [x] Add “closest matches” fallback when no direct results exist. Acceptance: Ask endpoint returns helpful alternatives.
- [x] Add RAM‑layer user profile retrieval and caching. Acceptance: default context included in responses under 400ms.

**Phase 10 — Risk, Policy, and Pre‑Send Guardrails**
- [x] Pre‑send contradiction check API for compose flows. Acceptance: conflicts appear before send with evidence links.
- [x] PII detection pipeline for outgoing drafts. Acceptance: sensitive data warnings appear reliably.
- [x] Fraud and impersonation heuristics for inbound messages. Acceptance: risk alerts generated with scores.
- [x] Policy rule engine for enterprise compliance. Acceptance: rules can block or require approval.
- [x] Audit log for all risk detections and user actions. Acceptance: audit records link to evidence and user IDs.

**Phase 11 — UX Surfaces That Build Trust**
- [x] Evidence popover UI for every intelligence card. Acceptance: one‑click evidence view with highlighted quotes.
- [x] Confidence badges visible by default. Acceptance: UIO cards show confidence tiers and reasons.
- [x] “Show me why” flow in Ask results. Acceptance: citations link to evidence and timeline views.
- [x] Long‑term memory views for relationships and decisions. Acceptance: timeline view spans years with major changes.
- [x] Multi‑source compose support for contradiction checks across email/Slack/WhatsApp. Acceptance: compose runs risk checks per source.

**Phase 12 — Observability, SLOs, and Reliability**
- [x] Implement all Prometheus metrics in docs. Acceptance: Grafana dashboards show ingestion, extraction, and evidence latency.
- [x] SLO burn alerts configured for 1h and 6h windows. Acceptance: alerts trigger in staging when thresholds exceeded.
- [x] Kafka consumer lag monitoring. Acceptance: alerts fire for sustained lag.
- [x] Daily backup verification and weekly restore drills. Acceptance: restores pass in staging and logs retained.
- [x] Load testing for ingestion and extraction. Acceptance: p95 extraction < 30s and UEM persist < 500ms.

**Phase 13 — Security and Compliance**
- [x] RLS tests for tenant isolation in Postgres and FalkorDB. Acceptance: cross‑tenant queries are blocked.
- [x] Evidence access control checks for signed URL retrieval. Acceptance: unauthorized access fails.
- [x] Consent and recording policy enforcement for live sessions. Acceptance: regional rules are honored.
- [x] Data retention policies with deletion verification. Acceptance: data purged according to policy.

**Phase 14 — End‑to‑End Testing and Release Readiness**
- [ ] Build a gold dataset for commitments, decisions, risks, tasks, and claims. Acceptance: dataset covers at least 500 diverse samples.
- [ ] Implement automated eval harness with precision/recall and hallucination metrics. Acceptance: regressions block CI.
- [ ] Add integration tests for connectors, UEM, and pipeline. Acceptance: CI passes on core ingestion paths.
- [ ] Add chaos tests for partial failures (LLM provider down, Kafka lag). Acceptance: pipeline degrades gracefully.
- [ ] Run an internal pilot and collect correction data. Acceptance: correction rate trends downward after tuning.

**Phase 15 — Demo‑Ready “Wow” Features**
- [ ] Decision Radar real‑time detection with confirmation prompt. Acceptance: live sessions flag decision points.
- [ ] Commitment auto‑closure based on evidence. Acceptance: commitments close when fulfillment detected.
- [ ] Organizational blindspot detection reports. Acceptance: blindspot report generated weekly.
- [ ] Executive weekly memory brief. Acceptance: automated brief surfaces key decisions and risks.
- [ ] Executive daily brief. Who did what yesterday, what happened and how?

**Completion Definition**
- Evidence‑first UEM ingestion for all sources is live.
- Extraction is verified, calibrated, and traceable.
- Memory truth engine supports bi‑temporal history and contradiction handling.
- Trust UX surfaces are built and visible by default.
- SLOs are met and verified under load.
