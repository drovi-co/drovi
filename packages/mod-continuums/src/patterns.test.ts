import { describe, expect, it } from "vitest";
import { groupPatternLibrary } from "./patterns";

describe("mod-continuums pattern grouping", () => {
  it("groups library items by category", () => {
    const grouped = groupPatternLibrary([
      { id: "a", title: "Legal Advice", category: "legal" },
      { id: "b", title: "Audit Trail", category: "legal" },
      { id: "c", title: "Tax Follow-up", category: "accounting" },
    ]);

    expect(grouped.legal?.length).toBe(2);
    expect(grouped.accounting?.length).toBe(1);
  });
});
