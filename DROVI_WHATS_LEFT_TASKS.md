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

## Status (2026-02-06)

**Completed (implemented + passing local gates)**
- [x] Phase 0.1: repo “green build” gates (`bun run green`) + CI build/test/docker/smoke workflow.
- [x] Phase 0.3: standardized API error taxonomy + UI surfaces (banner + per-page panel).
- [x] Phase 3 (partial): global Intent Bar (`Cmd/Ctrl+K`) with Ask/Search wired to drovi-intelligence.
- [x] Phase 2 (partial backend): connection ownership + `org_shared/private` visibility + access checks + SSE filtering

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
- 
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
- [ ] Write a short internal ADR (architecture decision record) that states:
  - [ ] Kafka is the **event plane** (ingestion + pipeline + graph change streaming)
  - [ ] Background “commands” (sync/backfill/reports/maintenance) run via a **durable job plane**
  - [ ] We will not introduce a parallel job system like BullMQ in Node (avoid split-brain)
- [ ] Decide the durable job plane implementation:
  - [ ] Option A (recommended): Postgres-backed job queue (leases + SKIP LOCKED) + worker pool
  - [ ] Option B: Celery + Redis/RabbitMQ (requires deploying celery worker + beat and removing APScheduler duplication)
  - [ ] Option C: Temporal (bigger lift; strongest reliability/visibility)

**Acceptance**
- One job system is selected; all future work is aligned to it.

### 0.5.2 Kafka hardening: DLQ + bounded retries + replay tooling
- [ ] Add explicit retry/DLQ strategy per topic:
  - [ ] `raw.connector.events`
  - [ ] `normalized.records`
  - [ ] `intelligence.pipeline.input`
  - [ ] `graph.changes` (if any processing occurs; otherwise keep “firehose”)
- [ ] Implement poison-message protection in `drovi-intelligence/src/streaming/kafka_consumer.py`:
  - [ ] On handler exception, do not retry forever.
  - [ ] Re-publish to retry topic with incremented retry count and backoff metadata OR publish to DLQ after N retries.
  - [ ] Commit the original offset once routed (so the partition does not stall).
- [ ] Add a small CLI/tooling module to:
  - [ ] inspect DLQ messages
  - [ ] replay a DLQ message (or a range) back to the main topic
  - [ ] permanently drop a message with an audit log entry
- [ ] Add metrics:
  - [ ] retries routed
  - [ ] DLQ routed
  - [ ] per-topic handler error rate
  - [ ] end-to-end pipeline lag (by content_hash / event timestamp)
- [ ] Add tests:
  - [ ] unit tests for “handler throws -> message routed -> offset committed”
  - [ ] integration test in docker that injects a poison message and confirms the worker continues processing subsequent messages

**Acceptance**
- One poison message cannot wedge a consumer group; failures are visible and replayable.

### 0.5.3 Scheduler durability: schedule rehydration and reconciliation
- [ ] Make `drovi-scheduler` rehydrate connection schedules from DB on startup:
  - [ ] query active connections with `sync_enabled = true`
  - [ ] schedule each with its stored interval/cron
- [ ] Add a periodic “reconcile schedules” job:
  - [ ] every N minutes, ensure APScheduler jobs match DB (added/removed/interval changed)
- [ ] Add a “global kill switch” config:
  - [ ] disable all scheduled syncs without redeploying (for incident response)

**Acceptance**
- Restarting `drovi-scheduler` does not stop live ingestion; schedules recover automatically.

### 0.5.4 Durable job plane (sync/backfill/reports/maintenance)
- [ ] Implement the chosen durable job mechanism (from 0.5.1) with:
  - [ ] job records persisted in Postgres (status, args, run_at, attempts, max_attempts, lease_until)
  - [ ] strict idempotency keys for connector jobs (connection_id + window + stream + full_refresh)
  - [ ] cancel/retry semantics
  - [ ] per-connection concurrency cap (never run 2 syncs for same connection concurrently)
  - [ ] provider rate limiting (org-level and connection-level budgets)
- [ ] Move long-running executions out of APScheduler:
  - [ ] scheduler enqueues jobs only
  - [ ] workers execute jobs
  - [ ] progress is emitted via sync events (Redis/SSE) and persisted in DB
- [ ] Migrate periodic tasks to jobs:
  - [ ] weekly/daily reports
  - [ ] candidate processing
  - [ ] evidence retention cleanup
  - [ ] decay computation
  - [ ] webhook outbox flush
- [ ] Add admin endpoints:
  - [ ] list jobs by type/status/org
  - [ ] cancel job
  - [ ] retry job
  - [ ] replay failed job with overrides

**Acceptance**
- Connector backfills and scheduled syncs continue across restarts, are visible, and can be replayed deterministically.

### 0.5.5 Celery cleanup (or activation)
- [ ] If we choose not to use Celery:
  - [ ] delete Celery config/tasks to avoid split-brain, or mark as explicitly deprecated with a clear comment
- [ ] If we choose to use Celery:
  - [ ] add `celery-worker` + `celery-beat` containers to docker compose
  - [ ] remove APScheduler duplication and make Celery the single scheduler/runner for commands

---

## Phase 1: Connector Contract + Backfill + Live Sync (All Sources “Plugged In”)

### 1.1 Canonical connector state + idempotency
- [ ] Define canonical connector state fields (persisted):
  - [ ] `cursor` (provider-specific)
  - [ ] `watermark` (UTC time)
  - [ ] `backfill_status` (`NOT_STARTED|RUNNING|PAUSED|DONE|ERROR`)
  - [ ] `live_status` (`RUNNING|PAUSED|ERROR`)
  - [ ] `last_success_at`, `last_error_at`, `last_error_code`, `last_error_message`
  - [ ] `items_ingested_total`, `items_ingested_last_24h`
- [ ] Enforce idempotent ingestion using `provider_item_id + content_hash`.
- [ ] Align “sync jobs” with the durable job plane (Phase 0.5) so backfills/syncs are lease-based and restart-safe.

**Acceptance**
- Backfills can be stopped/restarted without duplicating data; live runs can recover from crashes.

### 1.2 Connector health + progress APIs (for web + admin)
- [ ] Add endpoints to:
  - [ ] List available connectors with `configured: bool` + missing env var hints (dev-friendly).
  - [ ] List connected sources for the org with backfill progress and live status.
  - [ ] Trigger backfill and trigger a live sync run manually.
  - [ ] Fetch per-connector job history and current cursor/watermark.
- [ ] Add SSE channel for connector events (progress updates + error changes).

**Acceptance**
- The Connected Sources page shows real-time progress without refresh and never 500s.

### 1.3 Web app: source connection flow overhaul
- [ ] Ensure the onboarding “Connect Sources” step:
  - [ ] shows connector categories (Email/Messaging/Docs/CRM/Calendar/DB/Storage)
  - [ ] shows `Not configured` vs `Ready` clearly
  - [ ] supports connect, disconnect, retry
  - [ ] shows backfill progress + ETA
  - [ ] shows live ingestion status indicator
- [ ] Ensure a user can connect multiple sources and see aggregated ingestion state.

**Acceptance**
- New org flow: connect Gmail (or any configured connector) -> backfill starts -> progress visible -> live status becomes “running”.

### 1.4 Connector-by-connector hardening (repeat for each)

For each connector, execute the same checklist:

**Email**
- [ ] Gmail: OAuth connect, token refresh, backfill windowing (recent first), live (polling + webhook if enabled), dedup.
- [ ] Outlook: OAuth connect, token refresh, backfill windowing, live (polling), dedup.

**Messaging**
- [ ] Slack: OAuth/token connect (as implemented), backfill channels, live events/webhooks, retry/backoff.
- [ ] Teams: connect, backfill, live ingestion, retry/backoff.
- [ ] WhatsApp: webhook verification, backfill if supported, live ingestion.

**Productivity**
- [ ] Notion: connect, backfill DB/pages, incremental updates.
- [ ] Google Docs: connect, backfill docs, incremental updates.

**Calendar**
- [ ] Google Calendar: connect, backfill events, incremental updates.

**CRM**
- [ ] HubSpot: connect, backfill contacts/companies/deals, incremental updates.

**Databases**
- [ ] Postgres: connect, snapshot ingestion + optional CDC if supported later.
- [ ] MySQL: connect, snapshot ingestion + optional CDC later.
- [ ] MongoDB: connect, snapshot ingestion + optional change streams later.

**Storage**
- [ ] S3: connect, backfill object listings + incremental polling.
- [ ] BigQuery: connect, backfill dataset snapshots + periodic refresh.

**Files**
- [ ] Document connector: upload/backfill folder, parse pipeline, incremental indexing.

**Acceptance**
- Every connector either works end-to-end when configured, or returns a clear “not configured” error (never 500).

### 1.5 Tests for connector contract
- [ ] Add unit tests for:
  - [ ] state persistence (cursor/watermark update rules)
  - [ ] idempotency (same provider id/hash does not duplicate)
  - [ ] error taxonomy mapping
- [ ] Add integration tests (docker) for at least:
  - [ ] “list connectors” endpoint
  - [ ] “connect source” endpoint behavior when env missing (returns 400 with message)
  - [ ] “trigger backfill” creates a job record and updates status

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
- [x] Add Prometheus service scraping:
  - [x] drovi-intelligence `/metrics`
  - [x] worker/scheduler metrics (if exposed)
  - [x] Postgres exporter
  - [x] Redis exporter
  - [x] Kafka/Redpanda exporter
  - [x] object store exporter (MinIO / R2 is external)
- [x] Add Grafana with provisioning:
  - [x] datasources
  - [x] dashboards
  - [x] alert rules

### 6.2 SLOs (pilot-grade)
- [x] Define SLOs:
  - [x] time-to-first-data after connect
  - [x] backfill throughput
  - [x] new-event ingestion freshness
  - [x] API p95 latency
  - [x] extraction success rate
  - [x] evidence completeness rate
- [x] Implement alerting (Slack/email).

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
- [x] Create a shared translation package (example: `packages/i18n`).
- [x] Add a robust i18n framework for React apps (web + admin).
- [x] Add locale selection + persistence (per user/org).

### 8.2 Translate all UI strings
- [x] Replace hard-coded strings in:
  - [x] auth
  - [x] onboarding
  - [x] sources/connectors
  - [x] dashboards
  - [x] command bar
  - [x] errors and empty states
- [x] Add tests to detect missing translation keys.

### 8.3 Email template localization
- [x] Provide FR/EN for:
  - [x] onboarding emails/invites
  - [x] support tickets
  - [x] briefs/reports (if emailed)

**Acceptance**
- Switching language changes all primary flows without broken layouts.

---

## Phase 9: Scalable Document Upload + Extraction Foundation

### 9.1 storage integration
- [x] Add config for S3:
  - [x] endpoint, region, credentials, path style, for dev and prod
- [x] Ensure evidence objects are immutable and addressed by content hash.

### 9.2 Large file uploads (multipart + resumable)
- [x] Implement upload APIs:
  - [x] create upload session
  - [x] get pre-signed URLs (multipart)
  - [x] complete upload
- [x] Web app UI:
  - [x] upload manager with progress
  - [x] retry on failure
  - [x] background uploads

### 9.3 Parsing + OCR + layout-aware evidence spans
- [x] PDF parsing:
  - [x] text extraction for digital PDFs
  - [x] OCR for scanned PDFs/images
  - [x] store page + bounding box spans for citations
- [x] DOCX parsing:
  - [x] section/paragraph extraction
  - [x] maintain positional anchors for citations
- [x] Store derived artifacts:
  - [x] raw text chunks
  - [x] span index
  - [x] per-chunk content hash

### 9.4 Document intelligence pipeline integration
- [x] Convert parsed chunks into UEM events.
- [x] Run multi-pass extraction on docs:
  - [x] commitments/decisions/risks/claims/advice
  - [x] evidence links required
- [x] Embed chunks and index for search.

**Acceptance**
- Upload a PDF -> it becomes searchable -> extracted objects show evidence spans with page references.

---

## Phase 10: Smart Drive UI (Docs as a First-Class Surface)

### 10.1 Drive IA and UX
- [x] Add Drive pages:
  - [x] file browser (folders/tags)
  - [x] semantic search within a folder
- [x] Evidence highlighting viewer:
  - [x] open a PDF and highlight cited spans
  - [x] click from a UIO to the exact page region

### 10.2 “Ask this folder”
- [x] Add Q&A scoped to a folder:
  - [x] evidence-first answers
  - [x] refusal if no evidence
  - [x] export/shareable brief output

**Acceptance**
- Demo: “Show me where we said the client approved X” -> exact PDF/email highlight in < 2 clicks.

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
