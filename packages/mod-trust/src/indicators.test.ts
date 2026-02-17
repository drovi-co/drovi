import { describe, expect, it } from "vitest";
import {
  normalizeInvalidAuditEntries,
  resolveTrustConfidenceTier,
  resolveTrustToneClass,
} from "./indicators";

describe("resolveTrustConfidenceTier", () => {
  it("maps confidence values to stable tiers", () => {
    expect(resolveTrustConfidenceTier(0.91)).toBe("high");
    expect(resolveTrustConfidenceTier(0.65)).toBe("medium");
    expect(resolveTrustConfidenceTier(0.12)).toBe("low");
  });
});

describe("resolveTrustToneClass", () => {
  it("returns css class for tier", () => {
    expect(resolveTrustToneClass(0.9)).toContain("emerald");
    expect(resolveTrustToneClass(0.6)).toContain("amber");
    expect(resolveTrustToneClass(0.2)).toContain("red");
  });
});

describe("normalizeInvalidAuditEntries", () => {
  it("returns string entries only", () => {
    expect(normalizeInvalidAuditEntries(["a", 1, "b", null])).toEqual(["a", "b"]);
    expect(normalizeInvalidAuditEntries(null)).toEqual([]);
  });
});
