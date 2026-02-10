# Drovi Extensibility Refactor Tasks (Phased)

Implements the confirmed decisions in:

- `/Users/jeremyscatigna/project-memory/DROVI_EXTENSIBILITY_REFACTOR_PLAN.md`

Non-negotiables:

- Backend: modular monolith, hexagonal boundaries, explicit plugin registry for verticals, Temporal workflows, Kafka event fabric.
- Frontend: shared core packages (API client/types, UI kit, shell/hooks), theme packs for vertical shells.
- Quality: 90%+ backend coverage, deterministic tests, explicit error taxonomy, aggressive DRY.
- Performance: keyset pagination, dashboard pre-aggregates, bi-temporal indexing, async derived indexes, push updates, lazy presigned URLs.

---

## Global Execution Protocol

- [ ] G0.01 Every phase ends with: `bun run lint`, `bun run check-types`, `bun run test:run`, and backend `pytest` with coverage ratchet.
- [ ] G0.02 No modules above 800 LOC after being touched; if a task requires touching a large file, include a sub-task to split it below 800 LOC before phase end.
- [ ] G0.03 No nondeterministic tests: all LLM calls are mocked or replayed; time is controlled via `FakeClock` or Temporal time-skipping.
- [ ] G0.04 No silent failures: replace `except Exception: pass` with explicit handling (logs + metrics + typed error).
- [ ] G0.05 Any breaking API change requires: a migration plan, a compat window, updated OpenAPI snapshot, and updated generated clients.

Backend baseline command:

```bash
docker compose run --rm drovi-intelligence pytest -q --cov=src --cov-report=term-missing --maxfail=1
```

Frontend baseline commands:

```bash
bun run lint
bun run check-types
bun run test:run
```

---

## Phase 0 — CI Guardrails + Test Scaffolding (No Behavioral Changes)

- [x] P0.01 Add `scripts/enforce_loc.py` and CI wiring to fail on files > 800 LOC (allowlist for temporary exemptions, with an expiry date field).
- [x] P0.02 Add backend import boundary enforcement using `import-linter` (contracts for `kernel`, `contexts/*/domain`, `contexts/*/application`, `contexts/*/infrastructure`, `contexts/*/presentation`).
- [x] P0.03 Add backend coverage ratchet: “no decreases” plus a “new/changed files” minimum (start at 80% for changed files; increase later).
- [x] P0.04 Add backend test markers and runners for unit/integration/e2e (`pytest -m unit`, `pytest -m integration`, `pytest -m e2e`).
- [x] P0.05 Add a deterministic test clock fixture that fails if code uses `datetime.utcnow()` directly in domain/application layers.
- [x] P0.06 Add a Fake/Replay LLM harness for tests (recorded fixtures committed under `tests/fixtures/llm/`).
- [x] P0.07 Add frontend Vitest split configs for Node libs and React components (`vitest.node.config.ts`, `vitest.browser.config.ts` with jsdom + RTL).
- [x] P0.08 Add MSW setup and example tests covering: offline, 401/403, 500, pagination, SSE disconnect.
- [x] P0.09 Add Playwright with 1 smoke test that boots web + performs a minimal navigation (no auth yet) to prove harness works.
- [x] P0.10 Add OpenAPI snapshot: commit `openapi/openapi.json` generated from the running FastAPI app.
- [x] P0.11 Add OpenAPI determinism check in CI (generated snapshot must match committed snapshot).
- [x] P0.12 Add OpenAPI breaking-change detection in CI (explicit “break approved” allowlist for intentional changes).
- [x] P0.13 Add a performance budget job (informational only at first): record p95 for hot endpoints and publish as CI artifact.

Definition of done: guardrails land, CI is stricter, no production behavior changes.

---

## Phase 1 — Kernel Utilities (Time, Errors, IDs, Serialization)

### Time Invariant (Issues 4A, 9A)

- [x] P1.01 Create `drovi-intelligence/src/kernel/time.py` with one supported API (tz-aware UTC internally).
- [x] P1.02 Replace all `utc_now()` clones with kernel clock; delete duplicates (target: 0 local `utc_now()` definitions).
- [x] P1.03 Add runtime assertion helpers (domain/application only accept tz-aware datetimes; adapters coerce at boundaries).
- [x] P1.04 Add unit tests that fail on naive datetime usage in domain/application code.
- [x] P1.05 Fix known offenders (example: `drovi-intelligence/src/orchestrator/state.py` uses `datetime.utcnow` defaults; migrate to kernel time).

### Error Taxonomy (Issue 11A)

- [x] P1.06 Add `drovi-intelligence/src/kernel/errors.py` with typed error hierarchy + stable error codes.
- [x] P1.07 Add `drovi-intelligence/src/kernel/http/errors.py` that maps errors to FastAPI responses consistently (include `request_id`).
- [x] P1.08 Replace “broad except + generic 500” patterns in hot endpoints with typed errors and consistent mapping.
- [x] P1.09 Add tests asserting error payload shape is stable (web/admin clients depend on it).

### IDs + Hashing + Serialization

- [x] P1.10 Add `drovi-intelligence/src/kernel/ids.py` for ID generation (prefix conventions for evidence/UIOs/outbox/workflows).
- [x] P1.11 Add `drovi-intelligence/src/kernel/hashing.py` for content hash + segment hash + idempotency keys.
- [x] P1.12 Add `drovi-intelligence/src/kernel/serialization.py` for JSON coercion rules (no ad-hoc conversions in hot paths).
- [x] P1.13 Add deterministic tests for hashes and serialization (including edge cases: unicode normalization, whitespace-only evidence, huge payloads).

Definition of done: kernel exists; time/errors/hashing are centralized; tests prevent regressions.

---

## Phase 2 — Backend Architecture Skeleton (Hexagonal + Plugin Registry)

### Structure + Boundaries (Issues 1A, 8A, 7A)

- [x] P2.01 Create `drovi-intelligence/src/contexts/` with initial contexts: `auth`, `org`, `connectors`, `ingestion`, `evidence`, `uio_truth`, `documents`, `search`, `notifications`, `admin_ops`.
- [x] P2.02 For each context, add empty `domain/`, `application/`, `infrastructure/`, `presentation/` packages with `__init__.py` and boundary docs.
- [x] P2.03 Add a small “layer tag” mechanism (module-level constant or docstring tag) so tooling can enforce “presentation must be thin”.
- [x] P2.04 Add “anti-corruption adapters” so existing routes can call new use-cases without immediate rewrites.
- [x] P2.05 Add docs: `docs/architecture/module_rubric.md` with concrete examples mapping current files to future contexts.
- [x] P2.06 Add CI rule: if a file is touched and is >800 LOC, it must be split as part of the PR (or explicitly exempted with expiry).

### Plugin Registry (Issue 2A)

- [x] P2.07 Implement `drovi-intelligence/src/plugins/registry.py` with an explicit plugin list loaded from settings (no implicit discovery).
- [x] P2.08 Define `VerticalPlugin` contract (type registrations, schema validators, extraction specs, contradiction rules, UI hints).
- [x] P2.09 Implement “core plugin” registering today’s base UIO types and extraction schemas.
- [x] P2.10 Replace hardcoded valid-type lists in API routes with plugin-backed validation (example: `drovi-intelligence/src/api/routes/uios.py` has a hardcoded `valid_types` list).
- [x] P2.11 Add tests for plugin registration behavior and deterministic load order.
- [x] P2.12 Add a backend “Plugin Manifest” endpoint (per org/vertical) that returns enabled modules, registered types, UI hints, and capabilities (Stage 5, Issue 30A).
- [x] P2.13 Add contract tests for the manifest shape (OpenAPI snapshot), and cache the manifest safely (ETag/TTL) to avoid per-page recomputation. Generated client compilation will be enforced in Phase 7 once clients exist.

Definition of done: contexts and plugins exist; boundaries are enforceable; core still works through adapters.

---

## Phase 3 — Security and Auth Consolidation (Issue 5A)

- [x] P3.01 Consolidate on a single `AuthContext` for request handling; remove “multiple context” ambiguity across routes.
- [x] P3.02 Replace static internal token patterns with short-lived internal JWT (claims include org binding; no org_id from body/query).
- [x] P3.03 Guard any dev-only bypass behind explicit `ENVIRONMENT=development` checks; ensure it is impossible in prod builds.
- [x] P3.04 Add explicit authorization policy functions per context (org membership, connection visibility, evidence access, admin-only).
- [x] P3.05 Add tests for internal JWT cross-org rejection, SSE/private-source non-leakage, and org_id mismatch rejection.
- [x] P3.06 Add security regression E2E tests (minimal): user A cannot access user B’s private connection evidence via API.

Definition of done: security boundary is simpler to reason about; token handling is safer; tests cover leakage paths.

---

## Phase 4 — Temporal Workflows (Issues 3B, 16A)

### Temporal Infrastructure

- [ ] P4.01 Add Temporal server to `/Users/jeremyscatigna/project-memory/docker-compose.yml` with persistence (dev).
- [ ] P4.02 Add a dedicated worker service `drovi-temporal-worker` and a Python package `src/contexts/workflows/` (or `src/workflows/`) that hosts workflow definitions.
- [ ] P4.03 Add health checks and operational docs at `docs/ops/temporal.md` (namespaces, task queues, failure modes, replay safety).

### Workflow Model

- [ ] P4.04 Implement `ConnectorBackfillWorkflow` (windowed, resumable, rate-limited).
- [ ] P4.05 Implement `ConnectorSyncWorkflow` (incremental, cursor-based, idempotent).
- [ ] P4.06 Implement `ConnectorWebhookIngestWorkflow` (inbox/outbox, dedupe).
- [ ] P4.07 Implement `DerivedIndexBuildWorkflow` (outbox drain, batching, backpressure).
- [ ] P4.08 Remove APScheduler from production execution paths (dev-only tooling allowed only if clearly separated).

### Temporal Testing

- [ ] P4.09 Add in-process Temporal tests using time-skipping for retries/backoff/cancellation.
- [ ] P4.10 Add a minimal docker integration suite validating worker+server wiring.

Definition of done: periodic sync/backfill is Temporal-first; tests cover the workflow semantics.

---

## Phase 5 — Connectors: Definition-Driven + Conformance Harness (Issues 10A, 17A)

### ConnectorDefinition

- [ ] P5.01 Create `ConnectorDefinition` for each connector and move stream defaults/capabilities/provider limits into the connector module.
- [ ] P5.02 Update `ConnectionService` to be a thin adapter around `ConnectorDefinition` (no hardcoded connector mappings).
- [ ] P5.03 Standardize rate limit handling and retry/backoff policies per connector definition.

### Conformance Harness

- [ ] P5.04 Add `tests/connectors/conformance/` harness that every connector must pass.
- [ ] P5.05 Add conformance tests for idempotency (same event twice => one canonical write).
- [ ] P5.06 Add conformance tests for cursor monotonicity and resumable windows (including crash-restart scenarios).
- [ ] P5.07 Add replay tests (Kafka/UEM reprocessing does not duplicate truth).
- [ ] P5.08 Add property-based tests (Hypothesis) for cursor/window edge cases and dedupe keys.

### Observability + DLQ

- [ ] P5.09 Standardize connector metrics (sync lag, records/sec, retries, DLQ, last success) and expose in `/metrics`.
- [ ] P5.10 Standardize DLQ payload format and add an operator “replay DLQ” command/tool.

Definition of done: connectors are extensible and measurable; connector reliability is enforced by tests, not demos.

---

## Phase 6 — Truth-First Persistence + Outbox + Async Derived Indexes (Issue 24A)

### Decompose the Hot Path (Issue 15A + LOC cap)

- [ ] P6.01 Split `drovi-intelligence/src/orchestrator/nodes/persist.py` into context-owned application services under `contexts/uio_truth/application/` and `contexts/evidence/application/` (target: modules under 800 LOC).
- [ ] P6.02 Make the LangGraph “persist node” a thin adapter that calls an application use-case (no SQL/graph writes directly in the node).
- [ ] P6.03 Introduce fakes for unit tests: `FakeClock`, `FakeLLM`, `FakeObjectStore`, `FakeGraphStore`, `FakeVectorIndex`.

### Canonical Writes Only (Truth Store First)

- [ ] P6.04 Refactor persistence so the hot path writes only canonical truth (Postgres UIO + evidence spans + audit).
- [ ] P6.05 Convert per-item inserts (especially supporting evidence spans) into batched inserts.
- [ ] P6.06 Add invariants: “no evidence => no persist” for high-stakes types; verify in tests.

### Outbox

- [ ] P6.07 Add or finalize `outbox_event` table with idempotency key + status + attempts + last_error + payload versioning.
- [ ] P6.08 Emit outbox events from canonical writes (UIO created/updated/superseded; evidence artifact registered; document chunked).

### Derived Indexers (Async + Batched)

- [ ] P6.09 Implement outbox draining as a Temporal activity/workflow (batch size, backpressure, retry policy).
- [ ] P6.10 Implement batched graph upserts (Falkor) with idempotency.
- [ ] P6.11 Implement batched embedding generation and vector updates (hybrid retrieval) with idempotency.
- [ ] P6.12 Add end-to-end integration tests: ingest sample payload => canonical truth => derived indexes => query returns evidence-backed results.

Definition of done: ingestion/backfill throughput improves; hot path is stable; derived indexes become resilient and replayable.

---

## Phase 7 — OpenAPI Contract + Generated Clients (Issues 6A, 13A, 19A)

### Contract-of-Record

- [ ] P7.01 Make FastAPI OpenAPI generation deterministic (stable ordering, stable names).
- [ ] P7.02 Commit `openapi/openapi.json` snapshot and enforce drift detection.
- [ ] P7.03 Add breaking-change detection tooling in CI with explicit approvals.

### Generated Packages

- [ ] P7.04 Create `packages/api-types` generated from OpenAPI (types only).
- [ ] P7.05 Create `packages/api-client` with auth injection (cookie, API key, internal JWT), retries/backoff/timeouts, and consistent error parsing.
- [ ] P7.06 Create `packages/api-react` with React Query key conventions plus SSE/WS helpers.
- [ ] P7.07 Add CI step: generated client builds and typechecks across all apps.

### App Migration (Strangler)

- [ ] P7.08 Add a compat facade in `apps/web` so current call sites can switch without big-bang rewrites.
- [ ] P7.09 Migrate `apps/web` route-by-route off `apps/web/src/lib/api.ts`; delete dead code as you go.
- [ ] P7.10 Migrate `apps/admin` to the same packages (no forks).
- [ ] P7.11 Delete or shrink `apps/web/src/lib/api.ts` to a thin legacy shim (then remove entirely once unused).

Definition of done: API drift risk collapses; multi-app scaling becomes cheap.

---

## Phase 8 — Frontend Core Packages + Themeable Design System (Issues 12A, 18A)

### UI Packages (DRY)

- [ ] P8.01 Create `packages/ui-core` and move shared UI components from web/admin into it.
- [ ] P8.02 Create `packages/ui-theme` (CSS variable tokens, typography strategy, motion primitives) with “theme packs” for future vertical shells.
- [ ] P8.03 Migrate `apps/web` to import from `packages/ui-*` and delete duplicated UI components.
- [ ] P8.04 Migrate `apps/admin` similarly; ensure no visual regressions.

### Core Shell + Hooks

- [ ] P8.05 Create `packages/core-hooks` (auth/org context, streaming subscriptions, feature flags).
- [ ] P8.06 Create `packages/core-shell` (sidebar shell, command bar, evidence lens primitives, timeline primitives).

### Feature Modules + Vertical Runtime (Stage 5: Issues 27A, 28B, 29A, 30A)

- [ ] P8.07 Create `packages/mod-kit` defining the `DroviModule` contract (id, capabilities, routes, nav items, command palette commands, i18n namespaces, typed overrides).
- [ ] P8.08 Create `packages/vertical-runtime` that fetches and caches the backend plugin manifest (enabled modules, type registry, UI hints, capabilities) and exposes `VerticalRuntimeProvider` + `useVertical()`.
- [ ] P8.09 Define the typed override mechanism (per module) and a safe precedence order: app static overrides first, then org/vertical manifest gating.

### Code-Based Router Composition (Stage 5: Issue 28B)

- [ ] P8.10 Create `packages/app-router` to compose a code-based TanStack Router tree from a selected module set.
- [ ] P8.11 Define canonical route boundaries in `packages/app-router` (`Root`, `Auth`, `Onboarding`, `Dashboard`) so modules attach consistently.
- [ ] P8.12 Migrate `apps/web` from `routeTree.gen.ts` to the code-based route tree (paths must remain stable; keep redirects for old paths/search params if needed).
- [ ] P8.13 Migrate `apps/admin` from `routeTree.gen.ts` to the code-based route tree.
- [ ] P8.14 Remove `@tanstack/router-plugin` usage (Vite plugin + generated files) once both apps no longer depend on `routeTree.gen.ts`.

### Feature Package Extraction (Stage 5: Issues 27A, 29A)

- [ ] P8.15 Create `packages/mod-auth` (login, forgot/reset password, session refresh, logout, route guards) with explicit extension points (copy, policy gates, post-login redirect).
- [ ] P8.16 Create `packages/mod-onboarding` (create org, invite team, connect sources, completion) with overridable steps and copy, and an explicit “required capabilities” check.
- [ ] P8.17 Create `packages/mod-sources` (connector catalog, connect/disconnect, backfill controls, live sync indicators, error diagnostics) with overrides for allowed connectors/policies.
- [ ] P8.18 Create `packages/mod-teams` (members, invitations, roles/visibility surfaces) with overrides for role terminology and permissions presentation.
- [ ] P8.19 Create `packages/mod-drive` (document upload/list/search, ingestion status, evidence preview entry points) with overrides for folder/tags model and vertical-specific facets.
- [ ] P8.20 Create `packages/mod-evidence` (evidence lens, artifact viewer, “show me where we said that” primitives) with overrides for redaction and access policy surfaces.
- [ ] P8.21 Create `packages/mod-ask` (ask/search/chat surfaces, SSE streaming UI, citations display) with overrides for vertical prompt presets and result renderers.
- [ ] P8.22 Create `packages/mod-console` (console query UI, ops diagnostics) and gate it behind capability flags (internal/admin only).
- [ ] P8.23 Create `packages/mod-continuums` (continuum list, builder entry points, marketplace/exchange surfaces) with overrides for vertical “pattern libraries”.
- [ ] P8.24 Replace `apps/web/src/routes/*` feature implementations with module imports; delete app-local feature code after parity is reached.
- [ ] P8.25 Replace `apps/admin/src/routes/*` feature implementations with module imports; delete app-local feature code after parity is reached.
- [ ] P8.26 Add module-level unit tests for headless models (state machines) and component tests for screens (RTL + MSW).
- [ ] P8.27 Add a module composition test that builds a route tree from a chosen module set and asserts expected paths, nav gating, and command registration.
- [ ] P8.28 Add module-level i18n packaging: each `mod-*` exports namespaces + default dictionaries; `vertical-runtime` can override strings per vertical/org.
- [ ] P8.29 Add module boundary enforcement for frontend (ban importing from `apps/*` into `packages/*`; ban deep imports; require public entrypoints).

### Frontend Tests

- [ ] P8.30 Implement Vitest split configs (Node and jsdom) and add RTL for component tests.
- [ ] P8.31 Add MSW coverage for error/offline/SSE edge cases on the most important screens.
- [ ] P8.32 Add Playwright critical flows: signup/login, onboarding, connect source (mock), backfill progress, evidence open, ask/search.
- [ ] P8.33 Add module dependency validation (frontend): each `mod-*` declares allowed dependencies; CI fails on cross-module imports that bypass the contract.
- [ ] P8.34 Add route-level lazy loading per module (code splitting) so vertical apps can ship smaller bundles and load rare modules on demand.

Definition of done: frontend becomes a reusable platform; vertical apps won’t require copy-paste UI.

---

## Phase 9 — Performance Upgrades (Issues 20A–26A)

### DB Pooling + Unification (Issue 20A)

- [ ] P9.01 Make SQLAlchemy pooling env-aware (container default pooled; serverless uses `NullPool` behind a flag).
- [ ] P9.02 Hide raw asyncpg behind a DB port and ban direct pool usage in presentation/application layers.
- [ ] P9.03 Add a load test validating connection churn improvement and stable p95 for hot endpoints.

### Keyset Pagination + Optional Totals (Issue 21A)

- [ ] P9.04 Add keyset pagination for UIO list (cursor based on `(created_at, id)`); update OpenAPI and generated clients.
- [ ] P9.05 Add keyset pagination for documents, tickets, and any “always used” list endpoints.
- [ ] P9.06 Make totals optional by default; add cached totals for dashboards (admin).

### Dashboard Query Planner + Pre-Aggregates (Issue 22A)

- [ ] P9.07 Implement a query planner for Console endpoints to only join tables required by active filters/sorts.
- [ ] P9.08 Add pre-aggregate tables for per-org counts and histogram buckets; update on write via outbox/Temporal.
- [ ] P9.09 Update endpoints to use pre-aggregates first, then fall back to live queries.

### Bi-Temporal Indexing (Issue 23A)

- [ ] P9.10 Implement `tstzrange(valid_from, valid_to)` validity modeling and GiST index strategy; add org-aware indexing strategy.
- [ ] P9.11 Update “as-of” queries to use range containment; add regression tests for time-slice correctness.

### Push Updates + Targeted Cache Updates (Issue 25A)

- [ ] P9.12 Add streaming topics for document changes and sync progress (SSE/WS).
- [ ] P9.13 Replace Drive polling with push updates + fallback polling only when streaming unavailable.
- [ ] P9.14 Replace broad React Query invalidations with targeted cache updates keyed by org/document/UIO.

### Lazy Presigned URLs (Issue 26A)

- [ ] P9.15 Change evidence artifact metadata endpoint default to `include_url=false`.
- [ ] P9.16 Add explicit “request presigned URL” flow; cache URLs briefly; record audit on actual access.
- [ ] P9.17 Update frontend evidence viewers to fetch URLs lazily.

Definition of done: system scales better with real pilots; UI feels “live” without hammering the API.

---

## Phase 10 — Vertical Extensibility: Storage + Plugins + App Templates (Issue 2A)

### Hybrid Storage Strategy

- [ ] P10.01 Define extension storage rules (canonical UIO truth spine; typed vertical tables for high-value queries; validated JSONB for long-tail fields).
- [ ] P10.02 Implement plugin-provided validators for extension JSONB payloads.
- [ ] P10.03 Implement plugin-provided migrations for typed vertical tables (explicit versioning).
- [ ] P10.04 Add contract tests ensuring plugin schemas validate stored extensions and migrations run in CI.

### Reference Plugins

- [ ] P10.05 Add `plugins/legal` registering types like `legal.matter`, `legal.advice` plus contradiction/timeline hints.
- [ ] P10.06 Add `plugins/accounting` registering types like `accounting.filing_deadline` plus extraction/timeline hints.

### Vertical App Templates

- [ ] P10.07 Scaffold `apps/legal`, `apps/accounting`, `apps/gov`, `apps/construction` as thin shells importing `packages/*`.
- [ ] P10.08 Add a per-vertical vocabulary pack and `ui-theme` pack; ensure apps can look meaningfully different without forking components.
- [ ] P10.09 Document “How to build a new vertical in 1 day” (plugin + theme + app template + contract tests).
- [ ] P10.10 For each vertical app, define an explicit module set + typed overrides (auth/onboarding/drive/teams/sources/etc) and wire `vertical-runtime` to backend manifests.

Definition of done: adding a new vertical is a plugin + theme + app, not core rewrites.

---

## Phase 11 — Coverage to 90%+ + Hardening

- [ ] P11.01 Increase backend coverage gate to 90%+ once the ratchet makes it feasible.
- [ ] P11.02 Add targeted tests for prior hotspots (post-refactor equivalents): persistence, UIO lifecycle, streaming worker, GraphRAG/query, connectors.
- [ ] P11.03 Add chaos tests for partial outages (Kafka down, Falkor down, object store down) with correctness invariants.
- [ ] P11.04 Add a pilot-scale load test scenario (simulate 250-user org): backfill + live sync + dashboard usage + evidence opens.
- [ ] P11.05 Delete deprecated code paths and remove transitional exemptions from import-linter/LOC rules.

Definition of done: production-ready, extensible kernel suitable for multiple vertical shells.
