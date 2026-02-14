# AgentOS Capability Matrix

## Purpose

Define the minimum capability set for each business-function starter pack.

## Capability keys

- `observe`: monitor events and generate findings.
- `recommend`: draft suggested actions and work products.
- `execute_low`: execute low-risk writes without approval.
- `execute_high`: execute high-risk side effects with approval.
- `chat`: direct Q&A and task assignment via chat/email.
- `work_products`: produce concrete outputs (emails/docs/sheets/slides/tickets).
- `cross_tool`: coordinate across >= 2 systems in one run.

## Matrix

| Domain | Core roles | observe | recommend | execute_low | execute_high | chat | work_products | cross_tool |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sales | SDR, RevOps, Renewal Risk | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| HR | Recruiting Coordinator, Onboarding Manager, Policy Assistant | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Finance | AP/AR Assistant, Close Coordinator | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Support/CS | Triage Operator, Escalation Manager | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Ops/IT | Incident Analyst, Runbook Operator | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Legal | Advice Sentinel, Matter Risk Agent | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Accounting | Filing Agent, Missing Docs Agent | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Gov | Policy Trace Agent, Approval Chain Agent | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Construction | Change Order Agent, RFI Agent | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

## Channel-native requirements

Every role pack must support:
- Email-triggered task assignment.
- Slack mention/DM assignment.
- Teams mention/DM assignment.
- In-thread status updates with run IDs.

## Quality bar per role

- Must include at least one role-specific eval suite.
- Must include at least one high-risk action approval workflow.
- Must include proof-first response templates.
