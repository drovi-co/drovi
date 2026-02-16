# Drovi — Swiss Private Bank of Truth (Execution Tasks)

This task plan implements `/Users/jeremyscatigna/project-memory/DROVI_SWISS_PRIVATE_BANK_PLAN.md` in production order.

## Phase 0 — Program Setup and Baseline (Week 0)
- [ ] Create a dedicated transformation branch and milestone board.
- [ ] Freeze non-critical feature work during this migration window.
- [ ] Define baseline metrics snapshot:
  - [ ] Page load p95
  - [ ] Ask latency p95
  - [ ] Ingestion lag p95
  - [ ] Contradiction rate
  - [ ] % records with evidence links
- [ ] Publish old-money doctrine as an internal RFC and get sign-off.
- [ ] Create a “Terminology Migration Matrix” mapping old labels to institutional vocabulary.

Exit criteria:
- [ ] Baseline dashboard captured and versioned.
- [ ] Doctrine accepted by product, engineering, design, and GTM owners.

## Phase 1 — Language and Information Architecture Migration (Week 1)
- [ ] Replace user-facing copy across web/admin/API docs with institutional lexicon.
- [ ] Rename sidebar/navigation labels to new nouns.
- [ ] Replace all playful or hype empty-state/error strings with formal operational wording.
- [ ] Introduce content lint checks for banned terms in frontend strings.
- [ ] Add localization keys for EN/FR institutional voice.
- [ ] Verify all translation keys resolve (no raw i18n keys rendered).

Tests:
- [ ] i18n snapshot tests for key pages.
- [ ] UI smoke tests validating no banned terms in critical flows.

Exit criteria:
- [ ] 100% of top-level navigation and detail surfaces use new vocabulary.
- [ ] No unresolved translation keys in production routes.

## Phase 2 — Old-Money Design System Foundation (Week 1-2)
- [ ] Create a formal theme package in shared frontend packages:
  - [ ] Color tokens (forest/navy/parchment/stone/gold)
  - [ ] Type scale + font pairing tokens
  - [ ] Spacing, borders, elevation, motion tokens
- [ ] Add “institutional” component variants for:
  - [ ] Table
  - [ ] Timeline rail
  - [ ] Badge/seal
  - [ ] Dossier panel
  - [ ] Evidence popover
- [ ] Remove loud gradients/shadows from legacy components.
- [ ] Establish strict motion presets (short fade/slide only).
- [ ] Add visual regression snapshots for primary pages.

Tests:
- [ ] Storybook visual tests for theme variants.
- [ ] Accessibility checks (contrast, focus states, keyboard flow).

Exit criteria:
- [ ] Shared DS package consumed by web and admin apps.
- [ ] Institutional theme applied without layout regressions.

## Phase 3 — Frontend Module Hardening and Extraction (Week 2-3)
- [ ] Extract independent feature modules (auth, onboarding, sources, drive, teams, trust, agents) with clear APIs.
- [ ] Move module state/actions to package-scoped hooks.
- [ ] Ensure modules can be enabled/disabled per vertical config.
- [ ] Add module-level theming and vocabulary override support.
- [ ] Build a “vertical manifest” contract:
  - [ ] Feature toggles
  - [ ] Object naming map
  - [ ] Navigation composition

Tests:
- [ ] Unit tests for each module contract.
- [ ] Integration tests for cross-module auth/org context.

Exit criteria:
- [ ] Core web shell composes only via module manifests.
- [ ] No direct hard-coded vertical terms in core modules.

## Phase 4 — Proof-First UX Pass on Core Surfaces (Week 3)
- [ ] Rework record lists to always show:
  - [ ] Evidence count
  - [ ] Last verified timestamp
  - [ ] Confidence seal
  - [ ] Supersession state
- [ ] Add fixed “Evidence rail” on detail pages.
- [ ] Add supersession timeline blocks to commitments/decisions/tasks.
- [ ] Update schedule/calendar views to infer and display due dates consistently.
- [ ] Ensure person resolution fallback avoids “Unknown” where identity evidence exists.

Tests:
- [ ] E2E checks for evidence visibility on all major object types.
- [ ] Regression tests for due date extraction and rendering.

Exit criteria:
- [ ] All major entities expose proof metadata by default.

## Phase 5 — Mandate Bar and Institutional Navigation (Week 3-4)
- [ ] Replace command bar copy/actions with institutional action grammar.
- [ ] Add intent templates for high-value workflows:
  - [ ] Prepare weekly continuity briefing
  - [ ] Show unresolved high-risk commitments
  - [ ] Show contradictions by matter/engagement
- [ ] Build deterministic action cards with audit traces.
- [ ] Add “private briefing mode” output style for exports.

Tests:
- [ ] Action routing tests for top 20 intents.
- [ ] Permission tests for cross-role intent execution.

Exit criteria:
- [ ] Mandate Bar works with role-aware outputs and evidence-backed references.

## Phase 6 — Chain-of-Custody and Integrity Ledger (Week 4-5)
- [ ] Enforce content hashing on all ingest artifacts and normalized records.
- [ ] Add tenant/day Merkle root generation job.
- [ ] Add immutable custody metadata model.
- [ ] Add signed integrity snapshot endpoint/export.
- [ ] Add evidence access logs with actor + reason code.

Tests:
- [ ] Hash consistency tests across replay/reingest.
- [ ] Merkle proof validation tests.
- [ ] Tamper detection tests.

Exit criteria:
- [ ] Any record can produce verifiable provenance trail end-to-end.

## Phase 7 — Security Posture Upgrade (Week 5-6)
- [ ] Enforce SSO-first mode for enterprise tenants.
- [ ] Add policy controls for password fallback per environment.
- [ ] Implement RBAC + ABAC checks at API gateway and object layer.
- [ ] Add field-level masking for sensitive evidence payloads.
- [ ] Introduce break-glass workflow for privileged access.
- [ ] Add organization-level IP allowlist support.

Tests:
- [ ] Auth matrix tests by role, action, and object state.
- [ ] Policy engine tests for allow/deny and override paths.
- [ ] Security regression tests for admin endpoints.

Exit criteria:
- [ ] Security controls demonstrably enforce least privilege and auditable overrides.

## Phase 8 — Reliability, Jobs, and Ingestion Resilience (Week 6-7)
- [ ] Harden connector sync state persistence (typed JSON handling, no dict encoding errors).
- [ ] Validate full extract→verify→persist→graph chain for each connector.
- [ ] Add robust retry + idempotency for sync state writes.
- [ ] Add source health model with clear statuses and reasons.
- [ ] Add automatic source recovery playbooks in jobs workers.
- [ ] Add stale-source alerts and sync SLO breach alerts.

Tests:
- [ ] Integration tests per connector with backfill + incremental sync.
- [ ] Failure-mode tests for transient DB/network/provider errors.
- [ ] Replay tests from Kafka offsets and DLQ recovery.

Exit criteria:
- [ ] Sources recover predictably with no silent data loss.

## Phase 9 — Performance and Experience SLO Enforcement (Week 7)
- [ ] Add p95 latency dashboards for critical endpoints.
- [ ] Add frontend route performance instrumentation.
- [ ] Optimize hot API routes and remove N+1 patterns.
- [ ] Add Redis context cache for frequent brief/query workloads.
- [ ] Add SLA guardrails in CI/CD (performance budget checks).

Tests:
- [ ] Load tests for top read APIs and ask streaming endpoint.
- [ ] Frontend Lighthouse/UX budget checks for core routes.

Exit criteria:
- [ ] Core SLOs measurable and enforced by pipeline gates.

## Phase 10 — Client-Facing Trust Products (Week 8)
- [ ] Build **Record Certificate** generation pipeline.
- [ ] Build **Continuity Score** with transparent factor breakdown.
- [ ] Build monthly **Integrity Report** export.
- [ ] Add legal hold and retention profile controls.
- [ ] Add one-click evidence bundle export for audits/disputes.

Tests:
- [ ] Export correctness tests against fixture datasets.
- [ ] Permission tests for certificate/report generation.

Exit criteria:
- [ ] Enterprise clients can self-serve audit-grade trust artifacts.

## Phase 11 — White-Glove Onboarding and Operations Layer (Week 8-9)
- [ ] Implement “Request a private briefing” flow and remove low-signal self-serve messaging on enterprise entrypoints.
- [ ] Add onboarding runbook UI for internal teams:
  - [ ] Security review checklist
  - [ ] Data custody mapping
  - [ ] Pilot mandate setup
  - [ ] Go-live readiness gate
- [ ] Add weekly operations brief automation and monthly integrity report schedule.
- [ ] Add support workflow linkage between app tickets and admin operations queue.

Tests:
- [ ] E2E onboarding tests from signup to source readiness.
- [ ] Ticket lifecycle tests from creation to resolution.

Exit criteria:
- [ ] Pilot onboarding is deterministic, documented, and measured.

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
