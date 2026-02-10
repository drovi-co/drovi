# Drovi Extensibility Refactor Plan (Draft)

This document is intentionally decision-driven.

- It is based on what is currently in-repo (file size/coupling evidence included).
- It does **not** assume we will immediately rewrite everything.
- It proposes a path to a "kernel + vertical shells" architecture with strong testability and explicit extension points.
- It defers any code changes until you confirm the key architectural decisions in **AskUserQuestion**.

## Decision Log (Confirmed)

Stage 1 (Architecture): `1A, 2A, 3B, 4A, 5A, 6A`

Stage 2 (Code Quality): `7A, 8A, 9A, 10A, 11A, 12A, 13A`

Stage 3 (Tests): `14A, 15A, 16A, 17A, 18A, 19A`

Stage 4 (Performance): `20A, 21A, 22A, 23A, 24A, 25A, 26A`

Stage 5 (Frontend Modules): `27A, 28B, 29A, 30A`

Notes:

- Issue 3: The plan now assumes **Temporal** as the workflow engine for connector backfills/syncs/retries. Kafka remains the canonical event fabric.
- Issue 10: Updated to align with Issue 3B (no “enqueue-only per 3A” wording).
- Stage 3: Coverage gates + unit-test-first ports/fakes + Temporal workflow testing + frontend test pyramid + OpenAPI contract tests.
- Stage 4: Keyset pagination, dashboard query planning + pre-aggregates, bi-temporal indexing, outbox + async derived indexes, push updates, lazy presigned URLs.
- Stage 5: Frontend feature modules as packages + code-based route composition + typed overrides + backend manifest driven vertical runtime.

## What I Looked At (Concrete Evidence)

Backend (Python): `drovi-intelligence/src`

- Very large, multi-responsibility modules exist:
  - `drovi-intelligence/src/orchestrator/nodes/persist.py` (~3440 LOC in repo; 654 LOC inside container build) includes evidence linkage, embeddings, DB writes, graph writes, and temporal logic. See `drovi-intelligence/src/orchestrator/nodes/persist.py:1`.
  - `drovi-intelligence/src/uio/manager.py` (~2409 LOC in repo; 426 LOC in container build) owns tri-store sync and user correction logic. See `drovi-intelligence/src/uio/manager.py:1`.
  - `drovi-intelligence/src/api/routes/uios.py` (~2291 LOC) mixes HTTP models, auth/visibility policy, SQL, and lifecycle logic. See `drovi-intelligence/src/api/routes/uios.py:1`.
  - `drovi-intelligence/src/connectors/scheduling/scheduler.py` (~1456 LOC) uses in-memory APScheduler and contains job models + execution logic. See `drovi-intelligence/src/connectors/scheduling/scheduler.py:1`.

Frontend (web): `apps/web`

- The API client + types + transformers are centralized into a single very large file:
  - `apps/web/src/lib/api.ts` (~3352 LOC) includes dozens of interfaces, snake_to_camel transformations, and a fetch wrapper. See `apps/web/src/lib/api.ts:1`.
- A separate TS SDK already exists in `packages/intelligence-sdk`, suggesting duplication/drift risk:
  - `packages/intelligence-sdk/src/index.ts` and `packages/intelligence-sdk/src/client.ts`.

Tests (Python):

- Current backend coverage is ~42% overall (measured via `pytest --cov=src`). Large critical modules are under-tested:
  - `src/orchestrator/nodes/persist.py` ~6% coverage.
  - `src/uio/manager.py` ~11% coverage.
  - `src/graphrag/query.py` ~20% coverage.
  - `src/jobs/worker.py` and `src/streaming/worker.py` ~0% coverage.

The above is why the refactor needs to be architecture-first and test-first, not “shuffle files around”.

---

# Stage 1: Architecture Review (Decisions Required)

Below are the most load-bearing architectural issues that impact extensibility, correctness, and the ability to ship multiple vertical shells without the core becoming brittle.

Each issue includes:

- Concrete problem statement + references
- Options (A/B/C), with Option A recommended (per your preference)
- Tradeoffs: effort, risk, impact, and maintenance

## Issue 1: Cross-Layer Coupling + Giant Modules Make Extensibility Expensive

**Problem (concrete):**

- Domain logic, storage orchestration, and API layer logic are interwoven.
- Example: persistence logic touches evidence, embeddings, graph writes, temporal fields, and audit logging in one place. See `drovi-intelligence/src/orchestrator/nodes/persist.py:1-220`.
- Example: `UIOManager` imports orchestrator state (`drovi-intelligence/src/uio/manager.py:38`) while orchestrator nodes import `UIOManager` (`drovi-intelligence/src/orchestrator/nodes/persist.py:25`), creating a dependency cycle that makes modularity harder.

**Options:**

- **(A, Recommended) Modular monolith using Hexagonal (Ports/Adapters) + Bounded Context modules.**
  - Structure:
    - `src/kernel/` (Evidence, UEM, Identity, Auth primitives, shared utilities)
    - `src/contexts/<context>/domain/` (pure models + invariants)
    - `src/contexts/<context>/application/` (use-cases, ports)
    - `src/contexts/<context>/infrastructure/` (SQLAlchemy, Kafka, S3, Falkor adapters)
    - `src/contexts/<context>/presentation/` (FastAPI routers)
  - Split the biggest files into smaller units with explicit ports.
  - Effort: High (multi-week, systematic).
  - Risk: Medium (many moving pieces, but can be phased with adapter wrappers).
  - Impact: Strongly improves extensibility, testability, and DRY.
  - Maintenance: Lowest long-term, aligns with your preferences.

- **(B) “Service layer” extraction only (keep existing layout, add `services/` and move logic out of routes).**
  - Effort: Medium.
  - Risk: Medium-low.
  - Impact: Improves testability, but tends to rot without strict boundaries.
  - Maintenance: Medium (you still have many cross-imports).

- **(C) Do nothing (continue incremental fixes).**
  - Effort: Low.
  - Risk: High (core becomes harder to evolve; vertical shells become forks).
  - Impact: Short-term speed, long-term cost.
  - Maintenance: High (entropy increases).

**Opinionated recommendation: 1A.**

Mapped to your preferences:

- DRY: forces shared kernel + reusable ports rather than duplicating logic per vertical.
- Tests: ports/adapters naturally isolate hard-to-test infrastructure.
- Explicitness: avoids “magic”; dependencies are declared.

## Issue 2: Vertical Extensibility Is Not First-Class (Types Are Hardcoded)

**Problem (concrete):**

- Object types and fields are hard-coded as enums and type-specific logic is scattered.
  - Example: hard-coded `UIOType` enum in `drovi-intelligence/src/uio/schemas.py:21-32`.
  - Example: type-specific details exist, but the extension mechanism is not a stable plugin surface.
- Adding “Matter”, “Client”, “Advice”, “Filing”, etc will currently require edits to core enums, schemas, routes, and persistence, which will couple verticals to core releases.

**Options:**

- **(A, Recommended) “Kernel + Plugins” with a typed extension registry and storage strategy.**
  - Define `VerticalPlugin` contracts:
    - new object types (namespaced): `legal.matter`, `legal.advice`, etc
    - extraction specs (prompts, schemas, validators)
    - contradiction rules and timeline rendering hints
    - DB migrations for vertical tables OR JSONB extension schema with validators
  - Provide a stable `registry.py` loaded at startup (explicit list, no dynamic import magic).
  - Storage recommendation: hybrid
    - core `unified_intelligence_object` stays canonical
    - vertical typed tables for high-value query patterns
    - JSONB extension table for “long tail” fields, validated by plugin schema
  - Effort: High.
  - Risk: Medium.
  - Impact: Unlocks vertical shells without forking core.
  - Maintenance: Medium-low if registry stays explicit and well tested.

- **(B) JSONB-only extensions inside the core UIO table.**
  - Effort: Low-medium.
  - Risk: Medium (schema drift, harder indexing, harder migrations).
  - Impact: Fast to add fields, slower to build serious vertical analytics.
  - Maintenance: Medium-high over time.

- **(C) Separate services per vertical (legal service, accounting service, etc).**
  - Effort: Very high.
  - Risk: High (duplicated infra, deployment complexity).
  - Impact: Maximizes autonomy, but violates DRY and slows platform evolution.
  - Maintenance: Very high.

**Opinionated recommendation: 2A.**

This gives you “vertical differentiation” while preserving a single core truth/memory fabric.

## Issue 3: Job/Scheduling Architecture Is Fragmented (Durability Risk)

**Problem (concrete):**

- Connector scheduling currently uses APScheduler (in-memory scheduler). See `drovi-intelligence/src/connectors/scheduling/scheduler.py:1-16`.
- You also have a Postgres-backed durable job queue. See `drovi-intelligence/src/jobs/queue.py:1-168`.
- Kafka exists as an event fabric, but there is not a single, explicit “one true” orchestrator for backfills, retries, and idempotent replays.

**Options:**

- **(A, Recommended) Make the Postgres durable job queue the canonical “job plane”; treat Kafka as the canonical event log.**
  - APScheduler becomes a thin “job enqueuer” only (or is removed).
  - All connector sync/backfill become jobs with:
    - leases, retries, backoff, idempotency keys
    - per-connection resource_key isolation
    - replay via Kafka offsets/content hashes
  - Effort: Medium.
  - Risk: Medium (migration work), but the end state is simpler and more reliable.
  - Impact: High on connector reliability (your stated priority).
  - Maintenance: Lower (one job system).

- **(B) Adopt Temporal as workflow engine; keep Kafka as event fabric.**
  - Effort: High (new infra + SDK + ops).
  - Risk: Medium-high (learning curve), but extremely robust once implemented.
  - Impact: Highest reliability and auditability.
  - Maintenance: Medium (Temporal ops, but strong guarantees).

- **(C) Keep APScheduler as the execution engine and harden it (persistence addons).**
  - Effort: Medium.
  - Risk: Medium-high (APScheduler is not a real workflow engine; edge cases remain).
  - Impact: Moderate.
  - Maintenance: Medium-high.

**Opinionated recommendation: 3A (unless you want to go all-in on Temporal with 3B).**

3A fits “engineered enough” without dragging a lot of ops complexity into seed-stage demos.

**Decision (confirmed): 3B (Temporal).** The remainder of this document assumes Temporal orchestrates periodic connector syncs, backfills, retries, and long-running workflows; APScheduler should be removed (or reduced to dev-only tooling), and Kafka remains the canonical event fabric/event log.

## Issue 4: Multiple “Time” Conventions (Naive vs Aware) Create Real Bugs

**Problem (concrete):**

- Multiple `utc_now()` utilities exist with different semantics:
  - Naive UTC for Postgres timestamps in `drovi-intelligence/src/memory/service.py:31-34`.
  - Naive UTC duplicate in `drovi-intelligence/src/orchestrator/nodes/persist.py:59-66`.
  - Aware UTC in `drovi-intelligence/src/jobs/queue.py:18-20` and `drovi-intelligence/src/evidence/audit.py:11`.
- This already caused a production bug: `TypeError: can't subtract offset-naive and offset-aware datetimes` in trust scoring (fixed), showing this is not theoretical.

**Options:**

- **(A, Recommended) Enforce a single invariant: all internal timestamps are timezone-aware UTC at the domain/app layers; adapters convert at boundaries.**
  - Domain/Application: `datetime` with `tzinfo=UTC` only.
  - Persistence adapter: coerces for specific Postgres column types (ideally migrate columns to `timestamptz`).
  - Effort: Medium.
  - Risk: Medium (touches many modules), but testable.
  - Impact: High reduction in subtle bugs.
  - Maintenance: Low after the invariant is in place.

- **(B) Keep naive UTC everywhere; coerce aware -> naive at DB boundaries.**
  - Effort: Medium.
  - Risk: Medium (easy to regress; loses explicit timezone semantics).
  - Impact: Moderate.
  - Maintenance: Medium.

- **(C) Do nothing; fix bugs ad-hoc.**
  - Effort: Low.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 4A.**

## Issue 5: Security Boundary Complexity (Multiple Auth Contexts + Internal Token)

**Problem (concrete):**

- Multiple auth mechanisms exist (session cookies, admin cookies, API keys, internal service token) and routes use different dependencies (`APIKeyContext` vs `AuthContext`).
  - See `drovi-intelligence/src/auth/middleware.py:1-220`.
- The internal token has a hardcoded dev fallback: `INTERNAL_SERVICE_TOKEN = ... or "dev-test-token-drovi-2024"` (`drovi-intelligence/src/auth/middleware.py:45-48`) and extracts `organization_id` from request body/query for internal calls (`drovi-intelligence/src/auth/middleware.py:115-139`).
- This increases the blast radius if the token leaks and makes it harder to reason about “who can see what”.

**Options:**

- **(A, Recommended) Consolidate on `AuthContext` only; make “internal” strictly service-to-service with mTLS or short-lived JWT, not a shared static token.**
  - For local dev, keep a dev-only internal token behind an explicit `ENVIRONMENT=development` guard.
  - Require explicit organization binding in the internal JWT claims (no org_id from body).
  - Effort: Medium.
  - Risk: Medium (touches many routes).
  - Impact: High clarity, easier compliance story.
  - Maintenance: Lower.

- **(B) Keep current token scheme but tighten it (rotate secret, restrict networks, improve audits).**
  - Effort: Low-medium.
  - Risk: Medium (still footguns).
  - Impact: Moderate.
  - Maintenance: Medium.

- **(C) Do nothing.**
  - Effort: Low.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 5A.**

## Issue 6: Backend/Frontend Contract Drift (Types in Multiple Places)

**Problem (concrete):**

- The web app owns a massive hand-written client/types file (`apps/web/src/lib/api.ts:1+`) and there is also a TS SDK (`packages/intelligence-sdk`).
- There is no single canonical contract source (OpenAPI -> generated client/types, or shared schema package).

**Options:**

- **(A, Recommended) Make OpenAPI the contract-of-record and generate typed clients (web + vertical apps + admin).**
  - Generate:
    - `packages/api-client` (fetch wrapper + retries)
    - `packages/api-types` (types only)
    - Optional: `packages/react-query-hooks` generated or thin wrappers
  - Keep the hand-written client only for “ergonomics wrappers”.
  - Effort: Medium.
  - Risk: Low-medium.
  - Impact: High reduction in drift.
  - Maintenance: Low.

- **(B) Use the existing `packages/intelligence-sdk` as canonical; delete `apps/web/src/lib/api.ts` gradually.**
  - Effort: Medium.
  - Risk: Medium (SDK must fully cover endpoints; may lag behind FastAPI).
  - Impact: High if done well.
  - Maintenance: Medium.

- **(C) Do nothing.**
  - Effort: Low.
  - Risk: High (drift).
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 6A.**

---

## AskUserQuestion (Stage 1: Architecture) (Resolved)

Recorded decision: `1A, 2A, 3B, 4A, 5A, 6A`.

If you want to override any Stage 1 choice, reply with the overrides in this format: `1A, 2A, 3B, 4A, 5A, 6A`.

- Issue 1:
  - **1A (Recommended)** Modular monolith with Hexagonal + bounded contexts
  - 1B Service-layer extraction only
  - 1C Do nothing
- Issue 2:
  - **2A (Recommended)** Kernel + explicit plugin registry + hybrid storage
  - 2B JSONB-only extensions
  - 2C Separate services per vertical
- Issue 3:
  - **3A (Recommended)** Postgres durable job plane + Kafka event log
  - 3B Temporal workflows
  - 3C Keep APScheduler as execution engine
- Issue 4:
  - **4A (Recommended)** Single invariant: aware UTC internally, adapters convert
  - 4B Naive UTC everywhere
  - 4C Do nothing
- Issue 5:
  - **5A (Recommended)** Consolidate auth on AuthContext; internal = short-lived JWT; no org_id from body
  - 5B Tighten current static token scheme
  - 5C Do nothing
- Issue 6:
  - **6A (Recommended)** OpenAPI as contract-of-record + generated clients/types
  - 6B Promote existing TS SDK as canonical
  - 6C Do nothing

Stage 1 is resolved. The plan below (and all tasks that follow) assume the recorded choice set.

---

# Stage 2: Code Quality Review (Decisions Required)

This stage turns the architecture choice (all A’s) into concrete codebase boundaries.

Scope of this stage:

- Code organization and module structure (backend + frontend)
- DRY violations (aggressively)
- Error handling patterns and missing edge cases
- Technical debt hotspots that block extensibility and high coverage
- Over/under engineering relative to your preferences

## Issue 7: No Enforced Module Size Limits (Giant Files Persist)

**Problem (concrete):**

- Several critical modules exceed your target 500-800 LOC and contain mixed responsibilities:
  - `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/orchestrator/nodes/persist.py:1` (~3440 LOC in repo).
  - `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/api/routes/uios.py:1` (~2291 LOC).
  - `/Users/jeremyscatigna/project-memory/apps/web/src/lib/api.ts:1` (~3352 LOC).
- Without an enforcement mechanism, “refactors” tend to regress as new features land.

**Options:**

- **(7A, Recommended) Enforce a hard LOC cap in CI + a “module responsibilities” rubric.**
  - CI fails if a file exceeds cap (with explicit exemptions allowed but reviewed).
  - Require each module to declare its layer (domain/app/infra/presentation) and boundaries.
  - Effort: Low-medium.
  - Risk: Low.
  - Impact: High (prevents backsliding).
  - Maintenance: Low.

- (7B) Guidelines only (no CI enforcement).
  - Effort: Low.
  - Risk: Medium (regression likely).
  - Impact: Medium.
  - Maintenance: Medium (discipline required).

- (7C) Do nothing.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 7A.**

## Issue 8: Layering Violations + Cyclic Imports Make the Core Hard to Modularize

**Problem (concrete):**

- `UIOManager` depends on orchestrator concerns:
  - Imports orchestrator state at `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/uio/manager.py:38`.
  - Also contains duplicated imports (`get_db_session` imported twice) at `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/uio/manager.py:32` and `:39`.
- Orchestrator persistence depends on UIO manager:
  - `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/orchestrator/nodes/persist.py:25`.
- Net effect: core lifecycle logic is not separable from orchestration and storage, which blocks “vertical plugin” extensibility.

**Options:**

- **(8A, Recommended) Introduce strict dependency direction via ports:**
  - `domain` has no imports from `application`, `infrastructure`, `presentation`.
  - `application` depends only on `domain` + ports.
  - `presentation` (FastAPI) depends on `application` only.
  - `orchestrator` becomes an adapter that calls application use-cases.
  - Effort: High.
  - Risk: Medium (many imports change).
  - Impact: High (unblocks plugin + testability).
  - Maintenance: Low long-term.

- (8B) Partial refactor: keep orchestrator + UIO manager as-is, only extract API routes.
  - Effort: Medium.
  - Risk: Medium.
  - Impact: Medium (cycles remain).
  - Maintenance: Medium-high.

- (8C) Do nothing.
  - Effort: None.
  - Risk: High (verticals become forks).
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 8A.**

## Issue 9: DRY Violations in Core Utilities (Time, DB, Serialization)

**Problem (concrete):**

- `utc_now()` is implemented 25 times in `drovi-intelligence/src` with conflicting semantics (naive vs aware).
  - Example naive: `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/memory/service.py:31-34`.
  - Example aware: `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/jobs/queue.py:18-20`.
  - Example duplicate naive: `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/orchestrator/nodes/persist.py:59-66`.
- DB access has *two* approaches in one module:
  - SQLAlchemy sessions + raw asyncpg pools in `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/db/client.py:73-140`.
- Graph serialization helpers live in orchestration code:
  - `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/orchestrator/nodes/persist.py:46-56`.

**Options:**

- **(9A, Recommended) Create a `kernel` utilities package and ban local re-implementations.**
  - `src/kernel/time.py` provides the only supported clock APIs.
  - `src/kernel/db/` provides session + raw pool behind explicit ports; only infra layer can import it.
  - Shared serialization helpers move to `kernel` (graph property serializer, JSON coercion, hash utilities).
  - Effort: Medium.
  - Risk: Medium (touches many call-sites).
  - Impact: High (removes entire classes of bugs).
  - Maintenance: Low.

- (9B) Keep duplicated utils but add “recommended import paths”.
  - Effort: Low.
  - Risk: Medium-high (duplication continues).
  - Impact: Low-medium.
  - Maintenance: Medium-high.

- (9C) Do nothing.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 9A.**

## Issue 10: Connector Configuration and Scheduling Logic Is Partly Hardcoded

**Problem (concrete):**

- Connector-specific stream definitions are hardcoded in connection service:
  - `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/connectors/connection_service.py:202-226`.
  - This bypasses the connector framework/registry and risks drift when adding new connectors or streams.
- Scheduler is huge and mixes in-memory scheduling with job enqueueing:
  - `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/connectors/scheduling/scheduler.py:1-16` (APScheduler-based).
  - Lots of broad exception handling around job registration (example: `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/connectors/scheduling/scheduler.py:199-237`).

**Options:**

  - **(10A, Recommended) Make each connector the source-of-truth for its streams and sync semantics.**
  - `ConnectorDefinition` includes default streams, capabilities, cursor semantics, and provider limits.
  - `ConnectionService` becomes a thin adapter: load DB row, decrypt tokens, ask connector for defaults/validation.
  - Temporal workflows/schedules call connector sync/backfill activities per 3B; APScheduler is removed (or dev-only).
  - Effort: Medium-high.
  - Risk: Medium.
  - Impact: High (extensible connector plane).
  - Maintenance: Low-medium.

- (10B) Central mapping table in one file (still not inside connector), reduce duplication but keep “switch-case”.
  - Effort: Medium.
  - Risk: Medium.
  - Impact: Medium.
  - Maintenance: Medium.

- (10C) Do nothing.
  - Effort: None.
  - Risk: Medium-high (drift, missing connector edge cases).
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 10A.**

## Issue 11: Error Handling Is Inconsistent (Too Many Broad `except` and Silent `pass`)

**Problem (concrete):**

- Many broad exception catches exist across connectors and scheduling; some swallow errors completely.
  - Example: token decryption failure returns `None` (caller sees “connection missing” style behavior) at `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/connectors/connection_service.py:171-182`.
  - Example: Kafka consumer swallows metrics errors with `except Exception: pass` at `/Users/jeremyscatigna/project-memory/drovi-intelligence/src/streaming/kafka_consumer.py:461-468`.
- Lack of a shared error taxonomy makes API behavior and retries inconsistent across subsystems.

**Options:**

- **(11A, Recommended) Introduce an explicit error taxonomy and “no silent failures” rule.**
  - `DomainError`, `ApplicationError`, `InfrastructureError` with stable error codes.
  - Presentation maps errors to consistent HTTP responses.
  - Replace silent `pass` with at least debug logging and tagged metrics.
  - Effort: Medium.
  - Risk: Medium.
  - Impact: High (reliability + debuggability).
  - Maintenance: Low.

- (11B) Only add logging/metrics around broad exceptions; keep the exception patterns.
  - Effort: Low-medium.
  - Risk: Medium (still inconsistent behavior).
  - Impact: Medium.
  - Maintenance: Medium.

- (11C) Do nothing.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 11A.**

## Issue 12: Frontend DRY Violations (UI Kit Duplicated Across Apps)

**Problem (concrete):**

- The entire UI component library is duplicated between web and admin:
  - `/Users/jeremyscatigna/project-memory/apps/web/src/components/ui/*`
  - `/Users/jeremyscatigna/project-memory/apps/admin/src/components/ui/*`
  - Both contain the same 54 filenames; most files are identical (example: `button.tsx`, `command.tsx`, `chart.tsx`), with some divergence (example: `sidebar.tsx` differs).

**Options:**

- **(12A, Recommended) Extract UI kit into `packages/ui` and split “theme” from “components”.**
  - `packages/ui-core`: headless primitives, accessibility, base components.
  - `packages/ui-theme`: tokens, typography, motion, and per-vertical theme packs.
  - Apps import from packages; no copy-paste.
  - Effort: Medium.
  - Risk: Medium (lots of import churn, but mechanical).
  - Impact: High (enables vertical shells with different look and feel).
  - Maintenance: Low long-term.

- (12B) Keep duplicated UI, add a sync script to copy changes between apps.
  - Effort: Low.
  - Risk: Medium-high (drift persists, merge conflicts).
  - Impact: Medium.
  - Maintenance: Medium-high.

- (12C) Do nothing.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 12A.**

## Issue 13: Frontend API Contract + Client Is Monolithic and Duplicated

**Problem (concrete):**

- Web app has a large hand-written client/types/transformer file:
  - `/Users/jeremyscatigna/project-memory/apps/web/src/lib/api.ts:1` (~3352 LOC).
- A separate TS SDK exists:
  - `/Users/jeremyscatigna/project-memory/packages/intelligence-sdk/src/index.ts`.
- This is a drift risk and blocks “vertical apps” because every app would need its own copy or slightly different client.

**Options:**

- **(13A, Recommended) Generate API types + client from OpenAPI (6A) and keep a thin ergonomic wrapper SDK.**
  - `packages/api-types` and `packages/api-client` generated.
  - `packages/intelligence-sdk` becomes the wrapper layer (nice API), not the source of truth.
  - Apps consume packages; `apps/web/src/lib/api.ts` is deleted over time.
  - Effort: Medium.
  - Risk: Low-medium.
  - Impact: High (contract stability and multi-app scaling).
  - Maintenance: Low.

- (13B) Promote the current TS SDK as canonical; manually keep it aligned with FastAPI.
  - Effort: Medium.
  - Risk: Medium (human drift).
  - Impact: Medium-high.
  - Maintenance: Medium.

- (13C) Do nothing.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Recommendation: 13A.**

---

## AskUserQuestion (Stage 2: Code Quality) (Resolved)

Recorded decision: `7A, 8A, 9A, 10A, 11A, 12A, 13A`.

If you want to override any Stage 2 choice, reply with the overrides in this format: `7A, 8A, 9A, 10A, 11A, 12A, 13A`.

- Issue 7:
  - **7A (Recommended)** Enforce module LOC cap in CI
  - 7B Guidelines only
  - 7C Do nothing
- Issue 8:
  - **8A (Recommended)** Strict dependency direction via ports/adapters
  - 8B Partial extraction only
  - 8C Do nothing
- Issue 9:
  - **9A (Recommended)** Kernel utilities + ban local re-implementations
  - 9B Recommended imports only
  - 9C Do nothing
- Issue 10:
  - **10A (Recommended)** ConnectorDefinition owns streams; Temporal workflows/schedules per 3B
  - 10B Central mapping file
  - 10C Do nothing
- Issue 11:
  - **11A (Recommended)** Explicit error taxonomy + no silent failures
  - 11B Logging/metrics only
  - 11C Do nothing
- Issue 12:
  - **12A (Recommended)** Extract UI kit to packages + theme separation
  - 12B Sync script
  - 12C Do nothing
- Issue 13:
  - **13A (Recommended)** OpenAPI-generated client/types + thin SDK wrapper
  - 13B Current TS SDK canonical
  - 13C Do nothing

---

# Stage 3: Test Review (Decisions Required)

Target outcome:

- 90%+ backend coverage and meaningful frontend coverage.
- Deterministic, non-flaky CI (LLM interactions never make tests nondeterministic).
- A test pyramid that matches Drovi’s risk profile: connectors, workflows, and “proof-first memory” invariants.

## Issue 14: Coverage Is Too Low and Not Enforced (Risk: Regression + Refactor Fear)

**Problem (concrete):**

- Backend coverage is ~42% overall (measured via `pytest --cov=src`).
- Critical/high-risk modules are under-tested:
  - `drovi-intelligence/src/orchestrator/nodes/persist.py` ~6% coverage.
  - `drovi-intelligence/src/uio/manager.py` ~11% coverage.
  - `drovi-intelligence/src/jobs/worker.py` and `drovi-intelligence/src/streaming/worker.py` ~0% coverage.
- There is no CI “ratchet” to prevent new code from landing untested.

**Options:**

- **(14A, Recommended) Add coverage gates + a coverage ratchet to reach 90%+ safely.**
  - Gate rules:
    - Overall backend coverage target: 90%+.
    - Per-context minimums (kernel + domain highest; infra can be slightly lower if integration tests exist).
    - “No decrease” ratchet: coverage can only go up across merges.
  - Exclusions are explicit and rare (generated files only).
  - Effort: Medium.
  - Risk: Low-medium (initial work to add tests + adjust CI).
  - Impact: Very high confidence during refactor.
  - Maintenance: Low (guardrails prevent backsliding).

- (14B) Set an immediate moderate bar (ex: 70%) and increase weekly.
  - Effort: Low-medium.
  - Risk: Medium (more room for untested regressions early).
  - Impact: Medium-high.
  - Maintenance: Medium (requires active ratcheting).

- (14C) Do nothing; rely on discipline.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 14A.**

This matches “tests are non-negotiable” while still being implementable via a ratchet rather than a big-bang.

## Issue 15: Core Logic Is Not Unit-Testable (Infra + Domain Entangled)

**Problem (concrete):**

- Large modules combine domain invariants, DB IO, graph writes, and embedding/LLM concerns (example: `drovi-intelligence/src/orchestrator/nodes/persist.py:1`).
- This forces tests to be integration-heavy, which is slower and makes it harder to cover edge cases.

**Options:**

- **(15A, Recommended) Make the refactor explicitly “unit-test-first” via ports and in-memory fakes.**
  - Domain/app code becomes pure and deterministic.
  - Infrastructure adapters are integration-tested (DB, Kafka, Falkor, S3/R2).
  - Add standard fakes:
    - `FakeClock` (paired with Issue 4A time invariant).
    - `FakeLLM` (pre-recorded responses).
    - `FakeObjectStore` (content-hash behavior).
    - `FakeGraphStore` (in-memory adjacency + conflict indexes).
  - Effort: High (but aligned with the architecture you chose).
  - Risk: Medium (refactor touches many files).
  - Impact: Very high coverage and much faster feedback loops.
  - Maintenance: Low once established.

- (15B) Lean on integration tests only (Docker-based).
  - Effort: Medium.
  - Risk: Medium-high (slow tests; edge cases missed; flakiness).
  - Impact: Medium.
  - Maintenance: Medium-high.

- (15C) Do nothing; keep testing around the edges.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 15A.**

## Issue 16: Temporal Workflows Need Deterministic Tests (Retries, Timers, Idempotency)

**Problem (concrete):**

- With the Stage 1 decision `3B`, connector sync/backfill/retry behavior becomes workflow logic.
- Workflow correctness depends on time, retries, cancellation, heartbeats, and idempotency. Without a deterministic harness, tests become flaky or too slow.

**Options:**

- **(16A, Recommended) Use Temporal’s in-process test environment for unit tests + a small docker integration suite.**
  - Unit tests:
    - Use `temporalio.testing.WorkflowEnvironment` with time-skipping to test schedules, timers, retries, backoff, cancellation.
    - Mock activities (connectors, DB writes) with fakes that simulate rate limits and partial failures.
  - Integration tests:
    - Minimal `docker compose` suite to validate wire-up (Temporal server + worker + Postgres).
  - Effort: Medium-high.
  - Risk: Medium (new tooling), but deterministic.
  - Impact: High reliability on the most valuable part (connectors + live ingestion).
  - Maintenance: Medium.

- (16B) Only run docker integration tests against a real Temporal server.
  - Effort: Medium.
  - Risk: Medium-high (slow + flaky under load; harder to simulate edge cases).
  - Impact: Medium.
  - Maintenance: Medium-high.

- (16C) Manual validation only.
  - Effort: Low.
  - Risk: Very high.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 16A.**

## Issue 17: Connector Reliability Lacks a Conformance Test Suite

**Problem (concrete):**

- Connectors/backfills are a core “wow factor” and a major reliability risk.
- Some integration tests exist (example: `drovi-intelligence/tests/integration/test_connector_ingestion.py`), but there is no formal conformance suite that every connector must pass:
  - Idempotency (content-hash + provider IDs).
  - Cursor windows (resume correctness).
  - Rate limiting/backoff behavior.
  - Replay correctness from Kafka/UEM.

**Options:**

- **(17A, Recommended) Build a connector conformance harness + property tests for cursor/replay.**
  - “Connector Contract” test suite:
    - `list_changes` returns stable, monotonic cursors.
    - backfill windows are resumable.
    - retries are safe (idempotent writes).
  - Add property-based tests (cursor windows, dedupe keys, ordering invariants) where it buys real confidence.
  - Effort: Medium-high.
  - Risk: Medium (more test infra), but pays down ongoing connector risk.
  - Impact: High.
  - Maintenance: Medium.

- (17B) Add connector tests ad-hoc per provider.
  - Effort: Medium.
  - Risk: Medium (uneven coverage, drift).
  - Impact: Medium.
  - Maintenance: Medium-high.

- (17C) Manual testing + pilots discover issues.
  - Effort: Low.
  - Risk: Very high.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 17A.**

## Issue 18: Frontend Tests Are Nearly Nonexistent (Web/Admin)

**Problem (concrete):**

- Web has only one unit test file: `apps/web/src/lib/evidence-utils.test.ts:1`.
- Admin has no tests.
- Vitest is configured for Node, blocking React component tests by default (`vitest.config.ts:7` sets `environment: "node"`).

**Options:**

- **(18A, Recommended) Establish a frontend test pyramid (unit + component + a small number of e2e).**
  - Unit/component tests:
    - Switch Vitest to `jsdom` (or split configs: `vitest.node.config.ts` + `vitest.browser.config.ts`) to support React Testing Library.
    - Add MSW-based API mocking to test edge cases (offline, 401/403, pagination, SSE disconnects).
  - E2E tests:
    - Add Playwright for 5-10 “critical flows” (signup, onboarding, connect source, backfill progress, ask/search, evidence view).
  - Effort: Medium.
  - Risk: Low-medium.
  - Impact: High UI correctness during core refactors.
  - Maintenance: Medium.

- (18B) Only Playwright E2E.
  - Effort: Medium.
  - Risk: Medium (slow feedback; hard to isolate UI states).
  - Impact: Medium.
  - Maintenance: Medium-high.

- (18C) Only unit tests (no browser/e2e).
  - Effort: Low-medium.
  - Risk: Medium-high (routing/auth/caching regressions missed).
  - Impact: Medium-low.
  - Maintenance: Medium.

**Opinionated recommendation: 18A.**

## Issue 19: Contract Tests for OpenAPI + Generated Clients (Prevent Drift Across Apps)

**Problem (concrete):**

- You chose OpenAPI as the contract-of-record (`6A`), so the system’s stability depends on:
  - The spec being correct and kept in sync.
  - Generated clients being validated and versioned.
  - Breaking changes being caught before deploy.

**Options:**

- **(19A, Recommended) Add OpenAPI spec snapshot + breaking-change detection + generated-client compile tests.**
  - CI validates:
    - spec generation is deterministic.
    - breaking changes are flagged (allow explicit “break” approvals).
    - generated client builds and typechecks across apps.
  - Effort: Medium.
  - Risk: Low.
  - Impact: High (prevents silent drift).
  - Maintenance: Low.

- (19B) Manual review of spec changes.
  - Effort: Low.
  - Risk: Medium-high.
  - Impact: Medium.
  - Maintenance: Medium.

- (19C) Do nothing (trust the apps to keep up).
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 19A.**

---

## AskUserQuestion (Stage 3: Tests)

Recorded decision: `14A, 15A, 16A, 17A, 18A, 19A`.

If you want to override any Stage 3 choice, reply with the overrides in this format: `14A, 15A, 16A, 17A, 18A, 19A`.

- Issue 14:
  - **14A (Recommended)** Coverage gates + ratchet to reach 90%+
  - 14B Start lower, ratchet weekly
  - 14C Do nothing
- Issue 15:
  - **15A (Recommended)** Ports + in-memory fakes so core is unit-testable
  - 15B Integration-only tests
  - 15C Do nothing
- Issue 16:
  - **16A (Recommended)** Temporal in-process test env + small docker integration suite
  - 16B Docker integration only
  - 16C Manual
- Issue 17:
  - **17A (Recommended)** Connector conformance harness + property tests
  - 17B Ad-hoc connector tests
  - 17C Manual
- Issue 18:
  - **18A (Recommended)** Frontend test pyramid (Vitest+RTL+MSW) + Playwright for critical flows
  - 18B Playwright only
  - 18C Unit-only
- Issue 19:
  - **19A (Recommended)** OpenAPI snapshot + breaking-change detection + client compile tests
  - 19B Manual review
  - 19C Do nothing

---

# Stage 4: Performance Review (Decisions Required)

This stage identifies the biggest performance and scaling risks and chooses the “engineered enough” fixes that preserve correctness and extensibility.

Scope:

- N+1 queries and DB access patterns
- Memory usage / backpressure
- Caching strategy
- Slow or high-complexity code paths

## Issue 20: DB Connection Strategy Is Optimized for Serverless, Not a Long-Lived API Container

**Problem (concrete):**

- SQLAlchemy engine uses `NullPool` (no connection pooling): `drovi-intelligence/src/db/client.py:38-42`.
- A separate raw asyncpg pool exists and is used by hot endpoints like Console: `drovi-intelligence/src/db/client.py:107-145`, and `drovi-intelligence/src/api/routes/console.py:611-618`.
- Net effect:
  - More connection churn for typical container deployments (higher latency, higher DB load).
  - Two DB stacks to tune/observe and two different JSON behaviors (already caused real issues elsewhere).

**Options:**

- **(20A, Recommended) Make pooling environment-aware and unify DB access behind ports.**
  - Default (docker/k8s): enable a real pool for SQLAlchemy (bounded size, pre-ping).
  - Serverless mode: keep `NullPool` via env flag.
  - Long-term: keep *one* DB execution abstraction (ports) so application code doesn’t care whether the adapter uses SQLAlchemy or asyncpg.
  - Effort: Medium.
  - Risk: Medium (touches initialization paths and some call sites).
  - Impact on other code: Medium (but reduces future drift).
  - Maintenance: Low after unification (one place to tune).

- (20B) Keep current split; just tune pool sizes and timeouts.
  - Effort: Low.
  - Risk: Medium (inconsistent behavior persists).
  - Impact: Medium.
  - Maintenance: Medium-high (two systems forever).

- (20C) Do nothing.
  - Effort: None.
  - Risk: Medium-high (slowdowns under load; hard-to-debug connection issues).
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 20A.**

This aligns with “engineered enough” and reduces hidden edge cases introduced by dual DB clients.

## Issue 21: Offset Pagination + Total Counts Will Become a Bottleneck at “Accounting Firm” Scale

**Problem (concrete):**

- UIO listing does a `COUNT(*)` and then `LIMIT/OFFSET`: `drovi-intelligence/src/api/routes/uios.py:955-975`.
- Drive documents list sorts by `created_at` and returns up to 200 records; the web UI polls it every 3s: `drovi-intelligence/src/api/routes/documents.py:564-600` and `apps/web/src/routes/dashboard/drive.tsx:201-212`.
- Console runs multiple aggregate queries per request (metrics + timeseries): `drovi-intelligence/src/api/routes/console.py:589-619` and `:731-819`.
- Offset grows linearly with dataset size and forces deeper scans; total counts can become expensive.

**Options:**

- **(21A, Recommended) Move hot lists to keyset pagination and make total counts optional and cached.**
  - Replace offset cursor with `(created_at, id)` keyset for UIOs, documents, tickets, etc.
  - Default API behavior: return `has_more` via `limit+1`; omit `total` unless requested.
  - If totals are required (dashboards): cache them with TTL or compute via incremental counters/materialized views.
  - Effort: Medium-high.
  - Risk: Medium (pagination semantics change; needs careful tests).
  - Impact on other code: Medium (frontend/client updates).
  - Maintenance: Low-medium (well-known pattern).

- (21B) Keep offset pagination; add indexes and accept eventual slowdowns.
  - Effort: Low-medium.
  - Risk: Medium (still hits offset wall).
  - Impact: Medium.
  - Maintenance: Medium.

- (21C) Do nothing.
  - Effort: None.
  - Risk: High (p95 latency rises with adoption).
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 21A.**

## Issue 22: “Always JOIN Everything” Queries Will Hit CPU/IO Limits and Block Live Dashboards

**Problem (concrete):**

- Console metrics query joins many tables regardless of which filters are active: `drovi-intelligence/src/api/routes/console.py:589-609`.
- Timeseries generation repeats the same multi-join patterns for range + group-by queries: `drovi-intelligence/src/api/routes/console.py:731-819`.
- These joins are frequently unnecessary for counts and histogram bars, and can force the planner into large intermediate results.

**Options:**

- **(22A, Recommended) Introduce a query planner + pre-aggregates for dashboard-grade metrics.**
  - Query planner:
    - add JOINs only when the filter/sort needs that table.
    - keep a canonical “base UIO scope” filter (`org_id`, visibility, time slice) shared across endpoints.
  - Pre-aggregates:
    - maintain small “metrics tables” (per-org counts by type/status, daily histogram buckets) updated on write via outbox/Temporal activities.
  - Effort: Medium-high.
  - Risk: Medium (more moving parts, but testable).
  - Impact on other code: Medium (API responses may include cached metrics).
  - Maintenance: Medium-low (if planner is small + well-tested).

- (22B) Keep current queries; add more indexes and hope.
  - Effort: Medium.
  - Risk: Medium-high (indexes won’t fix join explosion).
  - Impact: Medium.
  - Maintenance: Medium.

- (22C) Do nothing.
  - Effort: None.
  - Risk: High.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 22A.**

## Issue 23: Bi-Temporal “As-Of” Queries Need Better Indexing Than Single-Column B-Trees

**Problem (concrete):**

- “As-of” reads filter by `valid_from/valid_to`: `drovi-intelligence/src/api/routes/uios.py:931-934`.
- Current indexes are single-column only: `drovi-intelligence/alembic/versions/019_add_bitemporal_fields_to_uios.py:56-65`.
- Queries are also scoped by org (`organization_id = :org_id`), but the temporal indexes do not include org, so they can degrade as total table size grows.

**Options:**

- **(23A, Recommended) Model validity as a range and index it properly (plus org scoping).**
  - Add a `tstzrange(valid_from, valid_to)` (or generated column) and a GiST index.
  - Add a composite strategy for multi-tenant workloads (org-aware index or partitioning if needed later).
  - Keep a fast “current” view/table for `valid_to IS NULL` reads.
  - Effort: Medium.
  - Risk: Medium (schema migration + query updates).
  - Impact on other code: Medium (time-slice endpoints and repos).
  - Maintenance: Low-medium (standard approach).

- (23B) Add composite btree indexes (ex: `(organization_id, valid_from)` and a partial index for `valid_to IS NULL`).
  - Effort: Low-medium.
  - Risk: Low.
  - Impact: Medium (helps common cases, but not as strong as range indexing).
  - Maintenance: Low.

- (23C) Do nothing.
  - Effort: None.
  - Risk: Medium-high (bi-temporal becomes slow right when it’s most valuable).
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 23A**, unless you want a lower-effort stopgap (23B) for the first pilot.

## Issue 24: Persistence Hot Path Does Per-Item DB Writes and Graph Writes (High Roundtrip Cost)

**Problem (concrete):**

- The persistence node loops extracted items and performs many `INSERT` calls, including per-supporting-evidence spans: `drovi-intelligence/src/orchestrator/nodes/persist.py:806-940` (and many similar loops later in the file).
- It also issues many graph queries per item: `drovi-intelligence/src/orchestrator/nodes/persist.py` contains repeated `await graph.query(...)` calls (example occurrences around `:186`, `:1257`, `:1714`).
- This is correct but roundtrip-heavy and will be the first place p95 latency spikes during backfills.

**Options:**

- **(24A, Recommended) Make persistence bulk + use an outbox so graph/vector indexing becomes async and batched.**
  - Persist canonical UIO + evidence references in one DB transaction.
  - Emit an outbox event per persisted entity (or per batch).
  - Temporal workflows/activities consume outbox to:
    - batch graph upserts
    - batch embedding generation
    - batch vector index updates
  - Effort: High.
  - Risk: Medium (behavior change, but testable with strong invariants).
  - Impact on other code: High (orchestrator changes; indexing paths move).
  - Maintenance: Low-medium (clean separation; fewer hot-path dependencies).

- (24B) Keep current sync design but reduce roundtrips with `executemany` and prefetch caches.
  - Example: batch `unified_object_source` inserts for supporting evidence spans.
  - Example: preload existing titles for dedupe to avoid per-item `find_existing_uio`.
  - Effort: Medium.
  - Risk: Medium (still complex hot path, but faster).
  - Impact: Medium.
  - Maintenance: Medium (still one giant node).

- (24C) Do nothing.
  - Effort: None.
  - Risk: High (backfills slow; live ingest competes with API queries).
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 24A.**

This is the most “Google-level” path that remains explicit and testable: canonical truth first, derived indexes async.

## Issue 25: Frontend Polling + Broad Cache Invalidation Can Overload the API

**Problem (concrete):**

- Drive page polls documents every 3 seconds: `apps/web/src/routes/dashboard/drive.tsx:201-212`.
- WebSocket hook invalidates broad query keys on every event: `apps/web/src/hooks/use-intelligence-stream.ts:107-176`.
- This can multiply backend load with more users and can feel “janky” (constant refetch).

**Options:**

- **(25A, Recommended) Push updates + targeted cache updates (minimize polling and invalidation).**
  - Add SSE/WS topics for document changes and sync progress.
  - Update React Query caches with precise keys (per org, per document) rather than invalidating broad prefixes.
  - Keep polling only as a fallback when streaming is unavailable.
  - Effort: Medium.
  - Risk: Medium (more streaming surface area, but testable with MSW/Playwright).
  - Impact on other code: Medium (client changes).
  - Maintenance: Medium-low once standardized.

- (25B) Keep polling; tune intervals and add client-side backoff.
  - Effort: Low.
  - Risk: Medium (still wasteful).
  - Impact: Medium-low.
  - Maintenance: Medium.

- (25C) Do nothing.
  - Effort: None.
  - Risk: Medium-high.
  - Impact: Low.
  - Maintenance: High.

**Opinionated recommendation: 25A.**

## Issue 26: Evidence Artifact Fetch Defaults to Presigned URL Generation (Cost + Latency + Audit Noise)

**Problem (concrete):**

- Artifact metadata endpoint defaults to `include_url=true`: `drovi-intelligence/src/api/routes/evidence.py:524-569`.
- When `include_url` is true, it creates a presigned URL and records an audit entry: `drovi-intelligence/src/api/routes/evidence.py:567-575`.
- In UI lists, this can create many presigned URLs and audit events even when the user never opens/downloads the artifact.

**Options:**

- **(26A, Recommended) Make presigned URLs lazy and cache them briefly.**
  - Default `include_url=false`.
  - Fetch URL only when the user explicitly opens/downloads.
  - Cache URL per artifact for a short TTL (and record audit on actual access).
  - Effort: Medium.
  - Risk: Low-medium.
  - Impact on other code: Medium (frontend adjusts).
  - Maintenance: Low.

- (26B) Keep default include_url=true but add caching server-side.
  - Effort: Low-medium.
  - Risk: Medium (still generates URLs frequently; audit still noisy).
  - Impact: Medium.
  - Maintenance: Medium.

- (26C) Do nothing.
  - Effort: None.
  - Risk: Medium.
  - Impact: Low.
  - Maintenance: Medium-high.

**Opinionated recommendation: 26A.**

---

## AskUserQuestion (Stage 4: Performance)

Recorded decision: `20A, 21A, 22A, 23A, 24A, 25A, 26A`.

If you want to override any Stage 4 choice, reply with the overrides in this format: `20A, 21A, 22A, 23A, 24A, 25A, 26A`.

- Issue 20:
  - **20A (Recommended)** Env-aware pooling + unify DB access behind ports
  - 20B Tune the current split
  - 20C Do nothing
- Issue 21:
  - **21A (Recommended)** Keyset pagination + optional/cached totals
  - 21B Keep offset + add indexes
  - 21C Do nothing
- Issue 22:
  - **22A (Recommended)** Query planner + pre-aggregates for dashboards
  - 22B Index and hope
  - 22C Do nothing
- Issue 23:
  - **23A (Recommended)** Range validity + proper indexing (GiST) + org-aware strategy
  - 23B Composite btree stopgap
  - 23C Do nothing
- Issue 24:
  - **24A (Recommended)** Bulk persistence + outbox; async derived indexes via Temporal
  - 24B Optimize roundtrips in-place
  - 24C Do nothing
- Issue 25:
  - **25A (Recommended)** Push updates + targeted cache updates; polling fallback
  - 25B Tune polling + backoff
  - 25C Do nothing
- Issue 26:
  - **26A (Recommended)** Lazy presigned URLs + short TTL cache; audit on access
  - 26B Default URL generation + cache
  - 26C Do nothing

---

# Stage 5: Frontend Feature Modularization (Decisions Required)

Goal:

- Extract frontend “features” into composable modules so each vertical can reuse, omit, or deeply customize them without forking the entire app.
- Make vertical UX differentiation cheap: swap copy, information architecture, objects, and workflows, while preserving a shared kernel (auth/org/session, evidence lens, command bar, API client, design system).

Concrete evidence:

- TanStack Router file-based routing is used (generated): `apps/web/src/routeTree.gen.ts:1-60`.
- Feature code is currently app-local and coupled to the web shell:
  - Onboarding: `apps/web/src/routes/onboarding/*`
  - Drive: `apps/web/src/routes/dashboard/drive.tsx`
  - Team: `apps/web/src/routes/dashboard/team/*`
  - Sources/Connectors UI: `apps/web/src/routes/dashboard/sources/*`
- UI kit is duplicated across apps (web/admin), already motivating `packages/ui-*`.

## Issue 27: What Is the “Module” Unit (Feature Package Contract)?

**Problem (concrete):**

- Today, “features” are folders inside `apps/web/src/routes/*`. This makes them hard to:
  - reuse across `apps/web`, `apps/admin`, and future `apps/legal`, `apps/accounting`, etc
  - customize per vertical without copy/paste forks
  - test in isolation (feature logic mixes routing, API calls, UI, and app shell assumptions)

**Options:**

- **(27A, Recommended) Introduce a first-class `DroviModule` contract and implement features as packages.**
  - Create a small module runtime contract:
    - `id`, `capabilities`, `navItems`, `commandBarCommands`, `i18nNamespaces`
    - optional `screens` (React components) that are UI-only and depend only on `ui-core` + `api-react` + `core-hooks`
    - typed `overrides` interface per module for vertical customization
  - Package naming (example):
    - `packages/mod-auth`
    - `packages/mod-onboarding`
    - `packages/mod-drive`
    - `packages/mod-teams`
    - `packages/mod-sources`
    - `packages/mod-console`
  - Apps become composition shells: they select a module set, theme pack, and vertical vocabulary.
  - Effort: Medium-high.
  - Risk: Medium (import churn), but mechanical if staged.
  - Impact: Highest reuse + lowest long-term cost.
  - Maintenance: Low (clear seams).

- (27B) Keep features inside each app but reorganize into `apps/web/src/features/*`.
  - Effort: Medium.
  - Risk: Low-medium.
  - Impact: Moderate (better structure), but vertical apps still re-copy work.
  - Maintenance: Medium-high (drift across apps).

- (27C) Micro-frontends/module federation.
  - Effort: Very high.
  - Risk: High.
  - Impact: High in theory, but heavy ops/complexity and usually not “engineered enough” here.
  - Maintenance: High.

**Opinionated recommendation: 27A.**

This matches your DRY + explicitness preferences and makes vertical differentiation cheap without fragile abstractions.

## Issue 28: How Do We Compose Routes with TanStack Router (File-Based Generator vs Code-Based Tree)?

**Problem (concrete):**

- Current apps use file-based routes with `createFileRoute` and generate `routeTree.gen.ts`.
- True route “plug-in” composition is easier with code-based route trees, but that’s a larger migration.

**Options:**

- **(28A, Recommended) Keep file-based routing; modules export “screens” and apps keep tiny route stubs.**
  - Each app keeps files like `apps/web/src/routes/dashboard/drive.tsx`, but the file becomes a thin wrapper:
    - import `DriveScreen` from `@drovi/mod-drive`
    - define `createFileRoute` + loader/search params + render screen
  - Vertical apps can include/omit modules by adding/removing route stubs (or generating them).
  - Effort: Medium.
  - Risk: Low-medium.
  - Impact: High (fast modularization with minimal router churn).
  - Maintenance: Medium-low.

- (28B) Migrate to code-based route tree composition so modules export routes directly.
  - Effort: High (rewrite routing, generation, and conventions).
  - Risk: Medium-high (routing is foundational; easy to regress).
  - Impact: Highest (true module route composition).
  - Maintenance: Low after migration, but the migration is costly.

- (28C) Keep routing as-is and accept “feature modularization” stops at component extraction.
  - Effort: Low.
  - Risk: Medium (you’ll still fork routes per vertical).
  - Impact: Medium-low.
  - Maintenance: Medium-high.

**Opinionated recommendation: 28A.**

It gives 80% of the modularity benefit while avoiding a high-risk router migration.

**Decision (confirmed): 28B (code-based route tree composition).**

Pragmatic implication: we should treat routing as part of the module runtime, not app-local glue. To reduce migration risk, the route-tree rewrite should be staged:

- Stage 1: Introduce a code-based root route tree in each app (web/admin) and mount a small number of module routes first.
- Stage 2: Move the rest of routes under module-owned route trees and delete the file-based generator/plugin usage.
- Stage 3: Enforce “no app-local route logic”; apps become composition shells selecting modules + themes + overrides.

## Issue 29: How Do Verticals Deeply Customize Feature UX Without Forking?

**Problem (concrete):**

- Theme packs change styling, but verticals also need:
  - different object labels and IA (ex: “Matters” not “UIOs”)
  - different default filters, columns, evidence renderers, and actions
  - vertical-specific validation and “guardrails before action”

**Options:**

- **(29A, Recommended) Use typed overrides + “headless core, styled shell” pattern per module.**
  - Each module exports:
    - headless hooks and state machines (`useDriveModel`, `useTeamsModel`)
    - UI “screens” that can be swapped or partially overridden
    - a typed `Overrides` object:
      - copy strings
      - column definitions and renderers
      - additional actions/commands
      - vertical-specific object adapters (mapping backend plugin types to UI)
  - Vertical apps provide overrides via `VerticalRuntimeProvider`.
  - Effort: Medium-high.
  - Risk: Medium (designing good override surfaces takes iteration).
  - Impact: High (vertical differentiation without forks).
  - Maintenance: Medium-low if override surfaces remain explicit.

- (29B) Fork modules per vertical.
  - Effort: Low at first, high long-term.
  - Risk: Medium-high (drift, duplication).
  - Impact: Medium.
  - Maintenance: High.

- (29C) Only theme packs (no behavioral overrides).
  - Effort: Low.
  - Risk: Medium (vertical needs will force forks anyway).
  - Impact: Low for true vertical differentiation.
  - Maintenance: Medium-high.

**Opinionated recommendation: 29A.**

It’s the “engineered enough” middle: explicit override points, no magical dynamic composition.

## Issue 30: Where Does Vertical Configuration Come From (Backend Plugins vs Frontend Static Config)?

**Problem (concrete):**

- Backend will support vertical plugins (Issue 2A). The frontend needs a reliable source for:
  - type registry (namespaced types, schemas)
  - UI hints (timeline shapes, confidence badges, evidence requirements)
  - capability gating (what modules/features are enabled per vertical/org)

**Options:**

- **(30A, Recommended) Add a backend “Plugin Manifest” endpoint and a frontend `vertical-runtime` package that consumes it.**
  - Backend exposes a signed manifest per org/vertical:
    - enabled modules
    - registered object types and their UI hints
    - feature flags/capabilities
  - Frontend uses `packages/vertical-runtime` to provide:
    - `useVertical()`: types, labels, capabilities
    - module override wiring
  - Effort: Medium.
  - Risk: Medium (cross-cutting, but testable with contract tests).
  - Impact: High (one source of truth; safer rollouts).
  - Maintenance: Medium-low.

- (30B) Keep vertical config purely frontend static (per app build).
  - Effort: Low.
  - Risk: Medium (drift between backend capabilities and UI).
  - Impact: Medium.
  - Maintenance: Medium-high across many apps.

- (30C) Hybrid (some backend, some frontend).
  - Effort: Medium.
  - Risk: Medium-high (confusing precedence rules).
  - Impact: Medium-high.
  - Maintenance: Medium-high.

**Opinionated recommendation: 30A.**

It keeps vertical extension coherent across backend + frontend, which matters once multiple verticals ship.

---

## AskUserQuestion (Stage 5: Frontend Modules) (Resolved)

Recorded decision: `27A, 28B, 29A, 30A`.

If you want to override any Stage 5 choice, reply with overrides in this format: `27A, 28B, 29A, 30A`.

- Issue 27:
  - **27A (Recommended)** Feature packages with a first-class `DroviModule` contract
  - 27B Feature folders per app
  - 27C Micro-frontends
- Issue 28:
  - **28A (Recommended)** Keep file-based routing; route stubs import module screens
  - 28B Code-based route tree composition
  - 28C Don’t modularize routing
- Issue 29:
  - **29A (Recommended)** Typed overrides + headless core per module
  - 29B Fork per vertical
  - 29C Theme-only
- Issue 30:
  - **30A (Recommended)** Backend plugin manifest + frontend `vertical-runtime`
  - 30B Frontend static config only
  - 30C Hybrid config
