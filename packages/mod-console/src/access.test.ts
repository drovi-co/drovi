import { describe, expect, it } from "vitest";
import { canUseConsoleModule } from "./access";

describe("mod-console access", () => {
  it("respects internal capability", () => {
    expect(canUseConsoleModule({ "ops.internal": true })).toBe(true);
    expect(canUseConsoleModule({ "ops.internal": false })).toBe(false);
  });
});
