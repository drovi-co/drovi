# ADR-0002: AgentOS Desktop Companion (Electron + Secure Local Bridge)

## Status
Accepted

## Context

AgentOS targets “real AI employee” workflows that require local-computer operations:
- creating/updating local files,
- interacting with installed productivity tools,
- attended execution where a user can observe/approve local actions.

Pure browser/SaaS APIs do not cover every enterprise workflow. Some customers require local desktop actions, but this introduces substantial security risk if unmanaged.

## Decision

Introduce a dedicated desktop companion app:
- `apps/drovi-desktop` using Electron.
- Local secure bridge daemon exposed only on loopback.
- mTLS and short-lived capability tokens bound to org/user/agent identity.
- Explicit capability prompts for local file/app/screen actions.
- Audited local action events streamed back to AgentOS.

Implementation policy:
- Prefer native SaaS APIs first.
- Use local UI automation only when API path is unavailable.
- Keep desktop actions opt-in per organization and per user.

## Consequences

Positive:
- Enables high-value “AI employee does concrete work on my machine” flows.
- Preserves trust via explicit prompts, scoped tokens, and complete audit.
- Provides a cross-platform execution path for macOS and Windows.

Tradeoffs:
- Additional app lifecycle and signing/distribution complexity.
- Need strong sandboxing and anti-abuse controls for local bridge.
- Higher QA surface for platform-specific adapters.

## Security controls

- Capability token TTL is short and non-reusable.
- No wildcard filesystem access; approved root policies only.
- Per-action policy enforcement before local execution.
- Remote kill-switch capability for incident response.
