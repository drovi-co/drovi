# ADR-0009: Imperium Design Language and Token Strategy

## Status
Accepted

## Context

Imperium requires a distinct visual identity with strong information hierarchy and zero playful styling. Inconsistent styling across iOS, macOS, and web would degrade product authority and operational clarity.

## Decision

Imperium design language is defined by shared tokens and hard constraints:

- palette: matte black, charcoal, forest accents, burgundy risk, antique gold highlights, parchment reading mode
- typography: high-contrast serif display, disciplined body face, tabular mono numerics
- motion: short hard fades, no bounce/spring playfulness
- layout: strict grids and heavy separators for dense information surfaces

A new package stores cross-surface token definitions:

- `packages/imperium-design-tokens`

No module may ship with ad hoc color or typography values that bypass token contracts.

## Consequences

Positive:

- consistent "old money terminal" look across platforms
- easier future theming and design QA
- reduced styling drift over time

Tradeoffs:

- up-front token system work before full UI buildout
- occasional platform-specific token mapping effort
