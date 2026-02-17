import { describe, expect, it } from "vitest";
import {
  buildPrivateBriefingExport,
  getMandateActionCardById,
  getMandateActionCards,
  getPriorityMandateActionCards,
  MANDATE_ACTION_CARDS,
  resolveMandateActionCard,
} from "./mandate-action-cards";

describe("mandate action cards", () => {
  it("defines at least 20 deterministic intent cards", () => {
    expect(MANDATE_ACTION_CARDS.length).toBeGreaterThanOrEqual(20);
  });

  it("includes required high-value workflow templates", () => {
    expect(getMandateActionCardById("weekly-continuity-briefing")).toBeTruthy();
    expect(
      getMandateActionCardById("unresolved-high-risk-commitments")
    ).toBeTruthy();
    expect(
      getMandateActionCardById("contradictions-by-matter-engagement")
    ).toBeTruthy();
  });

  it("resolves intent queries deterministically", () => {
    expect(
      resolveMandateActionCard("prepare weekly continuity briefing", "pilot_owner")
        ?.id
    ).toBe("weekly-continuity-briefing");
    expect(
      resolveMandateActionCard("show unresolved high risk commitments", "pilot_owner")
        ?.id
    ).toBe("unresolved-high-risk-commitments");
    expect(
      resolveMandateActionCard("find contradictions by matter", "pilot_owner")?.id
    ).toBe("contradictions-by-matter-engagement");
  });

  it("enforces role-gated action cards", () => {
    const memberCards = getMandateActionCards("act", "pilot_member");
    const ownerCards = getMandateActionCards("act", "pilot_owner");
    expect(
      memberCards.some((card) => card.id === "cross-channel-escalations")
    ).toBe(false);
    expect(
      ownerCards.some((card) => card.id === "cross-channel-escalations")
    ).toBe(true);
  });

  it("returns the three priority cards in fixed order", () => {
    const cards = getPriorityMandateActionCards("pilot_owner");
    expect(cards.map((card) => card.id)).toEqual([
      "weekly-continuity-briefing",
      "unresolved-high-risk-commitments",
      "contradictions-by-matter-engagement",
    ]);
  });

  it("builds private briefing export with audit trace and evidence", () => {
    const output = buildPrivateBriefingExport({
      question: "What changed this week?",
      answer: "Three commitments moved to overdue status.",
      templateTitle: "Prepare weekly continuity briefing",
      auditCode: "MBR-001",
      requestId: "req_123",
      sources: [
        {
          title: "Pilot status thread",
          quoted_text: "Deadline slipped due to missing approval.",
          source_timestamp: "2026-02-17T10:00:00Z",
        },
      ],
    });

    expect(output).toContain("Drovi — Private Briefing");
    expect(output).toContain("Audit code: MBR-001");
    expect(output).toContain("Request ID: req_123");
    expect(output).toContain("1. Pilot status thread");
  });
});
