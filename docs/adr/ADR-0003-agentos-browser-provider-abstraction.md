# ADR-0003: Browser Provider Abstraction (Local + Managed)

## Status
Accepted

## Context

AgentOS requires browser-native task execution:
- authenticated browsing flows,
- form completion,
- download/upload handling,
- artifact capture for replay and audit.

Single-provider coupling is risky for cost, reliability, and portability. We also need support for both local deterministic browsing and managed browser infrastructure.

## Decision

Define a first-class `BrowserProvider` abstraction with a stable contract:
- session lifecycle (`create`, `resume`, `close`),
- navigation and state operations,
- action primitives (`click`, `type`, `select`, `upload`, `download`),
- observability artifacts (trace, screenshot, network logs),
- standardized errors.

Initial providers:
- Local provider: Playwright/CDP.
- Managed provider adapter under the same contract (including Parallel-compatible adapter path).

Provider selection is policy-driven:
- per organization,
- per agent role,
- with runtime fallback rules.

## Consequences

Positive:
- Provider swap without playbook rewrites.
- Better resilience and cost control.
- Uniform audit/replay format independent of provider.

Tradeoffs:
- Need contract tests across providers.
- More integration complexity up front.
- Need careful normalization of provider-specific behaviors.

## Non-goals

- No direct provider-specific branching inside agent playbooks.
- No bypass of policy/approval checks based on provider type.
