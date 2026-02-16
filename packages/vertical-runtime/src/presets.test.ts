import { describe, expect, it } from "vitest";
import { getVerticalPreset, listVerticalPresets } from "./presets";

describe("vertical presets", () => {
  it("returns legal preset with module set and overrides", () => {
    const legal = getVerticalPreset("legal");
    expect(legal.moduleIds).toContain("mod-drive");
    expect(
      legal.appOverrides["mod-drive"]?.typeOverrides?.["legal.matter"]
    ).toBeDefined();
  });

  it("exposes four vertical presets", () => {
    const presets = listVerticalPresets();
    expect(presets.map((preset) => preset.id).sort()).toEqual([
      "accounting",
      "construction",
      "gov",
      "legal",
    ]);
  });
});
