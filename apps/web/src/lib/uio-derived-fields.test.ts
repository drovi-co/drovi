import { describe, expect, it } from "vitest";
import {
  inferDueDateFromText,
  resolveContactDisplayName,
  resolveDueDate,
} from "./uio-derived-fields";

function dateParts(value: Date | null | undefined): [number, number, number] | null {
  if (!value) {
    return null;
  }
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()];
}

describe("inferDueDateFromText", () => {
  const now = new Date("2026-02-17T12:00:00.000Z");

  it("infers relative tomorrow", () => {
    const value = inferDueDateFromText("Grafana trial ends tomorrow", now);
    expect(dateParts(value)).toEqual([2026, 2, 18]);
  });

  it("infers explicit month date", () => {
    const value = inferDueDateFromText(
      "The revised proposal will be delivered by Friday Feb 20, 2026"
    );
    expect(dateParts(value)).toEqual([2026, 2, 20]);
  });
});

describe("resolveDueDate", () => {
  it("prefers explicit due date value", () => {
    const value = resolveDueDate({
      explicitDueDate: "2026-03-01T00:00:00.000Z",
      title: "Due tomorrow",
    });
    expect(dateParts(value)).toEqual([2026, 3, 1]);
  });

  it("falls back to title and evidence parsing", () => {
    const value = resolveDueDate({
      explicitDueDate: null,
      title: "You'll need to add payment details before Feb 23, 2026",
      evidenceQuotes: ["Your trial ends on Feb 23, 2026"],
    });
    expect(dateParts(value)).toEqual([2026, 2, 23]);
  });
});

describe("resolveContactDisplayName", () => {
  it("uses display name then email local part then id fallback", () => {
    expect(
      resolveContactDisplayName({
        id: "cnt_12345678",
        displayName: "Jules Garcia",
        primaryEmail: "jules@drovi.co",
      })
    ).toBe("Jules Garcia");

    expect(
      resolveContactDisplayName({
        id: "cnt_12345678",
        displayName: null,
        primaryEmail: "partner@drovi.co",
      })
    ).toBe("partner");

    expect(
      resolveContactDisplayName({
        id: "cnt_12345678",
        displayName: null,
        primaryEmail: null,
      })
    ).toBe("Contact 5678");
  });
});
