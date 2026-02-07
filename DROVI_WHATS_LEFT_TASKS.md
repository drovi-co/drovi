# DROVI_WHATS_LEFT_TASKS

This tasks file is derived from `DROVI_WHATS_LEFT_PLAN.md` and is designed to be executed phase-by-phase until:
- all connectors backfill + live ingest cleanly,
- the web app has zero page errors,
- the team model is correct and enforced,
- the admin app exists and operates the platform,
- support + observability are production-grade,
- doc ingestion + “Smart Drive” are pilot-ready,
- legal/accounting killer features are demo-ready,
- drafting is integrated with proof and contradictions,
- a Porter deployment trial succeeds.

Each phase includes acceptance criteria and test expectations.

---

## Status (2026-02-07)

**Completed (implemented + passing local gates)**
- [x] Phase 0.1: repo “green build” gates (`bun run green`) + CI build/test/docker/smoke workflow.
- [x] Phase 0.3: standardized API error taxonomy + UI surfaces (banner + per-page panel).
- [x] Phase 0.5: execution plane hardening (Kafka retries/DLQ + Postgres durable jobs + restart-safe scheduler).
- [x] Phase 1 (backend): connector contract APIs + durable sync/backfill job execution + regression tests.
- [x] Phase 3 (partial): global Intent Bar (`Cmd/Ctrl+K`) with Ask/Search wired to drovi-intelligence.
- [x] Phase 2 (partial backend): connection ownership + `org_shared/private` visibility + access checks + SSE filtering.

**In progress (current focus)**
- [ ] Phase 0.2: “no errors on any page” audit, starting with auth/onboarding + Connected Sources + Exchange.
- [ ] Phase 2: team model and permissions (complete UI + policy + “private memory” boundaries).

---

## Phase 0: Baseline Reliability and “No Errors On Any Page”

### 0.1 Repo hygiene and build gates
- [x] Define a single “green build” command for the repo.
  - `bun run green` (typecheck + unit tests + docker build/up)
- [x] Ensure `check-types` passes at the repo root.
- [x] Ensure unit tests pass at the repo root (`bun run test:run`).
- [x] CI workflow runs:
  - [x] Lint
  - [x] Typecheck
  - [x] Unit tests
  - [x] Docker build (web + intelligence)
  - [x] Minimal smoke test hitting `/health` and `/api/v1/auth/me`

**Acceptance**
- Root typecheck and unit tests pass on a clean checkout.

### 0.2 Web app page audit (sidebar parity)
- [ ] Enumerate all sidebar routes in `apps/web/src/components/layout/app-sidebar.tsx`.
- [ ] For each route, run it in dev via docker and confirm:
  - [ ] It renders without runtime errors.
  - [ ] It uses drovi-intelligence API (no old server URLs).
  - [ ] It handles API down, auth expired, and missing connector config gracefully.
- [ ] Remove dead components and routes that are not reachable from the sidebar (or explicitly mark as “WIP” with a stable placeholder).

### 0.2.1 Current broken-flow fixes (blockers for “no errors on any page”)
- [ ] Auth/login UX: fix the “welcome back toast but still on login until refresh” navigation glitch.
- [ ] Onboarding: eliminate “Not authenticated” errors when continuing the first onboarding step.
- [ ] Connected Sources page:
  - [ ] eliminate “Missing API key” errors (must work with session auth)
  - [ ] eliminate “Internal Server Error” when initiating connector OAuth
  - [ ] ensure missing connector env returns a 400 with a clear “not configured” message (never 500)
- [ ] Exchange page:
  - [ ] eliminate “Missing API key” errors (must work with session auth)
  - [ ] eliminate intermittent “Drovi API unreachable” false positives (diagnostics must match the actual base URL)
- [ ] Reality Stream: eliminate “relation `entity_versions` does not exist” (verify migrations + add graceful fallback if migration drift occurs).
- [ ] Sidebar: remove the “Administration” section from the main web app (admin tooling moves to `apps/admin`).

**Acceptance**
- “Click every sidebar item” yields no red errors and no broken fetches.

### 0.3 “API unreachable” and “Auth expired” UX standardization
- [x] Standardize API error taxonomy in `apps/web/src/lib/api.ts`:
  - [x] `API_UNREACHABLE`
  - [x] `UNAUTHENTICATED`
  - [x] `FORBIDDEN`
  - [x] `VALIDATION_ERROR`
  - [x] `RATE_LIMITED`
  - [x] `SERVER_ERROR`
- [x] Standardize UI error surfaces:
  - [x] Top banner for API unreachable (`/health` based)
  - [x] Inline card errors per page query (with retry)
  - [x] Auth-expired prompt with a one-click re-login

**Acceptance**
- No ambiguous “failed to fetch”; the UI shows the failing endpoint and actionable recovery.

---

## Phase 0.5: Execution Plane Hardening (Kafka + Durable Jobs)

This phase makes connectors/backfills/live ingestion and all background work resilient to restarts, poison messages, and scale.

### 0.5.1 Decide and document the async architecture (single source of truth)
- [x] Write a short internal ADR (architecture decision record) that states:
  - [x] Kafka is the **event plane** (ingestion + pipeline + graph change streaming)
  - [x] Background “commands” (sync/backfill/reports/maintenance) run via a **durable job plane**
  - [x] We will not introduce a parallel job system like BullMQ in Node (avoid split-brain)
- [x] Decide the durable job plane implementation:
  - [x] Option A (recommended): Postgres-backed job queue (leases + SKIP LOCKED) + worker pool
  - [ ] Option B: Celery + Redis/RabbitMQ (requires deploying celery worker + beat and removing APScheduler duplication)
  - [ ] Option C: Temporal (bigger lift; strongest reliability/visibility)

**Acceptance**
- One job system is selected; all future work is aligned to it.

### 0.5.2 Kafka hardening: DLQ + bounded retries + replay tooling
- [x] Add explicit retry/DLQ strategy per topic:
  - [x] `raw.connector.events`
  - [x] `normalized.records`
  - [x] `intelligence.pipeline.input`
  - [x] `graph.changes` (if any processing occurs; otherwise keep “firehose”)
- [x] Implement poison-message protection in `drovi-intelligence/src/streaming/kafka_consumer.py`:
  - [x] On handler exception, do not retry forever.
  - [x] Re-publish to retry topic with incremented retry count and backoff metadata OR publish to DLQ after N retries.
  - [x] Commit the original offset once routed (so the partition does not stall).
- [x] Add a small CLI/tooling module to:
  - [x] inspect DLQ messages
  - [x] replay a DLQ message (or a range) back to the main topic
  - [x] permanently drop a message with an audit log entry
- [x] Add metrics:
  - [x] retries routed
  - [x] DLQ routed
  - [x] per-topic handler error rate
  - [x] end-to-end pipeline lag (by content_hash / event timestamp)
- [x] Add tests:
  - [x] unit tests for “handler throws -> message routed -> offset committed”
  - [x] integration test in docker that injects a poison message and confirms the worker continues processing subsequent messages

**Acceptance**
- One poison message cannot wedge a consumer group; failures are visible and replayable.

### 0.5.3 Scheduler durability: schedule rehydration and reconciliation
- [x] Make `drovi-scheduler` rehydrate connection schedules from DB on startup:
  - [x] query active connections with `sync_enabled = true`
  - [x] schedule each with its stored interval/cron
- [x] Add a periodic “reconcile schedules” job:
  - [x] every N minutes, ensure APScheduler jobs match DB (added/removed/interval changed)
- [x] Add a “global kill switch” config:
  - [x] disable all scheduled syncs without redeploying (for incident response)

**Acceptance**
- Restarting `drovi-scheduler` does not stop live ingestion; schedules recover automatically.

### 0.5.4 Durable job plane (sync/backfill/reports/maintenance)
- [x] Implement the chosen durable job mechanism (from 0.5.1) with:
  - [x] job records persisted in Postgres (status, args, run_at, attempts, max_attempts, lease_until)
  - [x] strict idempotency keys for connector jobs (connection_id + window + stream + full_refresh)
  - [x] cancel/retry semantics
  - [x] per-connection concurrency cap (never run 2 syncs for same connection concurrently)
  - [x] provider rate limiting (org-level and connection-level budgets)
- [x] Move long-running executions out of APScheduler:
  - [x] scheduler enqueues jobs only
  - [x] workers execute jobs
  - [x] progress is emitted via sync events (Redis/SSE) and persisted in DB
- [x] Migrate periodic tasks to jobs:
  - [x] weekly/daily reports
  - [x] candidate processing
  - [x] evidence retention cleanup
  - [x] decay computation
  - [x] webhook outbox flush
- [x] Add admin endpoints:
  - [x] list jobs by type/status/org
  - [x] cancel job
  - [x] retry job
  - [x] replay failed job with overrides

**Acceptance**
- Connector backfills and scheduled syncs continue across restarts, are visible, and can be replayed deterministically.

### 0.5.5 Celery cleanup (or activation)
- [x] If we choose not to use Celery:
  - [x] delete Celery config/tasks to avoid split-brain, or mark as explicitly deprecated with a clear comment
- [ ] If we choose to use Celery:
  - [ ] add `celery-worker` + `celery-beat` containers to docker compose
  - [ ] remove APScheduler duplication and make Celery the single scheduler/runner for commands

---

## Phase 1: Connector Contract + Backfill + Live Sync (All Sources “Plugged In”)

### 1.1 Canonical connector state + idempotency
- [x] Define canonical connector state fields (persisted):
  - [x] Per-stream cursor state (provider-specific) in `sync_states.cursor_state`.
  - [x] Per-connection sync rollups in `connections.last_sync_*`.
  - [x] Backfill/live progress is tracked via durable jobs (`background_job` + `sync_job_history`) and emitted via SSE sync events.
  - [x] Job idempotency keys for scheduled syncs and backfill windows (no duplicate work on retries/restarts).
- [x] Enforce idempotent ingestion using `provider_item_id + content_hash`.
- [x] Align “sync jobs” with the durable job plane (Phase 0.5) so backfills/syncs are lease-based and restart-safe.

**Acceptance**
- Backfills can be stopped/restarted without duplicating data; live runs can recover from crashes.

### 1.2 Connector health + progress APIs (for web + admin)
- [x] Add endpoints to:
  - [x] List available connectors with `configured: bool` + missing env var hints (dev-friendly).
  - [x] List connected sources for the org with backfill progress and live status.
  - [x] Trigger backfill and trigger a live sync run manually.
  - [x] Fetch per-connector job history and current cursor/watermark.
- [x] Add SSE channel for connector events (progress updates + error changes).

**Acceptance**
- The Connected Sources page shows real-time progress without refresh and never 500s.

### 1.3 Web app: source connection flow overhaul
- [x] Ensure the onboarding “Connect Sources” step:
  - [x] shows connector categories (Email/Messaging/Docs/CRM/Calendar/DB/Storage)
  - [x] shows `Not configured` vs `Ready` clearly
  - [x] supports connect, disconnect, retry
  - [x] shows backfill progress + ETA
  - [x] shows live ingestion status indicator
- [x] Ensure a user can connect multiple sources and see aggregated ingestion state.

**Acceptance**
- New org flow: connect Gmail (or any configured connector) -> backfill starts -> progress visible -> live status becomes “running”.

### 1.4 Pilot-Critical Connector Hardening (OAuth Connect + Durable Sync/Backfill)

These are the connectors required for pilots (legal/accounting) and for "wow factor" demos.

**Email**
- [x] Gmail: OAuth connect, token refresh, durable sync/backfill, dedup/idempotency.
- [x] Outlook: OAuth connect, token refresh, durable sync/backfill, dedup/idempotency.

**Messaging**
- [x] Slack: OAuth connect, durable sync/backfill, retry/backoff.
- [x] Teams: OAuth connect, durable sync/backfill, retry/backoff.
- [x] WhatsApp: webhook verification + durable ingestion path.

**Productivity**
- [x] Notion: OAuth connect + durable sync/backfill.
- [x] Google Docs: OAuth connect + durable sync/backfill.

**Calendar**
- [x] Google Calendar: OAuth connect + durable sync/backfill.

**CRM**
- [x] HubSpot: OAuth connect + durable sync/backfill.

**Deferred (post-pilot / later phases)**
- [ ] Postgres: connect, snapshot ingestion + optional CDC later.
- [ ] MySQL: connect, snapshot ingestion + optional CDC later.
- [ ] MongoDB: connect, snapshot ingestion + optional change streams later.
- [ ] S3: connect, backfill object listings + incremental polling.
- [ ] BigQuery: connect, backfill dataset snapshots + periodic refresh.
- [ ] Document connector: large uploads + parsing + “Smart Drive” UI (Phase 9).

**Acceptance**
- OAuth connectors either complete OAuth initiation or return a clear “not configured” 400 (never 500).
- Backfills/syncs are restart-safe (durable jobs) and progress is observable via SSE + history.

### 1.5 Tests for connector contract
- [x] Add unit tests for:
  - [x] state persistence (cursor update rules)
  - [x] idempotency (same provider id/hash does not duplicate)
  - [x] error taxonomy mapping
- [x] Add integration tests (docker) for at least:
  - [x] “list connectors” endpoint
  - [x] “connect source” endpoint behavior when env missing (returns 400 with message)
  - [x] “trigger backfill” creates a job record and updates status

---

## Phase 2: Team Model and Permissions (Who Sees What)

### 2.1 Define roles + policy primitives
- [x] Implement org roles: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- [ ] Define permission matrix:
  - [ ] invite/remove members
  - [ ] connect sources
  - [ ] mark source private/shared
  - [ ] view private sources
  - [ ] export data
  - [ ] manage org settings
- [x] Add a source-level visibility flag: `ORG_SHARED` vs `PRIVATE`.

**Acceptance**
- A member cannot see private sources from another user; admins can manage shared sources.

### 2.2 UI: team settings consistency
- [ ] Team pages show:
  - [ ] members + roles
  - [ ] invitation flow
  - [ ] org policies (allowed sources, default visibility)
- [ ] Source connection UI displays who owns a connection and whether it’s shared/private.

**Acceptance**
- All team pages load without fetch errors; role changes take effect immediately.

### 2.3 “Private memory” boundaries
- [ ] Ensure derived intelligence respects the source visibility boundary:
  - [ ] UIOs extracted from private sources are private by default
  - [ ] Aggregations and dashboards must not leak private objects
- [ ] Provide UI affordance to explicitly “Share this source with org” (with audit log).

---

## Phase 3: Command Bar (“Intent Bar”) Rework

### 3.1 Define command taxonomy + routing
- [x] Define modes:
  - [x] Ask (evidence-grounded)
  - [x] Find (semantic search)
  - [x] Build (continuum creation/edit)
  - [x] Act (stage/approve/execute actuations)
  - [x] Inspect (evidence lens, contradictions, timeline)
- [ ] Define command registry (actions, keyboard shortcuts, availability rules).

### 3.2 Implement evidence-first ask/search
- [x] Ask returns:
  - [x] structured answer blocks with citations
  - [ ] “I can’t find evidence” refusal path (no hallucinations)
- [ ] Search returns:
  - [ ] docs + messages + UIOs + continuums with filters

### 3.3 Command bar UI integration
- [ ] Make command bar context-aware:
  - [ ] current route
  - [ ] selected objects
  - [ ] active org and role
- [ ] Add “debug view” for command executions (request id, latency, citations count).

**Acceptance**
- A user can open the command bar and:
  - [ ] find a decision by natural language
  - [ ] open its evidence in one step
  - [ ] start a continuum from the exchange

---

## Phase 4: New Admin App (`apps/admin`) at `admin.drovi.co`

### 4.1 App scaffolding
- [ ] Create `apps/admin` with the same UI primitives and styles as `apps/web`.
- [ ] Use the same API client patterns as web (shared packages if possible).
- [ ] Sidebar collapsed by default; add “TV mode” full-screen layout.

### 4.2 Admin authentication
- [ ] Implement email/password login for admin app:
  - [ ] only allow `@drovi.co` emails
  - [ ] require env-configured admin password policy (rotateable)
- [ ] Add server-side enforcement on drovi-intelligence:
  - [ ] an “admin session” concept or admin-only endpoints protected by role/domain.

**Acceptance**
- Non-`@drovi.co` users cannot access admin; no admin UI appears in the main web app.

### 4.3 KPI dashboard (live without refresh)
- [ ] Define KPIs:
  - [ ] org count, user count, active users
  - [ ] connected sources count by type
  - [ ] ingestion throughput and lag
  - [ ] backfill success rate
  - [ ] error rate and top failing endpoints
  - [ ] MRR (if billing exists), plan distribution
- [ ] Build SSE-backed widgets (or polling with strong caching as fallback).

### 4.4 Admin operations pages
- [ ] Orgs: list/search -> org detail (members, sources, usage, flags).
- [ ] Users: list/search -> user detail (sessions, resets).
- [ ] Connectors: config status, failures, retry.
- [ ] Jobs: queue lag and job replay.
- [ ] Exchange moderation: publish/unpublish bundles.

---

## Phase 5: Support Tooling (Tickets + Email Ingestion + Resend Outbound)

### 5.1 Ticket data model + APIs
- [ ] Add tables:
  - [ ] `support_ticket`
  - [ ] `support_ticket_message`
  - [ ] `support_ticket_attachment` (optional)
- [ ] Add endpoints:
  - [ ] create ticket (web)
  - [ ] list tickets (admin)
  - [ ] update ticket status/assignee (admin)
  - [ ] add message (admin -> user, user -> admin)
- [ ] Add audit logging for ticket updates.

### 5.2 Web app: “Contact support” flow
- [ ] Add a support modal accessible from:
  - [ ] settings
  - [ ] error states (“Report this issue”)
- [ ] Auto-attach diagnostics:
  - [ ] org id, user id
  - [ ] current route
  - [ ] last API request id / endpoint (if available)
  - [ ] connector statuses snapshot

### 5.3 Inbound email -> tickets
- [ ] Choose inbound email strategy and implement:
  - [ ] inbound webhook endpoint that receives emails
  - [ ] parsing and threading (match `[#ticket-123]` in subject or headers)
  - [ ] spam filtering and basic validation

### 5.4 Outbound ticket notifications
- [ ] Implement outbound email sending for ticket updates via Resend.
- [ ] Add templates (FR/EN) and link back to the app ticket view.

**Acceptance**
- Creating a ticket from the web app appears immediately in admin and sends a confirmation email.

---

## Phase 6: Observability (Prometheus + Grafana + Alerts)

### 6.1 Prometheus + Grafana in docker compose (dev/prod parity)
- [ ] Add Prometheus service scraping:
  - [ ] drovi-intelligence `/metrics`
  - [ ] worker/scheduler metrics (if exposed)
  - [ ] Postgres exporter
  - [ ] Redis exporter
  - [ ] Kafka/Redpanda exporter
  - [ ] object store exporter (MinIO / R2 is external)
- [ ] Add Grafana with provisioning:
  - [ ] datasources
  - [ ] dashboards
  - [ ] alert rules

### 6.2 SLOs (pilot-grade)
- [ ] Define SLOs:
  - [ ] time-to-first-data after connect
  - [ ] backfill throughput
  - [ ] new-event ingestion freshness
  - [ ] API p95 latency
  - [ ] extraction success rate
  - [ ] evidence completeness rate
- [ ] Implement alerting (Slack/email).

**Acceptance**
- A single Grafana dashboard answers “Is the pilot healthy?” in < 30 seconds.

---

## Phase 7: Porter Deployment Trial

### 7.1 Production blueprint doc
- [ ] Write deployment doc:
  - [ ] required env vars and secrets
  - [ ] required managed services
  - [ ] persistent volumes / backups if self-hosted
  - [ ] domain routing and TLS

### 7.2 K8s manifests expansion
- [ ] Expand `k8s/` manifests to include:
  - [ ] worker
  - [ ] scheduler
  - [ ] redis
  - [ ] kafka/redpanda
  - [ ] falkordb
  - [ ] object store strategy (MinIO in cluster or R2 external)
- [ ] Add smoke test job in k8s that hits `/health` and performs a trivial authenticated request.

### 7.3 Deploy to Porter (trial)
- [ ] Perform a trial deployment and document:
  - [ ] time to deploy
  - [ ] missing secrets
  - [ ] bottlenecks or required managed components

**Acceptance**
- A Porter cluster can run the stack with web + API reachable and healthy.

---

## Phase 8: Localization (French + English)

### 8.1 Shared i18n foundation
- [ ] Create a shared translation package (example: `packages/i18n`).
- [ ] Add a robust i18n framework for React apps (web + admin).
- [ ] Add locale selection + persistence (per user/org).

### 8.2 Translate all UI strings
- [ ] Replace hard-coded strings in:
  - [ ] auth
  - [ ] onboarding
  - [ ] sources/connectors
  - [ ] dashboards
  - [ ] command bar
  - [ ] errors and empty states
- [ ] Add tests to detect missing translation keys.

### 8.3 Email template localization
- [ ] Provide FR/EN for:
  - [ ] onboarding emails/invites
  - [ ] support tickets
  - [ ] briefs/reports (if emailed)

**Acceptance**
- Switching language changes all primary flows without broken layouts.

---

## Phase 9: R2 + Scalable Document Upload + Extraction Foundation

### 9.1 R2 storage integration
- [ ] Add config for S3-compatible storage to target R2:
  - [ ] endpoint, region, credentials, path style
- [ ] Add a driver abstraction: `MINIO` (dev) vs `R2` (prod).
- [ ] Ensure evidence objects are immutable and addressed by content hash.

### 9.2 Large file uploads (multipart + resumable)
- [ ] Implement upload APIs:
  - [ ] create upload session
  - [ ] get pre-signed URLs (multipart)
  - [ ] complete upload
- [ ] Web app UI:
  - [ ] upload manager with progress
  - [ ] retry on failure
  - [ ] background uploads

### 9.3 Parsing + OCR + layout-aware evidence spans
- [ ] PDF parsing:
  - [ ] text extraction for digital PDFs
  - [ ] OCR for scanned PDFs/images
  - [ ] store page + bounding box spans for citations
- [ ] DOCX parsing:
  - [ ] section/paragraph extraction
  - [ ] maintain positional anchors for citations
- [ ] Store derived artifacts:
  - [ ] raw text chunks
  - [ ] span index
  - [ ] per-chunk content hash

### 9.4 Document intelligence pipeline integration
- [ ] Convert parsed chunks into UEM events.
- [ ] Run multi-pass extraction on docs:
  - [ ] commitments/decisions/risks/claims/advice
  - [ ] evidence links required
- [ ] Embed chunks and index for search.

**Acceptance**
- Upload a PDF -> it becomes searchable -> extracted objects show evidence spans with page references.

---

## Phase 10: Smart Drive UI (Docs as a First-Class Surface)

### 10.1 Drive IA and UX
- [ ] Add Drive pages:
  - [ ] file browser (folders/tags)
  - [ ] matter views (legal/accounting)
  - [ ] semantic search within a folder/matter
- [ ] Evidence highlighting viewer:
  - [ ] open a PDF and highlight cited spans
  - [ ] click from a UIO to the exact page region

### 10.2 “Ask this folder/matter”
- [ ] Add Q&A scoped to a folder/matter:
  - [ ] evidence-first answers
  - [ ] refusal if no evidence
  - [ ] export/shareable brief output

**Acceptance**
- Demo: “Show me where we said the client approved X” -> exact PDF/email highlight in < 2 clicks.

---

## Phase 11: Pilot Features for Legal + Accounting (Killer Features)

### 11.1 Legal data model: Matters + Advice objects
- [ ] Add `matter` model:
  - [ ] client
  - [ ] matter id/name
  - [ ] members/roles
  - [ ] tags
- [ ] Add `advice` UIO type with:
  - [ ] exact wording
  - [ ] author identity
  - [ ] validFrom/validTo
  - [ ] evidence spans

### 11.2 Legal Feature #1: Advice Timeline (“Git history for advice”)
- [ ] Timeline UI by matter:
  - [ ] chronological advice entries
  - [ ] supersession chain with diffs
  - [ ] evidence lens always available

### 11.3 Legal Feature #2: Contradiction & Drift Detection
- [ ] Contradiction detection:
  - [ ] against prior advice (semantic + structured constraints)
  - [ ] across lawyers/threads
- [ ] Drift detection:
  - [ ] advice changed without explicit notice
  - [ ] outgoing drafts conflict with current stance

### 11.4 Legal Feature #3: Show Me Where We Said That
- [ ] One-click “show evidence” for any claim/advice:
  - [ ] email quote
  - [ ] doc highlight
  - [ ] transcript timestamp

### 11.5 Legal Feature #4: Risk-Weighted Matters
- [ ] Matter risk score model:
  - [ ] contradictions unresolved
  - [ ] deadlines approaching/missed
  - [ ] missing confirmations
  - [ ] long silences
  - [ ] outstanding commitments
- [ ] Risk dashboard for partners (sorted by risk).

### 11.6 Legal Feature #5: Proof-First AI
- [ ] Evidence-first Q&A and brief generation for matters:
  - [ ] citations mandatory
  - [ ] refusal on insufficient evidence
  - [ ] confidence reasoning

### 11.7 Accounting pilot features (parallel)
- [ ] Define accounting “Engagement” model (or reuse matters).
- [ ] Build 5 accounting killer surfaces:
  - [ ] engagement timeline
  - [ ] PBC requests ledger (client-provided items)
  - [ ] deadline drift detection
  - [ ] variance explanation memory
  - [ ] proof-first audit trail exports

**Acceptance**
- A partner can open a matter and immediately see: advice history, what changed, what is risky, and where the evidence is.

---

## Phase 12: Drovi Draft (Proof-Integrated Drafting)

### 12.1 Draft editor foundation
- [ ] Add a drafting surface (doc editor) that:
  - [ ] supports rich text
  - [ ] supports inserting citations from evidence search
  - [ ] stores drafts as versioned artifacts (and evidence)

### 12.2 “Verify” mode (coverage + contradictions)
- [ ] Coverage analysis:
  - [ ] identify key claims
  - [ ] ensure citations exist for high-stakes claims
- [ ] Contradiction scan:
  - [ ] compare to matter advice history and commitments
  - [ ] produce fix suggestions and required acknowledgements

### 12.3 Export + share
- [ ] Export to DOCX/PDF.
- [ ] Store exported doc as evidence linked to the matter.
- [ ] Send via email (with citations link back to Drovi).

**Acceptance**
- Demo: draft a memo -> verify -> it flags a contradiction -> fix -> export -> stored and appears in the matter timeline.

---

## Cross-Cutting “Done Means Done” Gates

### Quality gates
- [ ] Add a small golden dataset for:
  - [ ] doc parsing
  - [ ] advice extraction
  - [ ] contradiction detection
  - [ ] evidence linking
- [ ] Add regression tests that measure:
  - [ ] evidence completeness rate
  - [ ] contradiction false positive rate
  - [ ] latency budgets (API p95)

### Security and compliance
- [ ] Secret scanning and removal of hard-coded secrets.
- [ ] Data retention + deletion flows (per org).
- [ ] Audit log completeness for:
  - [ ] source connections
  - [ ] sharing changes
  - [ ] admin actions
  - [ ] ticket actions

### End-to-end pilot simulation
- [ ] “Pilot rehearsal” script:
  - [ ] create org
  - [ ] invite 5 users
  - [ ] connect sources
  - [ ] upload a doc bundle
  - [ ] verify matter/advice timeline populates
  - [ ] run risk dashboard
  - [ ] create support ticket
