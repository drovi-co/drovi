## Phase 11: Pilot Features for Legal + Accounting (Killer Features)

### 11.1 Legal data model: Matters + Advice objects
- [ ] Add `matter` model:
  - [ ] client
  - [ ] matter id/name
  - [ ] members/roles
  - [ ] tags
- [ ] Add `advice` UIO type with:
  - [ ] exact wording
  - [ ] author identity
  - [ ] validFrom/validTo
  - [ ] evidence spans

### 11.2 Legal Feature #1: Advice Timeline (“Git history for advice”)
- [ ] Timeline UI by matter:
  - [ ] chronological advice entries
  - [ ] supersession chain with diffs
  - [ ] evidence lens always available

### 11.3 Legal Feature #2: Contradiction & Drift Detection
- [ ] Contradiction detection:
  - [ ] against prior advice (semantic + structured constraints)
  - [ ] across lawyers/threads
- [ ] Drift detection:
  - [ ] advice changed without explicit notice
  - [ ] outgoing drafts conflict with current stance

### 11.4 Legal Feature #3: Show Me Where We Said That
- [ ] One-click “show evidence” for any claim/advice:
  - [ ] email quote
  - [ ] doc highlight
  - [ ] transcript timestamp

### 11.5 Legal Feature #4: Risk-Weighted Matters
- [ ] Matter risk score model:
  - [ ] contradictions unresolved
  - [ ] deadlines approaching/missed
  - [ ] missing confirmations
  - [ ] long silences
  - [ ] outstanding commitments
- [ ] Risk dashboard for partners (sorted by risk).

### 11.6 Legal Feature #5: Proof-First AI
- [ ] Evidence-first Q&A and brief generation for matters:
  - [ ] citations mandatory
  - [ ] refusal on insufficient evidence
  - [ ] confidence reasoning

### 11.7 Accounting pilot features (parallel)
- [ ] Define accounting “Engagement” model (or reuse matters).
- [ ] Build 5 accounting killer surfaces:
  - [ ] engagement timeline
  - [ ] PBC requests ledger (client-provided items)
  - [ ] deadline drift detection
  - [ ] variance explanation memory
  - [ ] proof-first audit trail exports

**Acceptance**
- A partner can open a matter and immediately see: advice history, what changed, what is risky, and where the evidence is.

---

## Phase 12: Drovi Draft (Proof-Integrated Drafting)

### 12.1 Draft editor foundation
- [ ] Add a drafting surface (doc editor) that:
  - [ ] supports rich text
  - [ ] supports inserting citations from evidence search
  - [ ] stores drafts as versioned artifacts (and evidence)

### 12.2 “Verify” mode (coverage + contradictions)
- [ ] Coverage analysis:
  - [ ] identify key claims
  - [ ] ensure citations exist for high-stakes claims
- [ ] Contradiction scan:
  - [ ] compare to matter advice history and commitments
  - [ ] produce fix suggestions and required acknowledgements

### 12.3 Export + share
- [ ] Export to DOCX/PDF.
- [ ] Store exported doc as evidence linked to the matter.
- [ ] Send via email (with citations link back to Drovi).

**Acceptance**
- Demo: draft a memo -> verify -> it flags a contradiction -> fix -> export -> stored and appears in the matter timeline.

---