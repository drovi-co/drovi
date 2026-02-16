# IMPERIUM Tasks - Full Product Execution Checklist

Implements:

- `/Users/jeremyscatigna/project-memory/IMPERIUM_PLAN.md`

Objective:

- Deliver full Imperium product (not MVP) with a new Rust backend, new `imperium` app in monorepo, extended Docker config, and complete iOS/macOS command center experience.

---

## Global Execution Protocol

- [ ] G.01 All architecture decisions captured as ADRs before irreversible implementation.
- [ ] G.02 Every phase must finish with green CI: lint, types, tests, and service health checks.
- [x] G.03 All backend changes must expose metrics and structured logs.
- [x] G.04 No user-facing AI claim without citation mapping in storage.
- [x] G.05 No side-effecting connector action without audit trail.
- [x] G.06 OpenAPI contract regenerated on every API shape change.
- [ ] G.07 Alerting features must include anti-spam controls and tests.
- [x] G.08 Data model migrations must have rollback path and backup procedure.
- [ ] G.09 Security review required at every connector onboarding milestone.
- [ ] G.10 Performance SLO regressions block release.

---

## Phase 0 - Product Contract and ADR Baseline

- [x] P0.01 Freeze Imperium product contract and non-negotiables in docs.
- [x] P0.02 Write ADR: Rust workspace layout and service boundaries.
- [x] P0.03 Write ADR: event bus choice (`nats`) and topic taxonomy.
- [x] P0.04 Write ADR: realtime protocol strategy (SSE + WebSocket split).
- [x] P0.05 Write ADR: citation-required AI output enforcement.
- [x] P0.06 Write ADR: old-money design token system and typography stack.
- [x] P0.07 Write ADR: SwiftUI/UIKit hybrid boundaries for charts and grids.
- [x] P0.08 Write ADR: security model (field encryption + passkeys + Apple sign-in).
- [ ] P0.09 Define full milestone map (M1-M5) and owner matrix.
- [ ] P0.10 Define release criteria for "personal", "executive", "institutional".

Acceptance:

- [ ] P0.A1 ADR set is approved and referenced by all implementation phases.
- [ ] P0.A2 Product contract has no unresolved scope ambiguities.

---

## Phase 1 - Monorepo Scaffolding

### New Repository Structure
- [x] P1.01 Create `apps/imperium` with package metadata and baseline scripts.
- [x] P1.02 Create `apps/ios/Imperium` Swift project skeleton (XcodeGen/Tuist compatible).
- [x] P1.03 Create `apps/macos/Imperium` Swift project skeleton.
- [x] P1.04 Create `services/imperium-backend` Rust workspace with root `Cargo.toml`.
- [x] P1.05 Create `packages/imperium-api-types` package scaffold.
- [x] P1.06 Create `packages/imperium-design-tokens` package scaffold.
- [x] P1.07 Add repo README sections for Imperium workspace paths.

### Tooling and Scripts
- [x] P1.08 Add root scripts for Imperium build/test/dev workflows.
- [ ] P1.09 Add Turbo pipeline entries for `imperium` app tasks.
- [x] P1.10 Add Rust lint/test scripts wrapper (workspace-level).
- [x] P1.11 Add OpenAPI generation command for Imperium backend.
- [x] P1.12 Add API type generation command into `packages/imperium-api-types`.

Acceptance:

- [x] P1.A1 `apps/imperium` and `services/imperium-backend` build independently.
- [x] P1.A2 Root scripts can run Imperium workflows without touching Drovi services.

---

## Phase 2 - Docker Compose Extension

### Compose Topology
- [x] P2.01 Add `imperium-api` service to `docker-compose.yml`.
- [x] P2.02 Add worker services: market, news, brief, alerts, risk, business, notify.
- [x] P2.03 Add `nats` service with JetStream enabled and health checks.
- [x] P2.04 Add `imperium-web` service based on `apps/imperium` Dockerfile.
- [x] P2.05 Add required volumes for new persistent services.
- [x] P2.06 Add `profiles: ["imperium"]` for all Imperium services.
- [x] P2.07 Add environment variable wiring for all new services.
- [x] P2.08 Add service-to-service dependencies and startup ordering.

### Developer Ergonomics
- [x] P2.09 Add `docker:imperium:up` root script.
- [x] P2.10 Add `docker:imperium:down` root script.
- [x] P2.11 Add `docker:imperium:logs` root script.
- [x] P2.12 Document local dev flow combining existing Drovi and new Imperium profiles.

Acceptance:

- [ ] P2.A1 `docker compose --profile imperium up -d` starts all Imperium services healthy.
- [ ] P2.A2 Existing Drovi compose behavior remains unchanged when profile not used.

---

## Phase 3 - Backend Foundation (Rust)

### Service Skeletons
- [x] P3.01 Implement `imperium-api` Axum app with health and readiness endpoints.
- [x] P3.02 Implement shared config crate with typed env validation.
- [x] P3.03 Implement shared error taxonomy crate.
- [x] P3.04 Implement tracing/logging middleware with request IDs.
- [x] P3.05 Implement DB connection pool and migration runner.
- [x] P3.06 Implement Redis client with key namespace strategy.
- [x] P3.07 Implement NATS publisher/subscriber abstraction.

### Quality and Contracts
- [x] P3.08 Add OpenAPI generation for all API endpoints.
- [x] P3.09 Add contract tests for API schema snapshots.
- [x] P3.10 Add worker scaffolds with lifecycle hooks and graceful shutdown.
- [x] P3.11 Add integration test harness for API + DB + Redis + NATS.

Acceptance:

- [ ] P3.A1 API and all workers boot, report health, and stop gracefully.
- [ ] P3.A2 Base integration tests pass in Docker.

---

## Phase 4 - Core Data Model and Persistence

### Schema Design
- [x] P4.01 Implement user/org/device/auth tables for Imperium isolation.
- [x] P4.02 Implement watchlist and symbol metadata tables.
- [x] P4.03 Implement market tick/candle/indicator tables with retention policy.
- [x] P4.04 Implement article, cluster, embedding, impact score tables.
- [x] P4.05 Implement portfolio account/position/transaction/snapshot tables.
- [x] P4.06 Implement business metric/invoice/expense/payroll tables.
- [x] P4.07 Implement alert rule/event/delivery/snooze tables.
- [x] P4.08 Implement brief/section/claim/citation tables.
- [x] P4.09 Implement thesis/review/playbook tables.
- [x] P4.10 Implement regime/risk/simulation tables.

### Data Guarantees
- [x] P4.11 Add constraints for citation-required brief claims.
- [x] P4.12 Add indexes for high-volume market/news queries.
- [x] P4.13 Add append-only history tables for corrections and audits.
- [x] P4.14 Add migration rollback scripts and data backup checks.

Acceptance:

- [ ] P4.A1 All migrations apply and rollback cleanly in isolated env.
- [ ] P4.A2 Query plans meet baseline latency targets for key endpoints.

---

## Phase 5 - Authentication, Identity, and Session Security

- [x] P5.01 Implement Apple Sign In auth flow in backend.
- [ ] P5.02 Implement passkey registration and assertion flow.
- [x] P5.03 Implement session lifecycle with device binding.
- [x] P5.04 Implement refresh token rotation and revocation.
- [ ] P5.05 Implement role model for personal/executive/institutional tiers.
- [ ] P5.06 Add secure API key mechanism for trusted machine workflows.
- [x] P5.07 Add audit logging for auth and security events.
- [ ] P5.08 Add brute-force and abuse-rate protection.

Acceptance:

- [ ] P5.A1 Native clients can sign in and restore sessions securely.
- [ ] P5.A2 Security tests cover token theft, replay, and device mismatch paths.

---

## Phase 6 - Markets Engine (Real-Time)

### Ingestion and Normalization
- [x] P6.01 Implement provider abstraction layer for equities/ETF/index feeds.
- [x] P6.02 Implement crypto feed adapters with normalization contract.
- [ ] P6.03 Implement symbol metadata sync and exchange mapping.
- [ ] P6.04 Implement real-time tick ingestion with backpressure handling.

### Candles and Indicators
- [ ] P6.05 Implement candle aggregator for 1m/5m/15m/1h/1d windows.
- [ ] P6.06 Implement EMA(20/50/200) and VWAP calculators.
- [ ] P6.07 Implement RSI and MACD calculators.
- [ ] P6.08 Implement premarket/afterhours segmentation logic.

### Streaming and API
- [ ] P6.09 Implement market websocket channels with symbol subscription limits.
- [x] P6.10 Implement REST endpoints for historical candles and indicators.
- [ ] P6.11 Implement market status endpoints (open/closed, session states).
- [ ] P6.12 Implement watchlist streaming fanout optimization.

Acceptance:

- [ ] P6.A1 Market update render path is below 300ms p95 in staging tests.
- [ ] P6.A2 Candle/indicator values match reference data for sample symbols.

---

## Phase 7 - Intelligence Inbox Engine

### Source Ingestion
- [x] P7.01 Implement RSS and source registry ingestion pipeline.
- [x] P7.02 Implement premium feed adapter abstraction.
- [x] P7.03 Implement SEC filing and earnings transcript ingest path.
- [ ] P7.04 Implement newsletter parser and normalization.
- [ ] P7.05 Implement optional transcript ingestors (YouTube/podcast).

### Dedupe and Ranking
- [x] P7.06 Implement semantic dedupe pipeline for near-duplicate stories.
- [x] P7.07 Implement narrative clustering with canonical cluster IDs.
- [ ] P7.08 Implement relevance scoring against watchlists and holdings.
- [ ] P7.09 Implement novelty scoring vs already-read history.
- [ ] P7.10 Implement cluster-level summary and bull/bear extraction.

### APIs
- [ ] P7.11 Implement cluster feed endpoints with filters.
- [ ] P7.12 Implement article details endpoint with source metadata.
- [ ] P7.13 Implement read/archive/save/tag actions.
- [ ] P7.14 Implement annotation-to-journal action endpoints.

Acceptance:

- [ ] P7.A1 Duplicate story collapse rate meets target (>70% for sampled bursts).
- [ ] P7.A2 Ranked feed relevance aligns with user watchlist impact benchmarks.

---

## Phase 8 - Daily Brief Engine (Moat)

### Pipeline
- [ ] P8.01 Implement 05:00 local scheduler with timezone correctness.
- [ ] P8.02 Implement overnight market recap constructor.
- [ ] P8.03 Implement macro calendar aggregation job.
- [ ] P8.04 Implement portfolio/business signal merger for brief context.
- [ ] P8.05 Implement ranked must-read selector with max-item enforcement.

### AI Generation and Validation
- [ ] P8.06 Implement structured prompt builder with deterministic templates.
- [ ] P8.07 Implement generation runtime with retries and fallback model strategy.
- [x] P8.08 Implement post-generation schema and citation validators.
- [ ] P8.09 Implement confidence filter and unsafe-claim rejection.
- [ ] P8.10 Implement "since last checked" incremental brief updates.

### Delivery
- [x] P8.11 Implement brief storage and immutable section snapshots.
- [ ] P8.12 Implement brief ready push notification and deep links.
- [ ] P8.13 Implement brief read tracking and section review states.

Acceptance:

- [ ] P8.A1 Morning brief generation completes under 20 seconds p95.
- [ ] P8.A2 All published claims are backed by persisted citations.

---

## Phase 9 - Portfolio and Net Worth Engine

### Data Integration
- [ ] P9.01 Implement manual portfolio entry APIs and UX contract.
- [ ] P9.02 Implement brokerage connector abstraction (provider-agnostic).
- [ ] P9.03 Implement crypto wallet ingestion adapter.
- [x] P9.04 Implement bank account balance and transaction sync abstraction.

### Analytics
- [ ] P9.05 Implement P&L calculations (daily/weekly/YTD).
- [ ] P9.06 Implement realized vs unrealized gain logic.
- [ ] P9.07 Implement exposure calculations by asset class/sector/currency.
- [ ] P9.08 Implement concentration and drawdown metrics.
- [ ] P9.09 Implement correlation matrix generation job.

### APIs
- [x] P9.10 Implement portfolio overview endpoints.
- [x] P9.11 Implement account drilldown endpoints.
- [ ] P9.12 Implement holdings timeline endpoints.

Acceptance:

- [ ] P9.A1 Portfolio valuations reconcile with connector source snapshots.
- [ ] P9.A2 Core portfolio endpoints return under 2 seconds p95.

---

## Phase 10 - Business Command Engine

### Connectors
- [ ] P10.01 Implement Stripe ingestion adapter for revenue/subscription events.
- [ ] P10.02 Implement Polar ingestion adapter.
- [ ] P10.03 Implement QuickBooks ingestion adapter.
- [ ] P10.04 Implement business-bank transaction ingestion adapter.

### Business Metrics
- [ ] P10.05 Implement MRR/ARR/revenue growth calculations.
- [ ] P10.06 Implement burn and runway calculations.
- [ ] P10.07 Implement receivables aging and overdue invoice signals.
- [ ] P10.08 Implement payroll and recurring expense forecasting.
- [ ] P10.09 Implement anomaly detection for refunds/spend spikes.

### APIs
- [ ] P10.10 Implement business overview endpoints.
- [ ] P10.11 Implement metric trend endpoints.
- [ ] P10.12 Implement board snapshot export APIs.

Acceptance:

- [ ] P10.A1 Business dashboard supports daily operations without manual spreadsheet dependency.
- [ ] P10.A2 Anomaly alerts fire with precision/recall target thresholds.

---

## Phase 11 - Alert Engine and Notification Dispatcher

### Rule Engine
- [ ] P11.01 Implement alert rule DSL for market/news/business triggers.
- [ ] P11.02 Implement threshold + conditional + pattern operators.
- [x] P11.03 Implement per-rule severity and cooldown configuration.
- [x] P11.04 Implement dedupe key and suppression strategy.
- [ ] P11.05 Implement user-defined topics and impact thresholds.

### Dispatch
- [ ] P11.06 Implement APNs dispatch service with delivery receipts.
- [ ] P11.07 Implement in-app notification feed APIs.
- [ ] P11.08 Implement optional email fallback for critical alerts.
- [ ] P11.09 Implement escalation policy when alerts are unacknowledged.

### Payload Contract
- [ ] P11.10 Enforce payload fields: what happened/why it matters/what next.
- [ ] P11.11 Enforce deep-link resolution for all alert categories.

Acceptance:

- [ ] P11.A1 Alert dispatch latency under 1 second p95 for real-time triggers.
- [ ] P11.A2 Notification spam protections validated under burst simulations.

---

## Phase 12 - Risk, Regime, and Scenario Simulation

### Risk Analytics
- [ ] P12.01 Implement VaR computation service.
- [ ] P12.02 Implement stress tests for major macro shocks.
- [ ] P12.03 Implement concentration and liquidity risk overlays.

### Regime Detection
- [ ] P12.04 Implement regime feature pipeline (VIX, yields, DXY, oil, spreads).
- [ ] P12.05 Implement risk-on/off/neutral classifier and confidence model.
- [ ] P12.06 Implement explanation generator with evidence links.

### Scenario Engine
- [ ] P12.07 Implement ad hoc scenario input parser.
- [ ] P12.08 Implement portfolio impact simulation runner.
- [ ] P12.09 Implement hedge sizing recommendation model.

Acceptance:

- [ ] P12.A1 Regime output updates correctly on indicator shifts.
- [ ] P12.A2 Scenario outputs are reproducible with same snapshot input.

---

## Phase 13 - Decision Journal and Playbooks

### Journal
- [ ] P13.01 Implement thesis create/read/update/archive endpoints.
- [ ] P13.02 Implement source linking and evidence attachment.
- [ ] P13.03 Implement invalidation criteria and conviction scoring.
- [ ] P13.04 Implement review-date reminder scheduler.

### Playbooks
- [ ] P13.05 Implement playbook create/edit/test endpoints.
- [ ] P13.06 Implement trigger binding between playbooks and alert engine.
- [ ] P13.07 Implement action checklist execution tracking.
- [ ] P13.08 Implement "promote to long-term strategy" workflow.

Acceptance:

- [ ] P13.A1 Users can retrieve thesis history by topic and date window.
- [ ] P13.A2 Playbooks execute deterministic actions on trigger events.

---

## Phase 14 - iOS App (SwiftUI + UIKit)

### Foundation
- [x] P14.01 Create iOS app shell with auth, session, and secure storage.
- [x] P14.02 Implement design token application and typography setup.
- [x] P14.03 Implement networking layer with streaming support.
- [x] P14.04 Implement offline cache for latest brief + watchlists.

### Screen Delivery
- [x] P14.05 Implement Brief tab with citation drawers and review actions.
- [x] P14.06 Implement Markets tab with full-screen candles and alerts.
- [x] P14.07 Implement Portfolio tab with holdings and risk cards.
- [x] P14.08 Implement Business tab with runway and anomaly panels.
- [x] P14.09 Implement Intelligence tab with cluster feed and reading mode.
- [x] P14.10 Implement right-edge contextual AI panel.

### Platform Features
- [x] P14.11 Implement lock-screen brief widget.
- [x] P14.12 Implement haptic patterns for critical alerts.
- [x] P14.13 Implement notification deep links into exact module state.

Acceptance:

- [ ] P14.A1 iOS daily 05:00 ritual flow completes in <= 5 minutes.
- [ ] P14.A2 All key screens pass accessibility baseline and performance targets.

---

## Phase 15 - macOS App (SwiftUI + UIKit/AppKit)

### Foundation
- [x] P15.01 Create macOS app shell with multi-window support.
- [x] P15.02 Implement 3-pane layout and keyboard-first navigation.
- [x] P15.03 Implement command bar (`Cmd+K`) and global shortcuts.

### Screen Delivery
- [x] P15.04 Implement Daily Brief command station layout.
- [x] P15.05 Implement Markets command with research split-screen mode.
- [x] P15.06 Implement Portfolio operator view with simulation modal.
- [x] P15.07 Implement Business operator mode with board snapshot export flow.
- [x] P15.08 Implement Intelligence reading room with annotation controls.
- [x] P15.09 Implement Risk/Regime screen with portfolio overlay toggles.
- [x] P15.10 Implement Decision Journal timeline and outcome tracking.

### Desktop UX
- [x] P15.11 Implement trader-density table virtualization.
- [ ] P15.12 Implement zero-fluff animation profile (authority motion rules).
- [x] P15.13 Implement context panel and notification drawer.

Acceptance:

- [ ] P15.A1 macOS command station supports all module flows without parity gaps.
- [ ] P15.A2 Keyboard-only operation works for core daily workflow.

---

## Phase 16 - Imperium Web App (Monorepo App)

- [x] P16.01 Scaffold `apps/imperium` using current monorepo frontend conventions.
- [x] P16.02 Implement auth/session flow against Imperium backend.
- [x] P16.03 Implement module shells for Brief, Markets, Portfolio, Business, Intelligence.
- [x] P16.04 Implement realtime market and alert stream views.
- [x] P16.05 Implement operations pages for connector status and sync health.
- [x] P16.06 Implement admin-only debugging view for citations and alert decisions.
- [x] P16.07 Add `apps/imperium/Dockerfile` mirroring existing `web/admin` runtime pattern.

Acceptance:

- [ ] P16.A1 `imperium-web` container serves production build in Compose.
- [ ] P16.A2 Web app provides QA/ops parity for all backend modules.

---

## Phase 17 - Design System and Visual Fidelity

- [x] P17.01 Define full color tokens for dark command and parchment reading modes.
- [x] P17.02 Define typography scales (display/body/data) with tabular numeric rules.
- [x] P17.03 Define spacing, grid, and separator tokens for dense data layouts.
- [x] P17.04 Define motion presets (hard fades, no playful spring).
- [x] P17.05 Implement component primitives: command cards, metric rails, alert strips.
- [x] P17.06 Implement chart style presets aligned to old-money brief.
- [x] P17.07 Publish cross-platform token documentation.

Acceptance:

- [ ] P17.A1 iOS, macOS, and web surfaces exhibit consistent Imperium visual language.
- [ ] P17.A2 Design review signs off on "Bloomberg x private bank" criteria.

---

## Phase 18 - Security Hardening and Compliance

- [ ] P18.01 Implement field-level encryption for sensitive financial fields.
- [ ] P18.02 Implement secret rotation and envelope encryption policies.
- [x] P18.03 Implement immutable audit log sink and retention policy.
- [ ] P18.04 Implement connector scope minimization and revocation tooling.
- [ ] P18.05 Implement penetration-test checklist for API and native clients.
- [ ] P18.06 Implement secure enclave/keychain usage checks on Apple clients.
- [ ] P18.07 Implement local-only mode capability toggles (where feasible).

Acceptance:

- [ ] P18.A1 Security review has zero unresolved critical findings.
- [ ] P18.A2 All regulated data paths have audit and encryption coverage.

---

## Phase 19 - Observability, SRE, and Cost Controls

- [x] P19.01 Add Prometheus metrics for all Imperium services.
- [x] P19.02 Add Grafana dashboards: API, workers, connectors, alerts, brief pipeline.
- [x] P19.03 Add SLO burn-rate alerts for critical paths.
- [ ] P19.04 Add tracing across API -> worker -> provider calls.
- [x] P19.05 Add cost telemetry per provider and per feature surface.
- [x] P19.06 Add dead-letter queues and replay tooling.
- [x] P19.07 Add incident runbooks for data feed outages and stale briefs.

Acceptance:

- [ ] P19.A1 On-call can diagnose failures from dashboards without ad hoc scripts.
- [ ] P19.A2 Cost guardrails prevent uncontrolled real-time data spend.

---

## Phase 20 - Performance Engineering

- [ ] P20.01 Build load-test scenarios for market burst traffic.
- [ ] P20.02 Build load-test scenarios for 05:00 brief generation spikes.
- [ ] P20.03 Profile DB hotspots and optimize indexes/materializations.
- [ ] P20.04 Optimize websocket fanout path and subscription batching.
- [ ] P20.05 Optimize chart payload serialization and delta updates.
- [ ] P20.06 Validate API p95 and p99 latency against SLOs.
- [ ] P20.07 Validate mobile battery/network impact under live tracking use.

Acceptance:

- [ ] P20.A1 All published SLOs met under representative staging load.
- [ ] P20.A2 Native clients remain responsive during high-volatility sessions.

---

## Phase 21 - End-to-End QA and Release Readiness

- [ ] P21.01 Build e2e tests for full 05:00 ritual flow on iOS and macOS.
- [ ] P21.02 Build e2e tests for alerts from trigger to deep-link handling.
- [ ] P21.03 Build e2e tests for connector sync failures and recovery UX.
- [ ] P21.04 Build regression suite for citation integrity in briefs.
- [ ] P21.05 Build regression suite for scenario/risk computations.
- [ ] P21.06 Run usability pass focused on speed-to-clarity in morning workflow.
- [ ] P21.07 Execute dry-run launch week with shadow data.

Acceptance:

- [ ] P21.A1 No P0/P1 defects open at launch candidate cut.
- [ ] P21.A2 Founder ritual and all critical alert flows pass repeatedly.

---

## Phase 22 - Launch, Operations, and Evolution

- [ ] P22.01 Produce launch runbook for infrastructure and incident response.
- [ ] P22.02 Produce connector reliability runbook and escalation paths.
- [ ] P22.03 Produce data quality SLA document per provider category.
- [ ] P22.04 Produce monthly model quality review process for brief generation.
- [ ] P22.05 Produce quarterly design/system parity review across platforms.
- [ ] P22.06 Stand up roadmap for institutional tier hardening.

Acceptance:

- [ ] P22.A1 Imperium can operate continuously with measurable reliability.
- [ ] P22.A2 Post-launch improvement loop is active with clear ownership.

---

## Definition of Done (Program)

- [ ] D.01 New monorepo app `imperium` exists and is Dockerized.
- [ ] D.02 New Rust backend exists with isolated services and stable contracts.
- [ ] D.03 iOS and macOS native clients support full Imperium module set.
- [ ] D.04 05:00 brief, live markets, portfolio/business command, and alerts are production-ready.
- [ ] D.05 Security, observability, and performance targets are met and validated.
