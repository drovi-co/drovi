import { describe, expect, it } from "vitest";
import { defaultAskPresets, resolveAskPreset } from "./presets";

describe("mod-ask presets", () => {
  it("returns preset by id", () => {
    expect(resolveAskPreset(defaultAskPresets, "ask.summary")?.id).toBe(
      "ask.summary"
    );
    expect(resolveAskPreset(defaultAskPresets, "missing")).toBeNull();
  });
});
