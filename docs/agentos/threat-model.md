# AgentOS Threat Model (v1)

## Scope
AgentOS control plane, runtime workflows, tool execution, approval chain, and cross-channel identity (email/Slack/Teams).

## Assets
- Tenant-scoped memory graph and UIO truth.
- Agent deployment snapshots and policy overlays.
- Approval decisions and audit ledger.
- Work products and evidence artifacts.
- Channel identities and message routing.

## Threat Categories

## 1. Tenant Boundary Violations
- Risk: cross-org data leak via routing, cache, or query.
- Controls:
  - org-scoped auth checks on all routes.
  - RLS and org-id filters on all SQL access.
  - integration tests for cross-org denial paths.

## 2. Unauthorized Side Effects
- Risk: agent executes write action outside policy.
- Controls:
  - tool manifest with side-effect tiers.
  - deny-first policy precedence and emergency denylist.
  - approval workflow for high-risk actions.
  - action receipts + immutable audit events.

## 3. Prompt/Tool Injection
- Risk: adversarial content coerces unsafe tool use.
- Controls:
  - policy engine checks before tool invocation.
  - explicit allowlists for browser domains and desktop capabilities.
  - no-evidence-no-action rule for high-stakes outputs.

## 4. Identity Spoofing (Email/Slack/Teams)
- Risk: forged sender triggers unauthorized runs.
- Controls:
  - signed webhook validation.
  - channel binding verification per org.
  - sender and domain policy checks for outbound.

## 5. Quality Drift / Silent Degradation
- Risk: model quality drops without obvious failures.
- Controls:
  - run quality scoring + calibration.
  - regression gates on deployment promotion.
  - drift score monitoring + alerting.

## 6. Secrets / Credential Exposure
- Risk: connector/browser/desktop credentials leaked.
- Controls:
  - secret manager storage only.
  - short-lived tokens for local bridge.
  - audited access and rotation policy.

## Residual Risks
- Human approval fatigue can delay critical decisions.
- Third-party API behavior changes may increase false denials/failures.
- Browser automation drift from UI changes still requires maintenance.

## Sign-Off Checklist
- [x] Cross-tenant denial tests green.
- [x] Policy bypass tests green.
- [x] Approval chain tests green.
- [x] Emergency denylist propagation tested.
- [x] Drift alerts configured.
