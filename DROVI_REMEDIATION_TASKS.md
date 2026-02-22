# Drovi Repo Remediation Task Tracker

Status legend:
- `[ ]` Not started
- `[-]` In progress
- `[x]` Completed
- `[!]` Blocked

Execution rule:
- Tasks are executed in strict numeric order.
- No destructive deletes. Prefer compatibility-safe fixes and migrations.

## P0 Runtime and Security

- [x] 1. Repair `/connections/oauth/initiate` to use the correct OAuth manager contract and provider mapping.
- [x] 2. Add a canonical token store factory and unify token API (`store_tokens/get_tokens/delete_tokens`).
- [x] 3. Fix `/connections/oauth/callback/{connection_id}` and `/connections/{connection_id}/test` to use canonical token APIs.
- [x] 4. Replace Gmail watch `token_manager` usage with existing token/auth service abstractions.
- [x] 5. Implement OAuth revoke + scheduled sync cancellation in connection delete path.
- [x] 6. Implement synchronous orchestrator fallback in raw event ingest when Kafka is unavailable.
- [x] 7. Add scope/org auth dependencies to all `/stream/*` endpoints.
- [x] 8. Add scope/org auth dependencies to all `/workflows/*` endpoints.
- [x] 9. Remove weak connector token key fallback and enforce managed key configuration + rotation path.
- [x] 10. Implement real Apple identity JWT validation in Imperium domain layer.

## P1 Product Wiring

- [x] 11. Wire `useSnoozeUIO` to backend snooze endpoint and preserve chosen snooze date.
- [x] 12. Wire task-priority mutation hook to backend task-priority endpoint.
- [x] 13. Align task status mutations to typed task-status endpoint where applicable.
- [x] 14. Implement source viewer for decisions/commitments/tasks/UIO detail surfaces.
- [x] 15. Implement persisted team discussion threads/comments for UIO/decision/commitment/task details.
- [x] 16. Implement confidence breakdown detail model + UI rendering in console detail panel.
- [x] 17. Replace decisions client-only semantic search with backend-assisted query.
- [x] 18. Implement supersession chain retrieval/rendering end-to-end for decisions list/detail.
- [x] 19. Replace commitment follow-up template fallback with generation service call and traceability.
- [x] 20. Implement saved-search persistence (API + DB + hook + UI actions).
- [x] 21. Implement multi-org switching in auth client/store and enable TeamSwitcher action path.
- [x] 22. Implement password reset request/confirm backend endpoints and wire frontend flow.
- [x] 23. Add org security API client in web app and wire settings security card to live controls.
- [x] 24. Enable SSO management UX from settings once org security wiring is complete.

## P2 Backend Placeholder Completion

- [x] 25. Implement monitoring metrics summary from real telemetry sources.
- [x] 26. Implement decay stats query from graph/DB instead of placeholder response.
- [x] 27. Persist blindspot dismissals and feed back to detection tuning.
- [x] 28. Implement calibration prediction storage/read/update and resolved-prediction retrieval.
- [x] 29. Implement derivation-rule execution engine in `evolve_memory`.
- [x] 30. Implement recipient extraction logic in `persist_raw` from message metadata.
- [x] 31. Implement concrete vector/fulltext index creation for FalkorDB/RediSearch path.
- [x] 32. Implement Notion webhook event queue processing (router placeholder to worker path).
- [x] 33. Implement Microsoft webhook event queue processing (router placeholder to worker path).
- [x] 34. Implement Slack message metadata and channel-refresh action handlers beyond log-only behavior.
- [x] 35. Implement evidence derived index projection processing (replace no-op indexer).
- [x] 36. Resolve stale frontend `sseAPI` surface via compatibility routing or full client migration.
- [x] 37. Reconcile duplicate OAuth initiation surfaces (`/connections/oauth/*` vs `/org/connections/*`) with compatibility wrappers.
- [x] 38. Decide and integrate or retire-in-place unused `TaskVirtualList` and related dead actions safely.
- [x] 39. Implement landing demo modal behavior for watch-demo CTA.

## Test Program and Quality Gates

- [x] 40. Add regression tests for OAuth flow, authz, fallback processing, and Apple verify critical paths.
- [x] 41. Add frontend route tests for decision/commitment/task/UIO detail interactions and mutation wiring.
- [x] 42. Add admin and landing smoke tests (currently zero test files).
- [x] 43. Add contract tests to catch endpoint drift between frontend API surfaces and backend routers.
- [x] 44. Add CI gates for critical route/auth regression and minimum route-level test presence.

## Progress Log

- 2026-02-21: Tracker created. Task 1 started.
- 2026-02-21: Completed tasks 1-5 (OAuth flow fixes, canonical token store wiring, Gmail token manager cleanup, connection delete revoke/cancel cleanup).
- 2026-02-21: Completed task 6 (raw ingest now has synchronous normalize→enrich→extract fallback when Kafka is unavailable or produce fails).
- 2026-02-21: Completed task 7 (added read scope + org boundary validation across `/stream` SSE endpoints).
- 2026-02-21: Completed task 8 (added scope + org authorization checks across all `/workflows/*` routes).
- 2026-02-21: Completed task 9 (replaced weak fallback token crypto with managed connector key config and decrypt-time rotation support).
- 2026-02-21: Completed task 10 (implemented real Apple identity token verification using Apple JWKS with RS256 signature/issuer/audience/time checks).
- 2026-02-21: Completed task 11 (`useSnoozeUIO` now calls `/uios/{id}/snooze` with the selected date instead of status fallback).
- 2026-02-21: Completed task 12 (`useUpdateTaskPriorityUIO` now calls the typed `/uios/{id}/task-priority` endpoint).
- 2026-02-21: Completed task 13 (`useUpdateTaskStatusUIO` now uses typed `/uios/{id}/task-status` mutation path).
- 2026-02-21: Completed task 14 (added shared source-detail viewer sheet and wired source rows in decision/commitment/task detail pages).

- 2026-02-21: Completed task 15 (persisted UIO discussion comments API + hooks + reusable TeamDiscussion component wired into decision/commitment/task detail pages).
- 2026-02-21: Completed task 16 (console query now returns typed confidence breakdown extraction context and detail panel renders full confidence rationale/model/evidence metadata).
- 2026-02-21: Completed task 17 (decisions search now uses backend hybrid search + UIO hydration instead of client-side text filtering).
- 2026-02-21: Completed task 18 (added decision supersession-chain API + typed client/hook and wired decisions list dialog/detail surfaces to real chain data).
- 2026-02-21: Completed task 19 (commitment follow-up now calls backend generation endpoint with LLM trace metadata and clipboard draft delivery; frontend template fallback removed).
- 2026-02-21: Completed task 20 (added `console_saved_search` migration + `/console/saved-searches` list/create/delete APIs, wired React Query saved-search hooks, replaced placeholder hook, and added save/apply/delete UI actions in Console page).
- 2026-02-21: Completed task 21 (added `/auth/organizations` + `/auth/switch-organization` backend endpoints, added multi-org state/switch action in auth store/client, and enabled real TeamSwitcher org switching flow).
- 2026-02-21: Completed task 22 (added password reset request/confirm APIs + token persistence migration, wired auth API client methods, enabled forgot/reset password forms, and linked sign-in to live reset flow).
- 2026-02-21: Completed task 23 (added typed org-security API client surface and wired Settings security card to live org security policy read/update controls).
- 2026-02-21: Completed task 24 (enabled dedicated SSO management UX in Settings with live policy status, quick SSO modes, fallback environment controls, and persisted org policy updates).
- 2026-02-21: Completed task 25 (replaced monitoring metrics-summary placeholders with live Prometheus telemetry aggregation for extraction/sync/search/LLM/event summary metrics).
- 2026-02-21: Completed task 26 (replaced `/monitoring/decay-stats` placeholder output with live graph relevance/archival aggregation queries + last decay timestamp parsing, and updated monitoring API tests to assert real aggregated values via mocked graph queries).
- 2026-02-21: Completed task 27 (added `blindspot_feedback` persistence migration, implemented dismissal upsert + actor/reason metadata storage, and wired blindspot detection feedback tuning to suppress or de-prioritize recently dismissed blindspots by fingerprint/type).
- 2026-02-21: Completed task 28 (added `intelligence_prediction` persistence migration and implemented calibration service PostgreSQL storage/update/read/resolved-query paths, including typed row parsing and unit tests for persistence/update/resolved retrieval behavior).
- 2026-02-21: Completed task 29 (implemented DB-backed derivation-rule execution in `evolve_memory`, including active rule loading, placeholder-template rendering against graph matches, deduplicated derived `Entity` creation with `DERIVED_FROM` edges, and rule usage counters).
- 2026-02-21: Completed task 30 (implemented message-recipient extraction in `persist_raw` from normalized/connector metadata, replacing placeholder fallback with robust email parsing + deduping + sender exclusion, and added focused unit tests).
- 2026-02-21: Completed task 31 (implemented concrete Falkor vector/fulltext index creation with syntax fallbacks, default label/property index orchestration, and updated graph client tests from placeholder behavior to query execution assertions).
- 2026-02-21: Completed task 32 (implemented `NotionWebhookHandler` with connection resolution + inbox/outbox enqueue + Kafka-disabled sync fallback, replaced `/webhooks/notion` placeholder queue path with real handler wiring/response telemetry, added webhook router + handler unit tests, and began persisting Notion workspace metadata in OAuth callback config for deterministic webhook routing).
- 2026-02-21: Completed task 33 (implemented `MicrosoftWebhookHandler` for Graph notifications with connector inference/target resolution + inbox/outbox queueing + Kafka-disabled fallback sync, replaced `/webhooks/microsoft` placeholder queue path with real aggregated processing telemetry, added router + handler unit tests, and started persisting Microsoft tenant/user metadata in OAuth callback config for webhook routing fidelity).
- 2026-02-21: Completed task 34 (implemented concrete Slack metadata/channel-refresh handlers by queueing `slack.message_metadata` and `slack.refresh_channels` events through webhook inbox/outbox with fallback webhook sync execution when Kafka is disabled, improved Slack connection resolution with single-connection fallback for legacy configs, and added focused unit coverage for the new action paths).
- 2026-02-21: Completed task 35 (replaced `indexes.evidence.artifact.registered` no-op processor with real derived projection: evidence-artifact graph upsert, stale-projection deletion on missing/retention-deleted artifacts, deterministic relationship rebuild to related documents/chunks/contradictions/UIOs, and unit tests for projection + deletion paths).
- 2026-02-21: Completed task 36 (resolved stale `apps/web` `sseAPI` by migrating legacy `/api/v1/sse/*` calls to canonical SSE surfaces: `/api/v1/org/connections/events` with connection-filter + SyncEvent→SyncStatus compatibility mapping and `/api/v1/stream/intelligence` with org-aware subscription, plus updated SSE unit tests and verified with vitest + TypeScript check).
- 2026-02-21: Completed task 37 (reconciled duplicate OAuth initiation surfaces by adding legacy response compatibility (`auth_url` alias) on `/connections/oauth/initiate`, migrating web `connectionsAPI.initiateOAuth` to canonical `/org/connections/{provider}/connect` while preserving legacy return shape, and adding package-level regression tests for wrapper behavior).
- 2026-02-21: Completed task 38 (integrated `TaskVirtualList` into the live tasks route for large flat lists via threshold-based activation, removed dead virtual-row actions by wiring status/priority dropdown callbacks plus star/archive callbacks, and added focused virtual-list interaction tests with browser Vitest coverage).
- 2026-02-21: Completed task 39 (implemented a real landing demo-modal flow for watch-demo CTA: added `DemoModal` with direct-video/embed support via `NEXT_PUBLIC_LANDING_DEMO_URL`, fallback private-briefing path when demo media is unavailable, wired hero CTA to open modal, and removed TODO scroll fallback behavior).
- 2026-02-21: Completed task 40 (added critical regression coverage suites: connections OAuth initiate/callback compatibility tests, stream/workflow org-authz boundary tests, `/events/ingest` synchronous fallback tests, and Imperium-domain Apple identity validation guardrail tests for audience and algorithm rejection paths; validated Python suites via `py_compile` and Rust tests via targeted `cargo test`).
- 2026-02-21: Completed task 41 (added browser-route regression tests for decision, commitment, task, and UIO detail pages to assert live interaction-to-mutation wiring paths, including verify/complete/status-shortcut behaviors, with mocked TanStack route context and passing Vitest + TypeScript validation).
- 2026-02-21: Completed task 42 (added first smoke suites in previously untested apps: admin login-route `beforeLoad` smoke coverage and landing page CTA/modal state smoke coverage, plus dedicated `vitest.admin.config.ts` and `vitest.landing.config.ts` for per-app alias correctness; both smoke suites pass).
- 2026-02-21: Completed task 43 (added endpoint contract-drift test suite that extracts frontend API surfaces from `packages/api-client` plus live web SSE/health endpoints, parses backend FastAPI router wiring from Python route modules + `api/main.py`, normalizes dynamic segments, and fails on missing backend coverage; fixed discovered drift by aligning `generateBrief` to backend `/brief/refresh` route).
- 2026-02-21: Completed task 44 (added CI route/auth hard gates: new route-level test presence checker script + critical regression test script in `package.json`, introduced dedicated `critical-regression` workflow job, extended docker-build dependency chain to require that gate, and added explicit backend critical auth/route pytest run for `tests/unit/api/test_connections_oauth_regression.py`, `test_stream_workflows_authz.py`, and `test_events_ingest_fallback.py`).
