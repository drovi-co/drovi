import { describe, expect, it } from "vitest";
import { buildProofSummary, proofSupersessionToken } from "./proof-summary";

describe("proofSupersessionToken", () => {
  it("maps states to compact codes", () => {
    expect(proofSupersessionToken("active")).toEqual({
      code: "S•",
      label: "Active",
    });
    expect(proofSupersessionToken("superseded")).toEqual({
      code: "S↓",
      label: "Superseded",
    });
  });
});

describe("buildProofSummary", () => {
  it("builds compact evidence, verified and supersession tokens", () => {
    const summary = buildProofSummary({
      evidenceCount: 3,
      lastVerifiedAt: "2026-02-16T08:00:00.000Z",
      confidence: 0.84,
      supersessionState: "superseding",
    });

    expect(summary.evidenceCode).toBe("E3");
    expect(summary.confidenceCode).toBe("C84");
    expect(summary.verifiedCode).toContain("V");
    expect(summary.supersessionCode).toBe("S↑");
  });

  it("falls back safely when values are missing", () => {
    const summary = buildProofSummary({});
    expect(summary.evidenceCode).toBe("E0");
    expect(summary.confidenceCode).toBe("C --");
    expect(summary.verifiedCode).toBe("V --");
    expect(summary.supersessionCode).toBe("S•");
  });
});
