# ADR-0011: World Brain Cognitive Object Taxonomy

## Status
Accepted

## Context
World Brain requires stronger primitives than legacy UIO-only extraction objects. A single flat object model does not support belief revision, competing hypotheses, or intervention outcome learning.

## Decision
Adopt the canonical object taxonomy:
- Observation
- Belief
- Hypothesis
- Constraint
- InterventionPlan
- OutcomeRecord

Legacy UIO objects (decision, commitment, task, risk, claim, brief) remain first-class domain views but are mapped onto this taxonomy for reasoning and lifecycle control.

## Consequences
Positive:
- unified reasoning primitives across domains
- explicit lifecycle boundaries between observation, belief, and action
- easier model specialization and evaluation per object type

Tradeoffs:
- migration complexity from legacy object assumptions
- additional mapping layer between UIO and cognitive objects
