

# DROVI Pitch Deck — Old Money Forest Green & Gold

## Updated Design System
- **Palette**: Deep forest green (#1a2e1a → #1b3a2a), champagne gold (#c9a96e), ivory (#f5f0e8), charcoal (#2d2d2d), warm cream (#faf7f2) — inspired by the reference images showing rich dark green backgrounds with ornate gold typography
- **Gradient backgrounds**: Subtle radial gradients from dark forest green center to near-black edges, matching the vignette effect in the inspirations
- **Typography**: Playfair Display for headings (with italic for emphasis phrases like the "unité d'élite" style), Inter for body, generous uppercase letter-spacing for labels/tags
- **Visual Language**: Thin gold dividers, gold-bordered tags/badges (like the "CO-PILOTE TECH" boxes in the banner), large whitespace, restrained elegance, subtle green-to-black gradients
- **Accent details**: Gold (#c9a96e) for all accent elements — dots, progress bar, dividers, borders, numbers

## Slide Structure (15 slides)
1. **Title** — DROVI wordmark centered, tagline "The Institutional Ledger for Modern Firms", gold accent line, dark green background with radial vignette
2. **The Problem** — Fragmented promises, staggered fade-in list of where promises live (email, Slack, PDFs…)
3. **What Breaks** — Consequences of no ledger, impactful serif typography with gold highlights for key risks
4. **What Is a Ledger?** — Historical definition, 5 properties animated in numbered sequence with gold numbers
5. **Drovi = The Institutional Ledger** — Core value prop, structured entry types as gold-bordered cards
6. **Technical Architecture** — 4-layer overview (Event Model, Bi-Temporal Engine, Evidence Extraction, Contradiction Logic) as elegant cards with gold borders
7. **AI at the Core** — Pipeline stages, deployment options in badge/tag style (like the reference banner boxes)
8. **Why This Matters for AI Agents** — Before/after contrast, agent control plane concept
9. **Initial Markets** — Target verticals as refined gold-bordered cards
10. **Why We Win** — 5 advantages with gold-accented numbering
11. **Business Model** — Pricing and packaging, clean layout with gold dividers
12. **Traction** — Milestones as animated checklist with gold checkmarks
13. **The Future** — Vision statement, large cinematic italic serif typography
14. **Team** — Jeremy & Tristan profiles, minimal and dignified with gold separator
15. **The Raise & Close** — $1.5M ask, use of capital breakdown, closing ledger statement

## Interactive Features
- **Navigation dots**: Fixed right-side vertical dots in gold, current slide filled, others outlined
- **Keyboard navigation**: Arrow keys, spacebar, Escape
- **Progress bar**: Thin gold line at viewport top
- **Framer Motion**: Staggered fade-ins, slide transitions with scale + opacity, text reveals
- **Scroll-snap**: Full-viewport slides

## Technical Approach
- Install `framer-motion`
- Google Fonts: Playfair Display + Inter
- Each slide as a full-viewport component with shared `SlideLayout` (forest green gradient background, consistent padding/typography)
- Navigation state manager handling dots, keyboard, progress bar
- All content hardcoded, no backend

