# RFC-0001: Swiss Private Bank of Truth Doctrine

Status: `Proposed`
Date: `2026-02-16`
Owner: `Platform + Product + Design`
Scope: `Drovi web, admin, intelligence API, operations`

## Context
Drovi is moving from a broad AI workspace posture to an institutional trust posture. The target perception is: **calm, precise, auditable, discreet**.

This RFC defines doctrine-level constraints for product behavior, frontend expression, backend trust controls, and operating discipline.

## Decision
Drovi adopts the doctrine **Discipline + Precision + Discretion + Permanence**.

### Non-negotiables
1. Evidence over prose.
2. Trace over summary.
3. Restraint over novelty.
4. Determinism over “best effort” for critical paths.
5. Institutional language over startup language.
6. Security controls visible as confidence, not fear.

### Product contract
Every high-stakes record (commitment, decision, task, risk, contradiction) must expose:
- Evidence links or explicit “no admissible evidence” state
- Time context (extracted at, valid from/to, superseded at)
- Confidence with rationale
- Access and mutation traceability

### Experience contract
- No playful UI behavior on primary workflows.
- No noisy visual treatments (neon/gradient-heavy/over-animated patterns).
- Navigation and naming reflect institutional terms.

### Security contract
- SSO-first for enterprise tenants.
- Least-privilege enforcement with auditable overrides.
- Chain-of-custody continuity for records and evidence.

## Consequences
### Positive
- Stronger enterprise trust posture.
- Better procurement/compliance fit.
- Higher product coherence across vertical shells.

### Costs
- Existing copy and components require migration.
- Tightening language and behavior introduces refactor work.
- Additional QA burden for trust-critical flows.

## Rollout
- Phase 0: doctrine publication, baseline metrics, terminology matrix.
- Phase 1+: vocabulary and navigation migration, lint rules, i18n hardening.
- Later phases: trust ledger, chain-of-custody, SSO-first posture, trust artifacts.

## Sign-off checklist
- [ ] Product lead
- [ ] Design lead
- [ ] Platform lead
- [ ] Security lead
- [ ] GTM lead

## References
- `/Users/jeremyscatigna/project-memory/DROVI_SWISS_PRIVATE_BANK_PLAN.md`
- `/Users/jeremyscatigna/project-memory/DROVI_SWISS_PRIVATE_BANK_TASKS.md`
