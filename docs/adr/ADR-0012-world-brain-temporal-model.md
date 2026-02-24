# ADR-0012: World Brain Temporal Model

## Status
Accepted

## Context
World Brain must answer both:
- what was true in the world at time T
- what Drovi believed at time T

A single timestamp model cannot represent delayed evidence arrival, supersession, or audit-grade replay.

## Decision
Adopt a three-axis temporal model for all cognitive objects:
- `valid_from` / `valid_to`: real-world validity window
- `believed_from` / `believed_to`: system belief window
- `observed_at`: source observation timestamp

Temporal operations are required for all critical APIs:
- state-at-time
- diff-between-times
- belief revision trail

## Consequences
Positive:
- precise postmortem and audit reconstruction
- deterministic replay under late-arriving evidence
- explicit supersession and contradiction tracking

Tradeoffs:
- more complex query/index design
- higher implementation burden for connectors and pipelines
