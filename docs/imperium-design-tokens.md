# Imperium Design Tokens

This document defines the shared visual language for Imperium web, iOS, and macOS.

## Color System

- `--imperium-black-matte`: primary shell background
- `--imperium-charcoal`: raised card/background surface
- `--imperium-forest`: positive/system-safe accent
- `--imperium-burgundy`: risk/destructive accent
- `--imperium-antique-gold`: primary highlight and status emphasis
- `--imperium-parchment`: long-form reading surface
- `--imperium-text-primary`: default foreground
- `--imperium-text-muted`: secondary metadata
- `--imperium-border-strong`: baseline separators
- `--imperium-border-accent`: emphasized separators and active states

## Typography

- Display: `--imperium-font-display` (serif authority style)
- Body: `--imperium-font-body` (same family for consistent editorial tone)
- Data: `--imperium-font-data` (monospace with tabular numerics)
- Scale:
  - `--imperium-type-display-xl`
  - `--imperium-type-display-lg`
  - `--imperium-type-headline`
  - `--imperium-type-body`
  - `--imperium-type-caption`
  - `--imperium-type-data`
- Numeric formatting:
  - `--imperium-number-features` = `"tnum" 1, "lnum" 1`

## Spacing and Radius

- Spacing scale:
  - `--imperium-space-1` through `--imperium-space-6`
- Radius:
  - `--imperium-radius-card`

## Motion

- `--imperium-motion-fast`: short emphasis transitions
- `--imperium-motion-medium`: panel and module transitions
- Rule: no spring/bounce motion; use hard fades and direct movement only.

## Cross-Platform Mapping

- Web:
  - Source of truth: `packages/imperium-design-tokens/src/imperium.css`
  - Loaded by `apps/imperium/src/main.tsx`
- iOS:
  - Mirror values in `ImperiumPalette` for SwiftUI rendering.
  - Data-heavy values should use monospaced numerics in market tables.
- macOS:
  - Mirror values in `ImperiumMacPalette`.
  - Dense operator tables should keep tabular numeric alignment.

## Component Primitives

- Command cards: high-contrast border + matte surface + serif heading.
- Metric rails: compact grid of data cards with numeric emphasis.
- Alert strips: category + impact + action context in one row.
- Chart preset:
  - dark matte background
  - antique-gold line/candle accents
  - muted axis labels
  - no gradient fills
