# Swiss Private Bank Transformation Board

Date opened: `2026-02-16`
Branch: `codex/swiss-private-bank-transformation`
Source plan: `/Users/jeremyscatigna/project-memory/DROVI_SWISS_PRIVATE_BANK_TASKS.md`

## Program rules
- Non-critical feature work is frozen during the doctrine migration window.
- Any exception requires an owner, rollback plan, and explicit impact note.
- Trust-critical paths (auth, evidence, ingestion, supersession, exports) have priority.

## Milestones
| Milestone | Scope | Target | Status |
|---|---|---:|---|
| M0 | Phase 0 program setup + baseline | Week 0 | In progress |
| M1 | Phase 1 language + IA migration | Week 1 | Not started |
| M2 | Phase 2 design system institutionalization | Week 2 | Not started |
| M3 | Phase 3-5 module + UX reframe | Week 4 | Not started |
| M4 | Phase 6-8 trust + reliability hardening | Week 7 | Not started |
| M5 | Phase 9-11 SLO + trust products + onboarding ops | Week 9 | Not started |
| M6 | Phase 12-14 overlays + compliance + production gate | Week 11 | Not started |

## Phase 0 checklist snapshot
- [x] Dedicated transformation branch created.
- [x] Feature-freeze rules documented.
- [x] Baseline metric capture documented.
- [x] Doctrine RFC published.
- [x] Terminology migration matrix published.
- [ ] Stakeholder sign-off completed.

## Risks
1. Legacy copy drift can reintroduce non-institutional language.
2. Mixed design tokens can cause visual inconsistency during migration.
3. Incomplete baseline instrumentation can hide regression risk.

## Mitigations
1. Add institutional copy lint checks and tests in Phase 1.
2. Make institutional theme tokens canonical in Phase 2.
3. Keep baseline report versioned and refresh weekly during migration.
