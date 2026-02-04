# Drovi Beyond OS: The Intent Substrate

This is a full paradigm shift plan. It does not optimize for MVP. It defines a new class of system that treats organizational reality as a programmable substrate and makes intent the primary interface to computation.

---

**Core Thesis**
Drovi becomes the Intent Substrate: a continuous system that senses reality, maintains provable state, runs persistent goals, safely executes across tools, and adapts over time.

**New Names (to break SaaS gravity)**
- Missions → **Continuums** (persistent goal processes)
- Syscalls → **Actuators** (capability primitives)
- Knowledge Graph → **Reality Fabric** (bi‑temporal truth structure)
- Verification Engine → **Proof Core** (evidence‑anchored truth)
- Context Allocator → **Context Loom** (attention budgeter)
- Mission Control → **Command Deck** (runtime operations UI)
- Timeline → **Reality Stream** (time‑indexed truth playback)
- Omnibox → **Intent Bar** (universal command surface)

---

**Non‑Negotiable Principles**
1. Proof before prose. Every output is anchored to evidence.
2. Intent persists. Goals run until closed.
3. Time is first‑class. Everything has validFrom/validTo.
4. Actions are policy‑gated. Every execution is reversible and audited.
5. The UI is minimal. One input, one truth stream, one control deck.

---

**Paradigm Shift (What This Changes)**
- The unit of work is not a file or app. It is a Continuum.
- Apps are not destinations; they are Actuators.
- Outputs are not “answers”; they are verified state changes.
- Memory is not storage; it is a living Reality Fabric.

---

## The Future Architecture (Beyond MVP)

**Layer 1: Reality Instrumentation**
Sensors that capture “reality events,” not just data.
- Meetings, transcripts, and decisions as first‑class streams.
- Document edits, code diffs, approvals, and acknowledgements.
- Optional OS‑level activity capture with privacy budgets.
- CRM, billing, HR, and support events as signals.

**Layer 2: Reality Fabric (Bi‑Temporal Truth)**
A time‑indexed, evidence‑anchored world state.
- Every node has validFrom/validTo and evidence references.
- Contradiction handling is explicit and queryable.
- Proof is stored alongside claims as immutable evidence hashes.
- “What did we believe on date X?” is a core query.

**Layer 3: Proof Core (Truth Mechanism)**
A verification engine that rejects unsupported outputs.
- Multi‑pass extraction: classify → extract → verify → contradict.
- “No Evidence → No Persist” for high‑stakes items.
- Confidence calibration with retrainable models.
- Regression harness that gates deploys on hallucination rates.

**Layer 4: Continuum Runtime (Intent Scheduler)**
Long‑running goals as first‑class system processes.
- Continuums have objectives, constraints, risk thresholds, and proofs required.
- Continuums adapt based on new evidence and state changes.
- Escalation and exception handling is built in.

**Layer 5: Actuation Plane (Capability Primitives)**
Tool execution becomes system‑level primitives.
- Standard Actuator interface: read, draft, stage, execute.
- Drivers map to Gmail, Slack, Docs, CRMs, Git, etc.
- Safe execution tiers and reversible actions by default.

**Layer 6: Context Loom (Attention Kernel)**
Context is a budgeted resource.
- Retrieval is hybrid: graph + vector + temporal.
- Context caches are per‑continuum, not per request.
- Drift detection prunes stale context.

**Layer 7: Trust + Policy Core**
A policy runtime that governs execution.
- Policy‑as‑code with role, sensitivity, and action class.
- Proof‑required actions enforce user confirmations.
- Audit logs are tamper‑evident.

**Layer 8: Simulation Engine (Counterfactuals)**
Drovi simulates likely outcomes before execution.
- Counterfactual modeling for decisions and risks.
- “What happens if we do nothing?” becomes a default check.
- Scenario planning ties to Continuums.

---

## UI Beyond Chat (A New Interaction Model)

**UI Philosophy**
- One universal entry point.
- All answers are evidence‑anchored.
- Structured output first, narrative optional.
- Minimal surfaces, maximum truth.

**1) Intent Bar (Spotlight‑grade surface)**
- Global hotkey and always‑on overlay across macOS.
- Pulls context from the active app and open documents.
- Modes: Ask, Act, Build, Inspect.
- Inline actions: approve, stage, execute, reverse.
- Multimodal output: charts, tables, timelines, diffs.
- “Explain why” and “Show evidence” as first‑class toggles.

**2) Reality Stream (Truth Playback)**
- A time‑ordered stream of what changed.
- Every item links to evidence spans, transcripts, or diffs.
- Filters by Continuum, person, risk, or project.
- “What changed since last check?” becomes a default view.

**3) Command Deck (Continuum Operations)**
- Shows Continuums as running processes.
- Each Continuum shows state, drift, and next action.
- Kill switch, escalation controls, and audit trail.
- “Prove why” for every action and recommendation.

**4) Rendered Objects (Not Just Text)**
- Structured outputs render as charts, graphs, and data cards.
- JSON‑driven rendering for dynamic UIs on the fly.
- Narrative and structure are always dual‑view toggles.

**5) Evidence Lens (Instant Proof Overlay)**
- Hover on any claim to show evidence snippets.
- Inline provenance for every decision or commitment.
- Zero‑friction access to the underlying proof.

---

## Desktop Shell Architecture (2026‑Grade)

**Drovi Shell (macOS App)**
- A dedicated macOS app with system‑wide hotkey and overlay.
- Runs in the menu bar for instant access.
- Ships as a first‑class desktop OS extension, not a web app shell.

**Best‑in‑Class Stack (2026)**
- Tauri v2+ for cross‑platform performance and security.
- Rust core for local orchestration, encryption, and IPC.
- Native macOS modules in Swift for system‑level hooks.
- WebView UI layer for rapid iteration and JSON rendering.

**Process Model**
- Shell UI process for rendering and interaction.
- Local Core process for context capture and caching.
- Secure IPC channel between UI and Core.
- Optional background daemon for Continuum scheduling.

**Context Capture (Beyond Tabs)**
- macOS Accessibility API for active app context.
- ScreenCaptureKit for focused window capture with consent.
- App‑specific connectors for Slack, Docs, CRM, Calendar.
- Local text extraction with OCR for non‑text surfaces.

**Privacy and Consent**
- Per‑app permissions with explicit user opt‑in.
- On‑device redaction and sensitivity filtering.
- Context budgets that expire and self‑delete.
- Always‑visible indicator when capture is active.

---

## Intent Bar Interaction Model (Deep Dive)

**Modes**
- Ask: fetch reality state with proof.
- Act: create or trigger Continuums.
- Build: draft assets and stage actions.
- Inspect: show evidence, contradictions, and history.

**Context Sources**
- Active app window and selected text.
- Open documents and recent edits.
- Calendar proximity and participants.
- Continuum state and active risks.

**Output Shapes**
- Truth cards: commitments, decisions, risks.
- Timelines: sequence of evidence‑anchored events.
- Graphs: relationships, dependencies, drift.
- Executable cards: “stage, approve, execute.”

---

## UI Data Protocol (JSON‑Rendered Reality)

**Drovi Render Schema**
- A typed JSON schema for rendering output objects.
- Supports charts, tables, graphs, timelines, and diff views.
- Enables model‑generated UI with strict validation.
- Every renderable object must reference evidence.

---

## What Drovi Becomes (New Category)

**Drovi becomes the Execution Layer for Organizational Reality.**
It senses reality, maintains truth, runs Continuums, and safely executes across tools. It is not a product you use. It is a system that runs.

---

## New Tech to Invent (Beyond the Current Stack)

1. **Proof‑Carrying Outputs**
- Every statement includes a signed evidence bundle.
- Evidence is immutable, hash‑linked, and queryable.

2. **Causal Drift Engine**
- Detects when commitments and decisions diverge from reality.
- Creates auto‑generated Continuums to resolve drift.

3. **Continuum DSL**
- A language to define goals, constraints, escalation policies, and proof requirements.

4. **Actuator Standard**
- A Drovi‑native driver spec for all tools.
- Enables a capability marketplace and integrations at scale.

5. **Reality Vector Index**
- Temporal embeddings that decay and re‑weight based on evidence freshness.

6. **Mission Marketplace → Continuum Exchange**
- Curated Continuums for renewals, compliance, finance, hiring.

7. **Reality Audit Ledger**
- A tamper‑evident log of all decisions, commitments, and actions.

8. **Adaptive Trust Model**
- Trust grows or shrinks with verification rates and user corrections.

---

## Flagship Continuums (First Category‑Defining Runs)
1. Renewal Guardian Continuum
2. Delivery Integrity Continuum
3. Board Update Continuum
4. Compliance Sentinel Continuum
5. Revenue Drift Continuum

---

## Definition of “Paradigm Achieved”
- A VP can ask a single question and get evidence‑anchored truth in seconds.
- Continuums run without supervision and self‑heal with policy gates.
- Drovi is the default system of record for “what is true.”
- Users stop thinking about apps and start thinking about outcomes.

---

## Next Artifacts To Build
1. Diagram of the Intent Substrate (Reality Fabric → Proof Core → Continuums → Actuators).
2. Jobs‑style keynote script for the category launch.
3. A demo script with 3 Continuums running in real time.
