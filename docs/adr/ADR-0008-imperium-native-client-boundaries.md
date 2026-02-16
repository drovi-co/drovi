# ADR-0008: Imperium Native Client Boundaries (SwiftUI + UIKit/AppKit)

## Status
Accepted

## Context

Imperium must run on iPhone and Mac with high visual fidelity and dense data presentation. SwiftUI provides velocity and shared structure, but high-frequency charting and advanced grid behavior need lower-level UI control.

## Decision

Imperium native clients follow a hybrid model:

- SwiftUI for app shell, navigation, module composition, and state wiring
- UIKit/AppKit integration for:
  - candlestick chart hosting
  - high-density table/grid views
  - advanced keyboard-first interactions on macOS

Shared code strategy:

- common Swift package for domain models, API client, and state interfaces
- platform-specific wrappers for advanced render surfaces

## Consequences

Positive:

- high rendering performance where needed
- faster feature delivery for standard screens
- clear and testable UI boundaries

Tradeoffs:

- more integration complexity at framework boundaries
- additional QA surface for wrapper behavior
