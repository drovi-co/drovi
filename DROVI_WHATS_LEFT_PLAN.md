# Drovi "What's Left" Plan (Pilot-Grade + Scale-Grade)

This plan turns the current stack into a pilot-ready, enterprise credible system for 250+ seat legal and accounting firms, while preserving Drovi’s north star: **proof-first, bi-temporal organizational memory** that is fast enough to feel magical and rigorous enough to be trusted.

This is intentionally not “MVP thinking”. It is a path to a product that feels obligatory because it **never loses commitments, never fabricates claims, and always shows evidence**.

## North Star Behaviors (What Users Should Feel)

1. **Proof before prose**
   - Any claim Drovi emits can be opened into a precise supporting span (email quote, doc page region, transcript timestamp).
   - High-stakes objects (decisions, commitments, risks, advice) have an enforced policy: `No Evidence -> No Persist`.
2. **Time is first-class**
   - Every intelligence object supports “what did we believe on date X?” and “what changed since last time?”
3. **Ingestion feels inevitable**
   - First connection starts a reliable backfill immediately (visible progress, resumable).
   - New updates arrive quickly and predictably (polling + webhooks where possible).
4. **Teams can trust the boundary**
   - Clear rules for who can connect sources, what’s shared org-wide, what can be private, what gets exported.
5. **The UI never breaks**
   - No “failed to fetch” ambiguity; we always show whether the API is down, auth expired, or connector not configured.

## What’s Left (Workstreams)

### A0) Execution Plane: Background Jobs + Kafka Event Fabric (Unbreakable)

Drovi already has multiple “async” mechanisms in play. Before scaling pilots, we should harden this into an explicit, durable execution plane.

**What we are using today (as implemented in the repo)**
- **Kafka/Redpanda**: the event fabric for ingestion and pipeline processing.
  - Connectors and webhooks emit `raw.connector.events`.
  - An ingestion normalizer (`drovi-ingestion-worker`, Go) produces `normalized.records`.
  - A streaming worker (`drovi-worker`, Python) enriches and produces `intelligence.pipeline.input`, runs the extraction pipeline, and emits `graph.changes` for UI streaming.
- **APScheduler** (`drovi-scheduler`, Python): schedules and executes connector sync/backfill and periodic jobs (candidate processing, reports, webhooks outbox flush, maintenance).
- **Redis**: ephemeral coordination (OAuth state, sync event fanout/SSE utilities, caches).
- **Celery**: present in code as an optional/alternate distributed task queue, but not currently deployed in `docker-compose.yml`.

**What Kafka is used for (and what it is not)**
- Kafka is being used as:
  - an event log and buffering layer between connector I/O and the intelligence pipeline,
  - a scaling boundary (consumer groups for the pipeline),
  - a low-latency channel for streaming change events to the UI.
- Kafka is not (currently) used as:
  - a general-purpose delayed job scheduler (backoff, cron, long-lived workflows), which is why we still have APScheduler for “commands”.

**Why hardening is needed**
- APScheduler jobs are not persisted as schedules; a restart can drop per-connection schedules unless they are rehydrated from DB on boot.
- Kafka consumers currently “retry forever” on handler exceptions, which can create poison-message stalls without a DLQ/retry strategy.
- Connector backfills and long syncs are executed in the scheduler process; we need the ability to distribute work, lease it, retry it, and replay it predictably.

**Target-state (“unbreakable”) design**
- **Event plane** stays Kafka:
  - `raw.connector.events` -> `normalized.records` -> `intelligence.pipeline.input` -> graph + DB writes -> `graph.changes`.
  - Add DLQ and bounded retry semantics per topic.
- **Command plane** becomes durable jobs/workflows:
  - Connector syncs/backfills and other background work run as **durable jobs** with leases, retries, and full visibility.
  - Scheduler becomes a lightweight “enqueue due work” service, not the executor.
  - Workers execute jobs and emit progress to Redis and state to Postgres, then push events to Kafka for downstream processing.

**Do we need BullMQ?**
- Not really. BullMQ is Node/Redis-first and would add a parallel job system in a Python stack that already has Kafka + Postgres + optional Celery.
- If we want “enterprise-grade unbreakable”, the two best fits here are:
  - A **DB-backed durable job queue** (Postgres `SKIP LOCKED` + leases) for commands, plus Kafka for events.
  - Or adopting a workflow engine like **Temporal** for connector backfills and continuums (bigger lift, huge reliability/visibility wins).

### A) Connectors: Production-Grade Backfill + Live Sync

**Goal**: Every connector listed in `drovi-intelligence/src/connectors/sources/**` can:
1. Connect reliably (OAuth or credentials)
2. Backfill fully (resumable, windowed, idempotent)
3. Live ingest (webhooks if supported, otherwise bounded polling)
4. Expose health + progress to the web app (and admin app)

**Connectors currently in the codebase**
- Email: Gmail, Outlook
- Messaging: Slack, Teams, WhatsApp
- Productivity: Notion, Google Docs
- Calendar: Google Calendar
- CRM: HubSpot
- Databases: Postgres, MySQL, MongoDB
- Storage: S3, BigQuery
- Files: Document connector (internal uploads + external bucket indexing)

**Key upgrades needed**
- **One canonical sync contract**: `state` (cursor), `watermark` (time), `idempotency key` (provider id + content hash).
- **Backfill engine**: chunked by time windows and/or provider pagination, persisted state, resumable, rate limit aware.
- **Live engine**: hybrid webhook + periodic polling with jitter and per-org budgets.
- **Connector observability**: per-connector metrics, error taxonomy, retry/backoff, and “requires configuration” reporting.
- **Team-level configuration**: “org shared” vs “user private” connections (see Workstream D).

### B) Web App: Zero-Error Surfaces + Full Intelligence Utilization

**Goal**: `apps/web` becomes a reliable operator console for the intelligence layer.

Required outcomes:
- Every sidebar page loads without errors.
- No remaining tRPC or deleted TS server usage.
- Every page is powered by drovi-intelligence endpoints (and uses the modern concepts: evidence, bi-temporal, exchange, continuums, simulation, actuations).

Implementation principles:
- **Hard “API unreachable” diagnostics** (already started): show status, request id, and the failing endpoint.
- **Auth clarity**: “Not authenticated” means session expired; show an action that reauths cleanly.
- **Graceful “connector not configured” states**: UI should not throw; it should explain what env var is missing, for dev and for prod.

### C) Command Bar: A Real “Intent Bar” for the Web App

**Goal**: The command bar becomes the fastest way to:
- Ask with evidence (`Ask -> Answer -> Evidence`)
- Navigate objects (decisions/commitments/risks/tasks/patterns)
- Create/run continuums (templates from exchange, runbook-like operations)
- Trigger actuations safely (staged execution + approvals)
- Open a “Proof lens” for anything on screen

Think of it as a “control plane” that can switch modes:
- **Ask**: evidence-grounded Q&A
- **Find**: semantic search across evidence + objects
- **Build**: create/edit continuums (DSL or natural language -> DSL)
- **Act**: stage/approve/execute actuations
- **Inspect**: open evidence lens, timelines, contradictions

### D) Team Model: Who Sees What + Who Can Connect Sources

This is a pilot-critical decision because it changes the trust boundary.

Recommended model (simple but enterprise-friendly):
- **Org Workspace**: the default shared memory space.
- **Connections** are owned by a user but have a visibility flag:
  - `ORG_SHARED`: ingested evidence is visible to permitted org members (default for work systems).
  - `PRIVATE`: evidence and derived intelligence only visible to the owner (for personal accounts).
- **Roles**:
  - `OWNER`: billing + org settings + admin tasks
  - `ADMIN`: manage members, connectors, sources
  - `MEMBER`: can connect sources; can mark as private/org-shared (policy-based)
  - `VIEWER`: read only
- **Source policies** (org setting):
  - Allowed sources (e.g., disallow personal Gmail)
  - Default visibility (shared/private)
  - Allowed scopes (for legal compliance)

Legal/accounting pilots often require:
- Matter/client scoping (future): a way to restrict evidence by matter team.
- For the pilot: start with org + private scopes, plus “Matter Tagging” that can be used for dashboards.

### E) New Admin App: `apps/admin` at `admin.drovi.co`

**Goal**: A TV-friendly live dashboard and internal control center.

Constraints:
- Same design system, fonts, UI primitives as `apps/web`.
- Lives under `apps/admin` and deploys to `admin.drovi.co`.
- Only `@drovi.co` users can log in (email/password) with a fixed password policy.

Core pages (initial):
- **Live Dashboard (TV mode + normal mode)**: users/orgs, connector health, ingestion throughput, job lag, errors, MRR/plan distribution, pilots KPIs.
- **Orgs**: list/search, org detail with members, sources, usage, flags.
- **Users**: list/search, user detail, sessions, resets.
- **Connectors**: configuration status, failures, backfill progress, retry.
- **Jobs & Schedules**: worker/scheduler status, queue lag, failed jobs replay.
- **Tickets**: support queue (see Workstream F).
- **Exchange moderation**: review continuum bundles, publish/unpublish, featured.
- **Feature flags**: kill-switches for risky flows.

### F) Support Tooling: Tickets + Inbound Email + SLAs

**Goal**: “Support ticket” is a first-class object in drovi-intelligence, visible in admin and creatable from web.

Components:
- **Web app**: “Contact support” modal that creates a ticket with context (current route, request id, last API failure, screenshots/attachments).
- **Admin app**: ticket inbox with assignments, status, internal notes, and user-visible replies.
- **Inbound email**: `support@drovi.co` creates tickets (and threads replies onto existing tickets).
- **Outbound**: ticket updates and replies are sent via Resend.

Key “wow factor”: every ticket can automatically include a **diagnostic bundle** (org id, job ids, recent connector errors, evidence ingestion lag).

### G) Observability: Grafana + Prometheus + SLOs

**Goal**: Pilot ops must be calm. You need dashboards and alerting before seat count scales.

Minimum observability footprint:
- Prometheus scraping drovi-intelligence `/metrics` (already exists in `drovi-intelligence/src/monitoring/metrics.py`).
- Service health checks: API, worker, scheduler, Postgres, Redis, Kafka/Redpanda, object store, FalkorDB.
- Grafana dashboards:
  - Ingestion throughput and lag (per connector, per org)
  - Backfill progress (jobs, percent, ETA)
  - Extraction latency and success rate
  - Evidence completeness (evidence coverage rate by object type)
  - Contradiction detection stats (legal killer features)
  - Error rates and top failing endpoints
- Alerting:
  - API down, worker down, scheduler down
  - sustained ingestion lag > threshold
  - sustained error rate > threshold
  - DB saturation (connections, slow queries)

### H) Deployment: Porter Trial + Production Blueprint

**Goal**: Validate that Drovi can be deployed as a multi-service system reliably and predictably.

Recommended production posture for pilots:
- Managed Postgres (or very robust in-cluster Postgres with backups).
- Managed object storage (R2 in production).
- Redis as managed if possible.
- Kafka/Redpanda: managed if available; otherwise in cluster.
- Keep stateless services in k8s; keep stateful services managed.

Porter “trial deploy” plan:
- Use `k8s/` manifests as a base, expand for worker/scheduler/redis/kafka/falkordb/minio.
- Document secret management and required env variables in one place.
- Add smoke tests and a canary endpoint post-deploy.

### I) i18n: French + English Everywhere

**Goal**: Full localization for web, admin, and emails (support + briefs).

Scope:
- UI strings, errors, empty states
- Email templates
- Time/date formats and number formats
- “Evidence UI” and timeline labels

Approach:
- Central translation system shared across apps (`packages/i18n`).
- Treat i18n as “compile-time checked” (no missing keys).

### J) R2 + Document Intelligence + “Smart Drive”

**Goal**: Make docs ingestion feel inevitable and become the killer surface for legal/accounting.

Core capabilities:
- Upload and store at scale (multipart uploads, streaming, resumable).
- Parse + OCR + layout awareness (PDF, DOCX, images, scans).
- Evidence spans with page coordinates (for highlight + “show me where”).
- Extract: commitments/decisions/risks/claims/advice with evidence anchors.
- Embed + index for semantic search across documents (and cross-link with email/messaging).
- A “Smart Drive” UI:
  - Folder and tag structure (including “matters”)
  - “Ask this folder/matter”
  - Timeline view of what changed
  - “Show citations” by default

R2 plan:
- Use S3-compatible client, but configure explicitly for R2 (endpoint, region, path style, auth).
- Store immutable evidence artifacts by hash (dedup by content hash).
- Keep metadata + evidence pointers in Postgres; keep heavy bytes in R2.

### K) Pilot Readiness for 250+ Seat Legal + Accounting Firms

**Goal**: A repeatable “pilot package” you can deploy and run.

Core readiness checklist:
- Org provisioning at scale: bulk invites, role assignment, and source policies.
- Backfill throughput: show ETA, partial availability (“recent first”), and resumable sync.
- Correctness: evidence-anchored extraction with explicit confidence.
- Audit: decision/commitment/advice trails with bi-temporal history.
- Support: ticketing + diagnostics.
- Security: clear scope controls, data retention, export, and deletion.
- Performance: API p95 and ingestion SLOs.

### L) Legal: 5 Killer Features (Category-Defining)

These features make Drovi feel mandatory because they directly address partner-level risk.

1. **Advice Timeline** (“Git history for legal advice”)
   - Matter -> timeline of advice with exact wording, author, evidence links.
   - Supersession: show diffs and explicit “what changed”.
2. **Contradiction & Drift Detection**
   - Detect conflicts across time/lawyers and “silent reversals”.
   - Detect drift between current stance and outgoing drafts.
3. **Show Me Where We Said That**
   - One-click jump to original email paragraph / PDF page region / transcript timestamp.
4. **Risk-Weighted Matters**
   - Matter risk score driven by contradictions, deadlines, missing confirmations, long silences, outstanding commitments.
5. **Proof-First AI**
   - Q&A and brief generation that refuses to answer without evidence (“I can’t find evidence for that”).

Must-have enabling tech:
- Email + docs ingestion
- PDF/DOCX parsing with evidence spans
- Bi-temporal memory + entity versions
- Contradiction detection + temporal reasoning
- Timeline UI with evidence lens

Nice-to-have later:
- DMS integration (iManage)
- Matter linking to billing/timekeeping
- E-signature events
- Regulatory tracking

### M) “Drovi Draft” (Document Drafting Integrated With Proof)

**Goal**: Drafting is where trust becomes money. Lawyers/accountants live in docs.

Initial “Drovi Draft” surface:
- Rich editor with inline citations and evidence insertion.
- “Verify” mode:
  - Coverage: every key claim should be cited.
  - Contradictions: flags inconsistent statements against matter history.
  - Missing confirmations: identify where the client has not confirmed.
- Export to DOCX/PDF and store as evidence, linked to matter + advice timeline.

## Recommended Execution Order (Critical Path)

1. **Harden execution plane (jobs + Kafka retries/DLQ + schedule rehydration)** (A0)
2. **Stabilize connectors + source health UI** (A + B)
3. **Finalize team/permissions** (D)
4. **R2 + doc ingestion foundation** (J)
5. **Legal killer features foundation** (L enabling tech + initial UI)
6. **Admin + support + observability** (E + F + G)
7. **Porter deploy trial + i18n** (H + I)
8. **Drovi Draft** (M)

This ordering ensures the pilots have a credible ingestion story, proof-first UX, and operational readiness.
