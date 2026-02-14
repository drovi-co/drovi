import { describe, expect, it } from "vitest";
import { resolveRoleLabel } from "./roles";

describe("mod-teams role labels", () => {
  it("resolves known roles and keeps unknown role as-is", () => {
    expect(resolveRoleLabel("owner")).toBe("Owner");
    expect(resolveRoleLabel("legal_partner")).toBe("legal_partner");
  });
});
