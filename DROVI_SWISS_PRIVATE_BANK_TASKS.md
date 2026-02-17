# Drovi — Swiss Private Bank of Truth (Execution Tasks)

This task plan implements `/Users/jeremyscatigna/project-memory/DROVI_SWISS_PRIVATE_BANK_PLAN.md` in production order.

## Phase 0 — Program Setup and Baseline (Week 0)
- [x] Create a dedicated transformation branch and milestone board.
- [x] Freeze non-critical feature work during this migration window.
- [x] Define baseline metrics snapshot:
  - [x] Page load p95
  - [x] Ask latency p95
  - [x] Ingestion lag p95
  - [x] Contradiction rate
  - [x] % records with evidence links
- [ ] Publish old-money doctrine as an internal RFC and get sign-off.
- [x] Create a “Terminology Migration Matrix” mapping old labels to institutional vocabulary.

Exit criteria:
- [x] Baseline dashboard captured and versioned.
- [ ] Doctrine accepted by product, engineering, design, and GTM owners.

## Phase 1 — Language and Information Architecture Migration (Week 1)
- [x] Replace user-facing copy across web/admin/API docs with institutional lexicon.
- [x] Rename sidebar/navigation labels to new nouns.
- [x] Replace all playful or hype empty-state/error strings with formal operational wording.
- [x] Introduce content lint checks for banned terms in frontend strings.
- [x] Add localization keys for EN/FR institutional voice.
- [x] Verify all translation keys resolve (no raw i18n keys rendered).

Tests:
- [x] i18n snapshot tests for key pages.
- [x] UI smoke tests validating no banned terms in critical flows.

Exit criteria:
- [x] 100% of top-level navigation and detail surfaces use new vocabulary.
- [x] No unresolved translation keys in production routes.

## Phase 2 — Old-Money Design System Foundation (Week 1-2)
- [x] Create a formal theme package in shared frontend packages:
  - [x] Color tokens (forest/navy/parchment/stone/gold)
  - [x] Type scale + font pairing tokens
  - [x] Spacing, borders, elevation, motion tokens
- [x] Add “institutional” component variants for:
  - [x] Table
  - [x] Timeline rail
  - [x] Badge/seal
  - [x] Dossier panel
  - [x] Evidence popover
- [x] Remove loud gradients/shadows from legacy components.
- [x] Establish strict motion presets (short fade/slide only).
- [x] Add visual regression snapshots for primary pages.

Tests:
- [x] Storybook visual tests for theme variants.
- [x] Accessibility checks (contrast, focus states, keyboard flow).

Exit criteria:
- [x] Shared DS package consumed by web and admin apps.
- [x] Institutional theme applied without layout regressions.

## Phase 3 — Frontend Module Hardening and Extraction (Week 2-3)
- [x] Extract independent feature modules (auth, onboarding, sources, drive, teams, trust, agents) with clear APIs.
- [x] Move module state/actions to package-scoped hooks.
- [x] Ensure modules can be enabled/disabled per vertical config.
- [x] Add module-level theming and vocabulary override support.
- [x] Build a “vertical manifest” contract:
  - [x] Feature toggles
  - [x] Object naming map
  - [x] Navigation composition

Tests:
- [x] Unit tests for each module contract.
- [x] Integration tests for cross-module auth/org context.

Exit criteria:
- [x] Core web shell composes only via module manifests.
- [x] No direct hard-coded vertical terms in core modules.

## Phase 4 — Proof-First UX Pass on Core Surfaces (Week 3)
- [x] Rework record lists to always show:
  - [x] Evidence count
  - [x] Last verified timestamp
  - [x] Confidence seal
  - [x] Supersession state
- [x] Add fixed “Evidence rail” on detail pages.
- [x] Add supersession timeline blocks to commitments/decisions/tasks.
- [x] Update schedule/calendar views to infer and display due dates consistently.
- [x] Ensure person resolution fallback avoids “Unknown” where identity evidence exists.

Tests:
- [x] E2E checks for evidence visibility on all major object types.
- [x] Regression tests for due date extraction and rendering.

Exit criteria:
- [x] All major entities expose proof metadata by default.

## Phase 5 — Mandate Bar and Institutional Navigation (Week 3-4)
- [x] Replace command bar copy/actions with institutional action grammar.
- [x] Add intent templates for high-value workflows:
  - [x] Prepare weekly continuity briefing
  - [x] Show unresolved high-risk commitments
  - [x] Show contradictions by matter/engagement
- [x] Build deterministic action cards with audit traces.
- [x] Add “private briefing mode” output style for exports.

Tests:
- [x] Action routing tests for top 20 intents.
- [x] Permission tests for cross-role intent execution.

Exit criteria:
- [x] Mandate Bar works with role-aware outputs and evidence-backed references.

## Phase 6 — Chain-of-Custody and Integrity Ledger (Week 4-5)
- [x] Enforce content hashing on all ingest artifacts and normalized records.
- [x] Add tenant/day Merkle root generation job.
- [x] Add immutable custody metadata model.
- [x] Add signed integrity snapshot endpoint/export.
- [x] Add evidence access logs with actor + reason code.

Tests:
- [x] Hash consistency tests across replay/reingest.
- [x] Merkle proof validation tests.
- [x] Tamper detection tests.

Exit criteria:
- [ ] Any record can produce verifiable provenance trail end-to-end.

## Phase 7 — Security Posture Upgrade (Week 5-6)
- [x] Enforce SSO-first mode for enterprise tenants.
- [x] Add policy controls for password fallback per environment.
- [x] Implement RBAC + ABAC checks at API gateway and object layer.
- [x] Add field-level masking for sensitive evidence payloads.
- [x] Introduce break-glass workflow for privileged access.
- [x] Add organization-level IP allowlist support.

Tests:
- [x] Auth matrix tests by role, action, and object state.
- [x] Policy engine tests for allow/deny and override paths.
- [x] Security regression tests for admin endpoints.

Exit criteria:
- [x] Security controls demonstrably enforce least privilege and auditable overrides.

## Phase 8 — Reliability, Jobs, and Ingestion Resilience (Week 6-7)
- [x] Harden connector sync state persistence (typed JSON handling, no dict encoding errors).
- [x] Validate full extract→verify→persist→graph chain for each connector.
- [x] Add robust retry + idempotency for sync state writes.
- [x] Add source health model with clear statuses and reasons.
- [x] Add automatic source recovery playbooks in jobs workers.
- [x] Add stale-source alerts and sync SLO breach alerts.

Tests:
- [x] Integration tests per connector with backfill + incremental sync.
- [x] Failure-mode tests for transient DB/network/provider errors.
- [x] Replay tests from Kafka offsets and DLQ recovery.

Exit criteria:
- [x] Sources recover predictably with no silent data loss.

## Phase 9 — Performance and Experience SLO Enforcement (Week 7)
- [x] Add p95 latency dashboards for critical endpoints.
- [x] Add frontend route performance instrumentation.
- [x] Optimize hot API routes and remove N+1 patterns.
- [x] Add Redis context cache for frequent brief/query workloads.
- [x] Add SLA guardrails in CI/CD (performance budget checks).

Tests:
- [x] Load tests for top read APIs and ask streaming endpoint.
- [x] Frontend Lighthouse/UX budget checks for core routes.

Exit criteria:
- [x] Core SLOs measurable and enforced by pipeline gates.

## Phase 10 — Client-Facing Trust Products (Week 8)
- [x] Build **Record Certificate** generation pipeline.
- [x] Build **Continuity Score** with transparent factor breakdown.
- [x] Build monthly **Integrity Report** export.
- [x] Add legal hold and retention profile controls.
- [x] Add one-click evidence bundle export for audits/disputes.

Tests:
- [x] Export correctness tests against fixture datasets.
- [x] Permission tests for certificate/report generation.

Exit criteria:
- [x] Enterprise clients can self-serve audit-grade trust artifacts.

## Phase 11 — White-Glove Onboarding and Operations Layer (Week 8-9)
- [x] Implement “Request a private briefing” flow and remove low-signal self-serve messaging on enterprise entrypoints.
- [x] Add onboarding runbook UI for internal teams:
  - [x] Security review checklist
  - [x] Data custody mapping
  - [x] Pilot mandate setup
  - [x] Go-live readiness gate
- [x] Add weekly operations brief automation and monthly integrity report schedule.
- [x] Add support workflow linkage between app tickets and admin operations queue.

Tests:
- [x] E2E onboarding tests from signup to source readiness.
- [x] Ticket lifecycle tests from creation to resolution.

Exit criteria:
- [x] Pilot onboarding is deterministic, documented, and measured.

## Phase 12 — Vertical Overlay Foundation (Week 9-10)
- [ ] Implement vertical extension schema package:
  - [ ] Core object extensions
  - [ ] Custom labels and lifecycle states
  - [ ] Vertical-specific risk taxonomies
- [ ] Ship Legal overlay v1.
- [ ] Ship Accounting overlay v1.
- [ ] Add vertical-specific dashboard compositions and dossier templates.
- [ ] Add compatibility tests to ensure core upgrades do not break overlays.

Tests:
- [ ] Contract tests for overlay schema compatibility.
- [ ] Snapshot tests for vertical navigation/page composition.

Exit criteria:
- [ ] Two vertical shells operate without core forks.

## Phase 13 — Compliance, Documentation, and Sales Readiness (Week 10)
- [ ] Publish security whitepaper in institutional tone.
- [ ] Publish architecture and data-custody diagrams for buyers.
- [ ] Publish deployment guides for SaaS, dedicated, on-prem.
- [ ] Create pilot-ready KPI templates for legal/accounting prospects.
- [ ] Build a controlled demo environment seeded with realistic vertical data.

Exit criteria:
- [ ] Sales + security review package complete for enterprise procurement cycles.

## Phase 14 — Production Readiness Gate (Week 11)
- [ ] Run full regression suite across web/admin/backend/workers.
- [ ] Run chaos tests for connector failures and job worker restarts.
- [ ] Run restore/replay drills for event log and custody ledger.
- [ ] Verify all runbooks and on-call escalation paths.
- [ ] Perform security tabletop exercise with incident simulation.

Hard gate requirements:
- [ ] No P0/P1 open bugs.
- [ ] Core SLOs met for 7 consecutive days.
- [ ] Audit trail completeness ≥ 99.9% for sampled records.
- [ ] Pilot onboarding completion in target time window.

## Cross-Cutting Quality Rules (Apply Every Phase)
- [ ] Keep file sizes within LOC policy; split aggressively.
- [ ] Add tests with each feature change; no deferred testing.
- [ ] Maintain or improve global test coverage each sprint.
- [ ] No silent fallbacks for integrity-critical paths.
- [ ] Document every new operational toggle and failure mode.

## Definition of Done (Program)
- [ ] Drovi is visually and behaviorally consistent with “Swiss private bank of truth” doctrine.
- [ ] Trust artifacts (proof, chain-of-custody, supersession) are first-class across UI and APIs.
- [ ] Security posture supports enterprise due diligence without ad-hoc work.
- [ ] Core architecture supports vertical overlays with minimal branching.
- [ ] System is production-ready with measurable SLOs and tested recovery paths.
