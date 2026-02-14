# AgentOS Approval Policy Matrix

## Purpose

Define approval authority, SLA, and escalation policy for high-risk agent actions.

## Approval roles

- `OrgOwner`: global policy owner.
- `DomainManager`: functional owner (Sales Ops, HR Lead, Finance Lead, etc.).
- `RiskApprover`: designated reviewer for legal/compliance-sensitive actions.
- `EmergencyApprover`: fallback authority for SLA breaches.

## Matrix

| Action type | Minimum approver | SLA | Escalation |
| --- | --- | --- | --- |
| Internal low-risk write (S1) | None by default | Immediate | N/A |
| Medium-risk operational write (S2) | DomainManager (optional by policy) | 2h | Escalate to OrgOwner |
| External customer/prospect send (S3) | DomainManager | 1h | Escalate to OrgOwner |
| Legal advice outbound (S3) | RiskApprover | 30m | Escalate to OrgOwner + Legal Lead |
| Regulated filing/payment/commit (S4) | RiskApprover + OrgOwner | 15m | Escalate to EmergencyApprover |

## Approval channel behavior

Approvals must be actionable from:
- Web app inbox.
- Slack/Teams interactive action.
- Email approval link (signed, short-lived).

## Fallback and timeout policy

- SLA timeout -> auto-escalation according to matrix.
- Escalation timeout for `S3`/`S4` -> automatic deny.
- Approver rejection -> run transitions to `blocked` with rationale.

## Audit requirements

Approval events must record:
- approver identity,
- action request payload hash,
- decision timestamp,
- decision rationale,
- linked run/step IDs.

## Default policy posture

- Conservative defaults: deny unless explicitly allowed.
- All orgs can override with stricter settings; weaker settings are blocked for `S4`.
