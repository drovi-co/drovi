import { describe, expect, it } from "vitest";
import { resolveAuthView } from "./view";

describe("resolveAuthView", () => {
  it("defaults to sign-in", () => {
    expect(resolveAuthView()).toBe("sign-in");
  });

  it("switches to sign-up when invite token is present", () => {
    expect(resolveAuthView({ search: "?invite=abc123" })).toBe("sign-up");
  });

  it("switches to sign-up when mode is sign-up", () => {
    expect(resolveAuthView({ search: "?mode=sign-up" })).toBe("sign-up");
  });

  it("uses provided default view when no sign-up hint exists", () => {
    expect(
      resolveAuthView({
        search: "?mode=sign-in",
        defaultView: "sign-up",
      })
    ).toBe("sign-up");
  });
});
