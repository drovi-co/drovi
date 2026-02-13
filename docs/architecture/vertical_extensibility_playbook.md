# Vertical Extensibility Playbook

This document defines the production contract for adding new verticals without touching core business logic.

## 1) Storage rules (canonical + extensible)

- Canonical truth spine: `unified_intelligence_object`
- Long-tail extension payloads: `uio_extension_payload`
- High-value typed projections:
  - `legal_matter`
  - `legal_advice`
  - `accounting_filing_deadline`

Rules:

1. Every vertical object is still represented as a UIO in the canonical table.
2. Every plugin payload is persisted in `uio_extension_payload` after schema validation.
3. If a plugin declares a typed table for a type, it must upsert projection rows in the same transaction.
4. Reads that need strict analytics or operational latency should query typed tables first.
5. Generic product surfaces should query canonical UIOs + extension payloads.

## 2) Plugin contract

Each plugin must implement:

- `uio_types()`
- `extension_types()`
- `validate_extension_payload()`
- `upsert_typed_extension()`
- `migration_revisions()`
- `storage_rules()`

This keeps extension logic explicit and testable.

## 3) Build a new vertical in one day

1. Backend plugin
  - Create `src/plugins/<vertical>.py`.
  - Register namespaced types (`<vertical>.*`).
  - Add payload validators and typed projection upserts.
  - Add migration revision(s) and declare them in `migration_revisions()`.

2. Backend manifest + contract tests
  - Ensure plugin appears in `/api/v1/org/manifest`.
  - Add tests for:
    - payload validation success/failure
    - migration revision presence
    - extension upsert behavior

3. Theme + vocabulary
  - Add theme pack in `packages/ui-theme/src/packs.ts`.
  - Add vocabulary + typed overrides in `packages/vertical-runtime/src/presets.ts`.

4. Vertical app shell
  - Scaffold `apps/<vertical>` with:
    - `VerticalRuntimeProvider`
    - preset module set
    - theme pack application
  - Keep app thin; import shared `packages/*` modules.

5. CI checks
  - Run:
    - `bun run check-types`
    - `bun run lint`
    - backend plugin/extension tests
  - Ensure no direct imports from app code into package code.

## 4) Reference implementations

- Plugins: `legal`, `accounting`
- Vertical shells: `apps/legal`, `apps/accounting`, `apps/gov`, `apps/construction`
- Runtime presets: `packages/vertical-runtime/src/presets.ts`
- Theme packs: `packages/ui-theme/src/packs.ts`

