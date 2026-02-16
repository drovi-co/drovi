import { describe, expect, it } from "vitest";
import { canOpenEvidenceSource, resolveEvidenceQuote } from "./access";

describe("mod-evidence access", () => {
  it("redacts quotes when policy requires redaction", () => {
    expect(
      resolveEvidenceQuote("Sensitive line", {
        redactQuotedText: true,
        allowExternalLinks: false,
      })
    ).toBe("[REDACTED]");
  });

  it("enforces source link policy", () => {
    expect(
      canOpenEvidenceSource({
        redactQuotedText: false,
        allowExternalLinks: false,
      })
    ).toBe(false);
  });
});
