import { describe, expect, it } from "vitest";
import { createTrustModule } from "./module";

describe("createTrustModule", () => {
  it("registers trust route, nav and commands", () => {
    const module = createTrustModule();
    expect(module.id).toBe("mod-trust");
    expect(module.routes?.map((route) => route.path)).toEqual([
      "/dashboard/trust",
    ]);
    expect(module.navItems?.map((item) => item.id)).toEqual(["core.trust"]);
    expect(module.commands?.map((command) => command.id)).toEqual([
      "trust.verify_ledger",
    ]);
  });
});
