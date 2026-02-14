# Drovi AgentOS Tasks (Frontier-Grade AI Employees)

Implements:
- `/Users/jeremyscatigna/project-memory/DROVI_FRONTIER_AGENTS_PLAN.md`

Objective:
- Replace Continuums with a production-grade AgentOS where companies can deploy real AI employees with live memory, broad tool access, email/Slack/Teams presence, policy boundaries, and auditable autonomous execution.

---

## Global Execution Protocol

- [ ] G.01 Every phase ends with green checks: backend `pytest`, frontend `bun run lint`, `bun run check-types`, `bun run test:run`, and Docker health checks.
- [ ] G.02 New/changed backend modules stay under 800 LOC; split oversized files before phase sign-off.
- [ ] G.03 No untyped error paths in runtime/control plane; all errors map to stable codes.
- [ ] G.04 No hidden side effects: every action emits run/audit events.
- [ ] G.05 Any action-capability feature must include policy tests and denial-path tests.
- [ ] G.06 Maintain OpenAPI snapshot and regenerate API clients on every contract change.
- [ ] G.07 Add or update observability for every new critical path (latency, failure, retries, approvals).

---

## Phase 0 — Product Contract + Capability Matrix

- [x] P0.01 Replace product vocabulary in docs/UI from `Continuum` to `AgentOS` primitives.
- [x] P0.02 Define capability matrix by domain: Sales, HR, Finance, Support, Legal, Accounting, Ops.
- [x] P0.03 Define autonomy tiers `L0..L4` and map each tool/action to required tier.
- [x] P0.04 Define side-effect classes: read-only, low-risk write, high-risk write, external commit.
- [x] P0.05 Define “proof-required” output classes and evidence requirements.
- [x] P0.06 Define human approval policy matrix (who can approve what, SLA, fallback path).
- [x] P0.07 Add architecture ADR for Electron Desktop Companion and local bridge security model.
- [x] P0.08 Add ADR for browser provider abstraction with managed-provider adapter path.

Acceptance:
- [x] P0.A1 Signed-off capability matrix and autonomy policy docs exist in `docs/agentos/`.
- [x] P0.A2 Engineering can map every planned feature to a specific autonomy + policy tier.

---

## Phase 1 — AgentOS Core Data Model + API Contracts

### Schema and Migrations
- [x] P1.01 Add tables: `agent_role`, `agent_profile`, `agent_playbook`, `agent_memory_scope`.
- [x] P1.02 Add tables: `agent_deployment`, `agent_trigger`, `agent_run`, `agent_run_step`.
- [x] P1.03 Add tables: `agent_work_product`, `agent_feedback`, `agent_eval_result`, `agent_permission_grant`.
- [x] P1.04 Add tables: `agent_team`, `agent_team_member`, `agent_handoff`.
- [x] P1.05 Add DB constraints for org isolation, unique versioning, and immutable deployment snapshots.
- [x] P1.06 Add indexes for run timeline queries, trigger lookups, and policy audit lookups.

### API Surface
- [x] P1.07 Add `/api/v1/agents/roles` CRUD.
- [x] P1.08 Add `/api/v1/agents/profiles` CRUD with scoped permission schema validation.
- [x] P1.09 Add `/api/v1/agents/playbooks` CRUD with lint endpoint.
- [x] P1.10 Add `/api/v1/agents/deployments` create/promote/rollback.
- [x] P1.11 Add `/api/v1/agents/runs` list/detail/replay metadata.
- [x] P1.12 Add `/api/v1/agents/catalog` for templates.
- [x] P1.13 Add `/api/v1/agents/evals` and `/api/v1/agents/feedback` endpoints.

### Contract and Tests
- [x] P1.14 Update OpenAPI snapshots + generated clients.
- [x] P1.15 Add unit tests for schema validation and migration rollback safety.
- [x] P1.16 Add integration tests for org boundary isolation on all new endpoints.

Acceptance:
- [x] P1.A1 API supports full lifecycle for role/profile/playbook/deployment.
- [x] P1.A2 DB migration and rollback path validated in Docker.

---

## Phase 2 — Agent Control Plane

- [x] P2.01 Build `AgentRegistryService` for role/profile/playbook lookup and version resolution.
- [x] P2.02 Build deployment snapshot compiler (immutable runtime bundle).
- [x] P2.03 Build policy compiler from profile + org policy + tool policy overlays.
- [x] P2.04 Build trigger routing service (event trigger, schedule trigger, manual trigger).
- [x] P2.05 Add trigger simulation endpoint for dry-run eligibility checks.
- [x] P2.06 Add config linting for invalid tool or memory scope references.
- [x] P2.07 Add compatibility adapter: Continuum DSL -> Agent Playbook (read-only conversion).
- [x] P2.08 Add caching for deployment snapshots with invalidation on publish.
- [x] P2.09 Emit audit events for all control-plane mutating actions.

Tests:
- [x] P2.10 Unit tests for compiler and snapshot determinism.
- [x] P2.11 Integration tests for trigger resolution precedence.
- [x] P2.12 Negative tests for policy violations and invalid schema fields.

Acceptance:
- [x] P2.A1 Any deployed agent has deterministic runtime config hash.
- [x] P2.A2 Trigger routing resolves correctly across competing candidates.

---

## Phase 3 — Agent Runtime Plane (Durable Execution)

- [x] P3.01 Add Temporal workflows for `AgentRunWorkflow` (single run lifecycle).
- [x] P3.02 Add activities: context retrieval, planning, tool call, verification, commit, report.
- [x] P3.03 Add lane scheduler: per-agent lane + per-resource lane + org concurrency caps.
- [x] P3.04 Add kill-switch, pause, resume, and signal handling.
- [x] P3.05 Add retry strategies by failure type (tool transient, provider transient, policy block).
- [x] P3.06 Add compensation hooks for failed side effects where possible.
- [x] P3.07 Publish run lifecycle events (`accepted`, `running`, `waiting_approval`, `completed`, `failed`).
- [x] P3.08 Persist run steps with structured traces and token/tool usage.
- [x] P3.09 Add dead-letter handling for unrecoverable run failures.

Tests:
- [x] P3.10 Temporal time-skipping tests for pause/resume/retry/timeout.
- [x] P3.11 Concurrency tests to prove no same-lane collision.
- [x] P3.12 Chaos tests for worker restarts during long-running workflows.

Acceptance:
- [x] P3.A1 Long-running runs survive service restarts.
- [x] P3.A2 Deterministic lane behavior under concurrent trigger storms.

---

## Phase 4 — Tool Plane + Policy Hardening

- [x] P4.01 Define typed tool manifest spec (`tool_id`, input/output schema, side-effect tier).
- [x] P4.02 Add tool registry service with schema validation.
- [x] P4.03 Add per-agent allow/deny policy with precedence chain.
- [x] P4.04 Add per-org policy overlay and emergency denylist.
- [x] P4.05 Add runtime policy decision engine (allow, deny, require-approval).
- [x] P4.06 Add high-risk action approval workflow with SLA and escalation path.
- [x] P4.07 Add action receipts (tool request, policy result, approver, final result).
- [x] P4.08 Add “no evidence, no action” enforcement for high-stakes categories.

Tests:
- [x] P4.09 Unit tests for policy precedence and deny-overrides.
- [x] P4.10 Integration tests for approval-required actions and rejection behavior.
- [x] P4.11 Regression tests ensuring blocked tools cannot be called via alternate paths.

Acceptance:
- [x] P4.A1 Unauthorized side effects are impossible in tests.
- [x] P4.A2 All side-effect executions have complete audit trails.

---

## Phase 4.5 — Agent Identity + Presence (Email, Slack, Teams)

- [x] P4.5.01 Add identity entities: `agent_identity`, `agent_channel_binding`, `agent_inbox_thread`, `agent_message_event`.
- [x] P4.5.02 Add provisioning service for agent addresses (`<agent>@agents.<domain>` alias strategy + enterprise custom domain mode).
- [x] P4.5.03 Add inbound/outbound email integration for agent identities (thread-safe routing).
- [x] P4.5.04 Add Slack app integration with per-channel and per-DM routing to specific agents.
- [x] P4.5.05 Add Teams bot integration with channel/DM routing and mention parsing.
- [x] P4.5.06 Add unified `agent.inbox.events` topic for incoming channel traffic.
- [x] P4.5.07 Add channel trigger parser (task extraction from natural messages and emails).
- [x] P4.5.08 Add in-channel response renderer with evidence links and run ids.
- [x] P4.5.09 Add in-channel approval actions (approve/deny/escalate) mapped to runtime signals.
- [x] P4.5.10 Add outbound policy checks for recipients/domains/sensitivity before send.
- [x] P4.5.11 Add identity mode support:
- [x] P4.5.12 Virtual persona mode (recommended default).
- [x] P4.5.13 Dedicated account mode (enterprise/compliance option).
- [x] P4.5.14 Add thread/session continuity mapping for long-lived channel conversations.
- [x] P4.5.15 Add observability: inbox lag, response SLA, channel action failures, approval latency.

Tests:
- [x] P4.5.16 Integration tests for email->run->reply loop.
- [x] P4.5.17 Integration tests for Slack mention/DM routing and thread continuity.
- [x] P4.5.18 Integration tests for Teams mention/DM routing and approvals.
- [x] P4.5.19 Security tests for cross-org routing leakage and spoofed sender handling.

Acceptance:
- [x] P4.5.A1 Agents can be assigned tasks and asked questions by email, Slack, and Teams.
- [x] P4.5.A2 Inbound/outbound channel actions are policy-controlled and fully audited.

---

## Phase 5 — Browser Automation Stack (Local + Managed)

- [x] P5.01 Introduce `BrowserProvider` interface in backend tool adapters.
- [x] P5.02 Implement local Playwright/CDP provider (deterministic, trace-enabled).
- [x] P5.03 Implement managed browser provider adapter skeleton.
- [x] P5.04 Integrate managed provider credentials and org-level secret handling.
- [x] P5.05 Add browser session lifecycle APIs (create/reuse/close/session state).
- [x] P5.06 Add browser action primitives: navigate, snapshot, click, type, download, upload.
- [x] P5.07 Add browser observability: HAR/trace/screenshot artifacts per run step.
- [x] P5.08 Add safe browsing controls: domain allowlist/denylist and data exfiltration checks.
- [x] P5.09 Add optional Parallel adapter implementation path under provider abstraction.
- [x] P5.10 Add fallback routing policy between local and managed provider.

Tests:
- [x] P5.11 Provider contract tests (same scenario, same expected behavior).
- [x] P5.12 End-to-end test: authenticated web flow with form completion + proof capture.
- [x] P5.13 Failure tests: stale session, selector drift, download timeout, navigation dead end.

Acceptance:
- [x] P5.A1 Browser tasks are replayable and diagnosable from artifacts.
- [x] P5.A2 Provider swap does not require agent playbook changes.

---

## Phase 6 — Desktop Companion (Electron) for Local Computer Actions

- [x] P6.01 Create `apps/drovi-desktop` Electron app (signed build baseline).
- [x] P6.02 Implement secure local bridge daemon (mTLS + short-lived capability tokens).
- [x] P6.03 Implement permission prompts for local file/app/screen actions.
- [x] P6.04 Implement audited local capabilities:
- [x] P6.05 File system read/write in approved roots only.
- [x] P6.06 Application launch with allowlist.
- [x] P6.07 Desktop automation adapters:
- [x] P6.08 macOS adapter (AppleScript + Accessibility wrapper).
- [x] P6.09 Windows adapter (PowerShell + UI Automation/COM wrapper).
- [x] P6.10 Add attended mode UI showing live step execution and pause control.
- [x] P6.11 Add local secrets isolation and encryption-at-rest for cached credentials.
- [x] P6.12 Add remote-disable command from server for emergency shutdown.

Tests:
- [x] P6.13 Unit tests for bridge auth and token expiry.
- [x] P6.14 Integration tests for allowlisted vs denied app/file actions.
- [x] P6.15 Security tests for path traversal, privilege escalation, and command injection.

Acceptance:
- [x] P6.A1 Agent can create/update local spreadsheet/presentation in attended mode.
- [x] P6.A2 Every local action has policy + audit + optional approval path.

---

## Phase 7 — Chat, Command Center, and Multi-Interface Access

- [x] P7.01 Build `/dashboard/agents/workforces` page (live AI employee directory).
- [x] P7.02 Build `/dashboard/agents/studio` page (role/profile/playbook editor).
- [x] P7.03 Build `/dashboard/agents/runs` page (trace, replay, failure diagnostics).
- [x] P7.04 Build `/dashboard/agents/catalog` page (templates/install).
- [x] P7.04b Build `/dashboard/agents/inbox` page (channel queue, thread status, assignment, approvals).
- [x] P7.05 Build Agent Command Center with direct chat to selected agent/team.
- [x] P7.06 Add run status streaming in UI (SSE/WS).
- [x] P7.07 Add inline evidence panel in chat responses.
- [x] P7.08 Add action approval inbox in app + desktop companion.
- [x] P7.09 Add API + webhook access for external app integrations.
- [x] P7.10 Remove Continuum pages from primary navigation and route to migration view.

Tests:
- [x] P7.11 Component tests for all agent pages with mocked API states.
- [x] P7.12 E2E tests: create role -> deploy -> chat -> action approval -> run completion.
- [x] P7.13 Accessibility and responsive tests for core agent screens.

Acceptance:
- [x] P7.A1 Users can chat with agents and trigger concrete work from UI/API.
- [x] P7.A2 Real-time run lifecycle is visible and debuggable.

---

## Phase 8 — Multi-Agent Workforce Orchestration

- [x] P8.01 Implement `AgentTeam` orchestration engine (planner + specialist handoffs).
- [x] P8.02 Add handoff protocol and shared objective context object.
- [x] P8.03 Add role-specialization prompts and constraints per member.
- [x] P8.04 Add concurrency policy per team (parallel vs sequential stages).
- [x] P8.05 Add team-level conflict resolution rules.
- [x] P8.06 Add budget and guardrails per team run.
- [x] P8.07 Add sub-run linking in run timeline (parent/child runs).

Tests:
- [x] P8.08 Unit tests for handoff integrity and context isolation.
- [x] P8.09 Integration tests for multi-agent task completion with failure fallback.
- [x] P8.10 Load tests for team orchestration under concurrent org workloads.

Acceptance:
- [x] P8.A1 Multi-agent teams produce consistent output with traceable handoffs.
- [x] P8.A2 Team-level run failure does not corrupt parent objective state.

---

## Phase 9 — Work Product Engines (Concrete Deliverables)

- [x] P9.01 Add work-product abstraction for outputs (`email`, `sheet`, `slides`, `doc`, `ticket`, `api_action`).
- [x] P9.02 Implement email generation/sending engine with approval tiers.
- [x] P9.03 Implement spreadsheet generation engine (xlsx/csv templates + data binding).
- [x] P9.04 Implement slide deck generation engine (template-based with chart binding).
- [x] P9.05 Implement document drafting engine with evidence citations.
- [x] P9.06 Add delivery engine (email/share link/CRM attachment/project ticket).
- [x] P9.07 Add verification pass for output quality and policy compliance before send.
- [x] P9.08 Add artifact storage + provenance links.

Tests:
- [x] P9.09 Golden tests for output format correctness (xlsx/pptx/doc).
- [x] P9.10 Integration tests for send/deliver/rollback-on-failure.
- [x] P9.11 Quality tests for citation integrity in generated docs.

Acceptance:
- [x] P9.A1 Agents can reliably produce and deliver concrete business artifacts.
- [x] P9.A2 Artifacts are versioned and evidence-linked.

---

## Phase 10 — Broad Starter Packs (Sales + HR + Legal + Accounting)

### Sales Pack
- [ ] P10.01 Build `Sales SDR Agent` template.
- [ ] P10.02 Build `RevOps Hygiene Agent` template.
- [ ] P10.03 Build `Renewal Risk Agent` template.

### HR Pack
- [ ] P10.04 Build `Recruiting Coordinator Agent` template.
- [ ] P10.05 Build `Onboarding Manager Agent` template.
- [ ] P10.06 Build `Policy Q&A + Drift Agent` template.

### Legal/Accounting baseline packs
- [ ] P10.07 Build `Advice Timeline Sentinel` template.
- [ ] P10.08 Build `Contradiction Detection Agent` template.
- [ ] P10.09 Build `Filing & Missing Docs Agent` template.

### Pack quality
- [ ] P10.10 Add role-specific eval suites for each starter pack.
- [ ] P10.11 Add sample datasets and seeded demo org scenarios.

Acceptance:
- [ ] P10.A1 Each pack works out of the box with clear permissions and eval baselines.
- [ ] P10.A2 Demo org can show real end-to-end outcomes in each function.

---

## Phase 11 — Trust, Governance, and Enterprise Security

- [ ] P11.01 Add first-class agent service principals (identity per deployment).
- [ ] P11.02 Add delegated authority records (who authorized which capabilities).
- [ ] P11.03 Add approval chains (single/multi approver, SLA timers, escalation).
- [ ] P11.04 Add red-team policy test harness for prohibited actions.
- [ ] P11.05 Add data residency and retention policy hooks by org.
- [ ] P11.06 Add immutable audit ledger entries for all action decisions.
- [ ] P11.07 Add policy simulation mode for safe dry-run audits.
- [ ] P11.08 Add governance dashboards in admin app.

Tests:
- [ ] P11.09 Security integration tests across tenant boundaries.
- [ ] P11.10 Pen-test style unit/integration checks for policy bypass vectors.
- [ ] P11.11 Disaster tests for kill-switch and emergency denylist propagation.

Acceptance:
- [ ] P11.A1 Enterprise governance controls are enforceable and observable.
- [ ] P11.A2 Compliance/audit exports are complete for side-effect runs.

---

## Phase 12 — Evaluation, Learning, and Quality Optimization

- [ ] P12.01 Build evaluation runner for offline benchmark suites.
- [ ] P12.02 Build online per-run scoring and trend aggregation.
- [ ] P12.03 Add human feedback capture UI and API (`accepted`, `edited`, `rejected`, reason).
- [ ] P12.04 Add confidence calibration service by role and org.
- [ ] P12.05 Add policy/prompt recommendation engine from feedback + eval drift.
- [ ] P12.06 Add automated regression gates on critical role metrics.

Tests:
- [ ] P12.07 Unit tests for scoring and calibration math.
- [ ] P12.08 Integration tests for feedback->retraining/reconfiguration pipeline.
- [ ] P12.09 Dashboard tests for eval trend correctness.

Acceptance:
- [ ] P12.A1 Agent quality improves measurably over time.
- [ ] P12.A2 Regression gates block harmful quality drops.

---

## Phase 13 — Continuum Decommission and Migration Completion

- [ ] P13.01 Freeze Continuum creation endpoints.
- [ ] P13.02 Migrate existing continuum definitions via adapter and verify equivalence.
- [ ] P13.03 Run dual-mode shadow validation for selected orgs.
- [ ] P13.04 Cut over UI routes from Continuums to AgentOS pages.
- [ ] P13.05 Keep read-only Continuum history views for transition window.
- [ ] P13.06 Remove continuum runtime/scheduler/exchange code paths after 100% migration.
- [ ] P13.07 Remove obsolete frontend modules and API clients tied to Continuums.

Tests:
- [ ] P13.08 Migration tests for data integrity and behavior parity.
- [ ] P13.09 Backward compatibility tests for legacy read-only endpoints.

Acceptance:
- [ ] P13.A1 No active org depends on Continuum runtime.
- [ ] P13.A2 Continuum code is fully removed from active execution path.

---

## Phase 14 — Production Readiness and Pilot Launch

- [ ] P14.01 SLO definition and alerting for run success, latency, approval backlog, drift.
- [ ] P14.02 Capacity and load tests with enterprise-scale event volumes.
- [ ] P14.03 Runbook completion: incident response, rollback, failover, degraded mode.
- [ ] P14.04 Backup and recovery drills for control plane and run store.
- [ ] P14.05 Security review + threat model sign-off.
- [ ] P14.06 Pilot enablement package (onboarding guide, governance templates, role packs).
- [ ] P14.07 Demo mode seeding for investor and pilot walkthroughs.
- [ ] P14.08 Final hardening pass on UX copy, localization, and diagnostics.

Acceptance:
- [ ] P14.A1 System passes production readiness checklist.
- [ ] P14.A2 First pilot orgs can run Sales/HR/Legal/Accounting agents end-to-end.

---

## “Done” Definition for AgentOS Program

- [ ] D.01 Users can chat with AI employees and assign complex tasks.
- [ ] D.02 Agents can autonomously execute across SaaS tools + browser + approved desktop actions.
- [ ] D.03 Agents produce concrete work products (emails/docs/sheets/slides) with evidence trails.
- [ ] D.04 Governance can enforce identity, permissions, approvals, and kill switches.
- [ ] D.05 Quality improves continuously via evals and human feedback.
- [ ] D.06 Agents operate as communication-native coworkers in email, Slack, and Teams.
- [ ] D.07 Continuums are fully replaced by AgentOS in production.
