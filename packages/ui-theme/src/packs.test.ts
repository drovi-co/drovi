import { describe, expect, it } from "vitest";
import { getThemePack, themePacks } from "./packs";

describe("theme packs", () => {
  it("returns known pack by id", () => {
    const pack = getThemePack("legal");
    expect(pack.id).toBe("legal");
    expect(pack.light["--primary"]).toBeTypeOf("string");
  });

  it("falls back to default for unknown id", () => {
    const pack = getThemePack("unknown");
    expect(pack.id).toBe("default");
  });

  it("exposes all required vertical packs", () => {
    expect(Object.keys(themePacks)).toEqual(
      expect.arrayContaining([
        "default",
        "legal",
        "accounting",
        "gov",
        "construction",
      ])
    );
  });
});
