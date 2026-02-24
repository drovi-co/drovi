# World Brain Phase 0 Charter

## Status
Accepted

## Date
2026-02-22

## Scope
This charter freezes the Phase 0 baseline for Drovi World Brain so implementation can proceed without architectural ambiguity.

## Product Contract
Drovi World Brain is a live institutional cognition platform that fuses internal and external reality into evidence-backed beliefs, computes impact and contradiction, and drives policy-governed intervention.

## Non-Goals
- Do not build a generic news reader.
- Do not maximize ingestion volume without relevance scoring.
- Do not allow high-stakes outputs without evidence and uncertainty.
- Do not perform uncontrolled side-effecting actions.

## Program Owner Matrix
- Cognitive Core Pod: Head of AI Systems, Applied ML Lead, Knowledge Graph Engineer
- Causal and Normative Pod: Causal ML Lead, Legal Intelligence Lead, Policy Engine Engineer
- World Twin Pod: Platform Architect, Data Model Lead, Product Intelligence Lead
- Platform and SRE Pod: Infrastructure Lead, Stream Platform Lead, SRE Manager
- Trust and Governance Pod: Security Lead, Compliance Lead, Audit and Controls Engineer

## North-Star KPI Suite
- Evidence coverage on high-stakes beliefs
Target: >= 90%
- Contradiction precision
Target: >= 0.85
- Missed-impact rate on tracked exposure
Target: <= 5%
- Event-to-tape latency (p95)
Target: <= 2 seconds
- Intervention rollback success
Target: >= 99%
- Belief calibration error (ECE)
Target: <= 0.05

## Risk Taxonomy
- R1 Data licensing/compliance risk
- R2 Ingestion quality and source poisoning risk
- R3 Entity resolution and impact-mapping errors
- R4 Model hallucination and confidence miscalibration risk
- R5 Unsafe or irreversible intervention risk
- R6 Platform scalability, reliability, and cost blowout risk

## Severity and SLO Policy
- S0 Critical integrity or security incident
Detection <= 5 minutes; containment <= 15 minutes; mitigation <= 4 hours
- S1 High-impact correctness or availability incident
Detection <= 15 minutes; mitigation <= 8 hours
- S2 Degraded quality/latency or partial pipeline outage
Detection <= 60 minutes; mitigation <= 24 hours
- S3 Low-impact defect or backlog issue
Mitigation in planned sprint cycle

## Exit Criteria for Phase 0
- Product contract and non-goals are frozen.
- Owner matrix is assigned.
- KPI suite and targets are defined.
- Risk taxonomy and severity SLO policy are defined.
- ADR-0011 through ADR-0016 are accepted.
