# Drovi AgentOS Plan — Frontier-Grade AI Employees

**Date**: 2026-02-13  
**Objective**: Replace `Continuums` with a broad, enterprise-safe **AI Employee Operating System** where agents can reason, chat, act, and deliver concrete work products using Drovi’s live intelligence + bi-temporal memory.

---

## 1) Strategic Direction

Drovi should move from:
- workflow automation (`continuums`, scheduled tasks)

to:
- **AI employees** with persistent role identity, permissions, memory, tools, quality learning, and auditable work.

This is the high-moat category: context-rich autonomous execution with trust guarantees.

---

## 2) What Agents Must Be Able To Do

## 2.1 Broad agent families (not just legal/accounting)

AgentOS should support role libraries across functions:
- **Sales**: SDR, AE assistant, RevOps analyst, renewal/churn sentinel.
- **HR**: recruiter coordinator, onboarding manager, policy assistant, performance-cycle coordinator.
- **Finance**: AP/AR assistant, close coordinator, procurement monitor.
- **Support/Success**: ticket triage operator, escalation manager, health/risk monitor.
- **Ops/IT**: incident analyst, runbook executor, compliance evidence collector.
- **Legal/Accounting/Gov/Construction**: vertical specialist packs.

## 2.2 Interaction modes

Every agent role can operate in multiple modes:
- **Chat mode**: users directly chat with the agent in app/API/command bar.
- **Autonomous watch mode**: agent monitors events and acts on triggers.
- **Task mode**: agent receives a mission and executes until completion.
- **Supervisor mode**: agent proposes actions; human approves high-risk steps.
- **Background coworker mode**: agent continuously handles recurring work.

## 2.3 Work output expectations (real work)

Agents must generate and ship concrete outputs, not just text:
- outbound emails, follow-up sequences, CRM updates,
- spreadsheets (xlsx/csv), dashboards, slide decks,
- draft policies/contracts/briefs with evidence links,
- tickets/tasks and status updates,
- channel-native collaboration in email/Slack/Teams,
- evidence-backed decision and commitment trails.

---

## 3) Can We Chat With Them? Can They Use Browser/Desktop/Tools?

Short answer: **yes**, and this is core to AgentOS.

## 3.1 Conversational control plane

Users can chat with any AI employee:
- “Ask SDR Agent what changed in pipeline today.”
- “Tell HR Onboarding Agent to complete checklist for new hires.”
- “Have Exec Brief Agent generate board update deck for Friday.”

Responses must be:
- proof-first (evidence references),
- action-aware (what was executed vs proposed),
- auditable (run id, policy decisions, approvals).

## 3.2 Tool and action access model

Agents get a scoped toolset by role/profile:
- SaaS tools: Gmail/Outlook, Slack/Teams, HubSpot/Salesforce, Notion, Drive, Jira, etc.
- Data tools: SQL/query, BI APIs, internal APIs.
- Browser tools: navigate, read, click, form fill, download/upload.
- File tools: read/write/edit/generate documents.
- Execution tools: controlled command/runtime actions.

## 3.3 Browser automation strategy

Implement a browser runtime abstraction with providers:
- `BrowserProvider` interface (start session, navigate, snapshot, act, download, upload, trace).
- Local provider (Playwright/CDP) for deterministic internal flows.
- Managed provider adapter (e.g., Parallel Browser Use MCP) for scalable authenticated browsing workloads.

Parallel-specific note:
- [Parallel Browser Use Integration](https://docs.parallel.ai/integrations/browseruse)
  can be integrated as one provider behind the same interface.

## 3.4 Desktop/computer access strategy (real AI employees)

To support “open Excel, build sheet, open PowerPoint, send email” class tasks:
- Build **Drovi Desktop Companion** (Electron app) with local secure agent bridge.
- Companion exposes approved local capabilities:
  - file access,
  - local app automation hooks,
  - desktop notifications/approval prompts,
  - optional OS automation adapters.

OS automation approach:
- macOS: AppleScript + Accessibility APIs (signed and permission-gated).
- Windows: PowerShell + UI Automation/COM.
- Linux: limited support (xdotool/AT-SPI) where needed.

Rule: direct UI automation is fallback. Prefer native APIs (Graph, Google APIs, Office APIs) when possible for reliability.

## 3.5 Agent identity and communication presence (email + Slack + Teams)

AgentOS should support communication-native AI employees:
- each agent can have a unique inbox identity (for example `sdr-emea@agents.drovi.co`),
- each agent can be invited to Slack and Teams as a coworker,
- users can assign tasks by email or by @mention/DM,
- agents can respond in-thread and execute actions from those conversations.

Identity model:
- **Virtual identity mode (recommended default)**: one Slack app / Teams app / mail integration, many logical agent personas.
- **Dedicated account mode (enterprise option)**: real mailbox + real chat account per agent for strict compliance needs.

Behavior model:
- inbound message -> trigger -> run -> optional action -> reply with proof,
- persistent thread/session mapping so the agent remembers prior context,
- action confirmations and approvals happen in-channel when needed.

---

## 4) AgentOS Capability Model (Frontier-level)

## 4.1 New first-class entities

Replace Continuum entities with:
- `AgentRole`: what job this AI employee performs.
- `AgentProfile`: identity, permission scopes, model policy, tool policy.
- `AgentPlaybook`: SOPs, goals, constraints, escalation rules.
- `AgentMemoryScope`: what memory slices can be read/written.
- `AgentDeployment`: versioned release of role+profile+playbook.
- `AgentRun`: full lifecycle execution record.
- `AgentWorkProduct`: produced artifacts (email/deck/sheet/report/action).
- `AgentTeam` (Workforce): orchestrated multi-agent team.

## 4.2 Autonomy levels

Each deployment has explicit autonomy tier:
- `L0 Observe`: read/analyze only.
- `L1 Recommend`: drafts + proposed actions only.
- `L2 Execute Low Risk`: auto-run low-risk actions.
- `L3 Execute With Guardrails`: high-risk actions need approval.
- `L4 Trusted Operator`: broader automation in bounded environments.

## 4.3 Proof and safety invariants

- No evidence, no high-stakes claim.
- No policy path, no side-effect action.
- Every side effect links to: run → step → evidence → approver/policy decision.
- Every agent action attributable to an immutable principal.

---

## 5) Architecture (Reworked)

## 5.1 Context Fabric (existing Drovi moat)

Use existing Drovi intelligence as authoritative context:
- UEM + evidence artifacts,
- bi-temporal UIO truth,
- contradiction/risk engines,
- hybrid retrieval + timeline queries.

New runtime APIs:
- `context.retrieve(scope, intent)`
- `context.timeline(entity, t)`
- `context.diff(since)`
- `context.proof(claim_id)`

## 5.2 Agent Control Plane (new)

Services:
- role/profile/playbook registry,
- deployment/version manager,
- policy compiler,
- trigger router and assignment.

Responsibilities:
- validate configurations (typed schemas),
- resolve which agent(s) should run,
- generate immutable deployment snapshots.

## 5.3 Agent Runtime Plane (new)

Execution stack:
- Kafka for event ingress/egress,
- Temporal for durable long-running workflows,
- per-agent and per-resource lanes for deterministic concurrency,
- run lifecycle streaming (SSE/WS) to UI/admin.

Runtime semantics:
- perception → planning → tool actions → verification → commit → report,
- pause/resume/signal for human approvals,
- retries/compensation for failures.

## 5.4 Tool and Action Plane (expanded)

- typed tool manifest and schema contracts,
- provider adapters (browser, SaaS, files, exec, desktop),
- side-effect tiers + required approvals,
- tool-level observability and failure taxonomy.

## 5.5 Desktop Execution Plane (new)

`apps/drovi-desktop` (Electron + signed native bridges):
- secure local bridge over mTLS + org/user binding,
- permission prompts + short-lived capability tokens,
- local action recorder/replay logs,
- optional attended mode (user sees actions in real time).

## 5.6 Eval + Learning Plane (new)

- role-specific eval suites,
- online scoring of each run,
- feedback capture and policy/prompt updates,
- drift detection (quality degradation, risky behavior).

## 5.7 Identity + Presence Plane (new)

- Agent inbox provisioning and lifecycle management.
- Slack/Teams membership mapping to agent roles.
- Channel routing engine (mentions, DMs, mailbox rules, queueing).
- Thread/session continuity with org-safe memory boundaries.
- In-channel approvals and policy-aware outbound actions.
- Channel-level guardrails (external recipients, DLP, policy checks).

---

## 6) OpenClaw Patterns to Port Directly

From `/Users/jeremyscatigna/openclaw`, port these designs:

- Lane-aware serialized execution + concurrency caps.
- Strict per-agent tool policies (allow/deny + sandbox overlays).
- Session/routing isolation to avoid context collisions.
- Hook system around run lifecycle and tool invocation.
- Browser control abstraction and isolated browser profiles.
- Elevated execution gates and explicit approval paths.
- Sub-agent pattern for background parallel work.

These patterns are proven for agent safety + operability and map cleanly to AgentOS.

---

## 7) Product Surfaces (Web + Desktop)

Replace Continuums/Builder/Exchange with:

- **Agent Workforce**: directory of deployed AI employees and live status.
- **Agent Studio**: role/profile/playbook composer (NL + structured).
- **Agent Catalog**: install templates (internal + marketplace).
- **Agent Runs**: deep replay and root-cause debugging.
- **Agent Governance**: permissions, approvals, policy guardrails.
- **Agent Evals**: quality, regressions, drift, benchmark trends.
- **Agent Inbox**: unified email/Slack/Teams operations and task handoff queue.
- **Agent Command Center**: chat + command bar for all agents.

Desktop companion provides:
- local action approval,
- local file/app access,
- attended execution view.

---

## 8) Example “Real AI Employee” Workflows

## 8.1 Sales SDR Agent
- Monitors new leads + intent signals + past interactions.
- Drafts and optionally sends personalized outreach.
- Updates CRM stages/notes.
- Handles inbound lead emails and Slack channel mentions.
- Escalates hot leads to AE with evidence-backed summary.

## 8.2 HR Recruiting Coordinator
- Parses inbound candidates, schedules interviews, follows up,
- tracks pipeline bottlenecks and no-shows,
- generates weekly hiring brief with risk flags.

## 8.3 Executive Deck Agent
- Pulls KPI data, generates spreadsheet and slide deck,
- optionally uses desktop companion to populate local templates,
- sends final package via email and logs evidence trail.

## 8.4 Contract/Advice Sentinel (Legal)
- Detects contradictory advice and stale legal positions,
- blocks risky outbound drafts pending partner approval,
- outputs advice timeline with exact quotes and provenance.

---

## 9) Migration: Remove Continuums Safely

Migration path:
1. Build Continuum→Agent Playbook adapter.
2. Dual-run in shadow mode (no side effects).
3. Cutover UI to Agent surfaces.
4. Freeze Continuum creation.
5. Decommission Continuum runtime/exchange after migration SLOs are met.

No abrupt breaks for existing users.

---

## 10) Recommended Technology Decisions

- Keep Python intelligence core + Kafka + Postgres.
- Add Temporal as orchestration backbone.
- Introduce Electron desktop companion for local computer actions.
- Add Agent Identity/Presence gateway for email + Slack + Teams.
- Add browser provider abstraction with first adapters:
  - Local Playwright/CDP,
  - Managed browser provider adapter (Parallel integration path).
- Keep policy-first and evidence-first constraints non-negotiable.

---

## 11) Success Criteria

Operational:
- Agent run success rate (excluding policy blocks) > 97%.
- p95 action decision latency within target by tier.
- < 1% unresolved failed runs older than SLA.

Product:
- Active AI employees per org.
- Automated work products shipped/week.
- Human hours saved by role.

Trust:
- Evidence coverage on high-stakes claims/actions.
- Contradictions caught before outbound actions.
- Audit completeness for all side effects.

---

## 12) Immediate Next Build

1. Define AgentOS contracts (entities + APIs + policies) and freeze Continuum growth.
2. Ship Agent Control Plane + Runtime skeleton with run lifecycle streaming.
3. Ship Agent Identity + Presence MVP (email inbox + Slack + Teams routing).
4. Launch Agent Workforce + Agent Studio (MVP) + chat command center.
5. Integrate browser provider abstraction and first managed adapter.
6. Build desktop companion alpha for local file/app actions with strict approvals.
7. Launch first broad packs: Sales + HR + Legal + Accounting starter agents.
