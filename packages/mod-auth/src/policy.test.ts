import { describe, expect, it } from "vitest";
import {
  defaultAuthModulePolicy,
  isAuthActionAllowed,
  resolvePostLoginRedirect,
} from "./policy";

describe("mod-auth policy", () => {
  it("blocks sign up when policy disables it", () => {
    const policy = { ...defaultAuthModulePolicy(), allowSignUp: false };
    expect(
      isAuthActionAllowed(policy, {
        action: "sign_up",
        email: "user@drovi.co",
      })
    ).toBe(false);
  });

  it("enforces email domain gate", () => {
    const policy = {
      ...defaultAuthModulePolicy(),
      allowedEmailDomain: "drovi.co",
    };
    expect(
      isAuthActionAllowed(policy, {
        action: "sign_in",
        email: "person@drovi.co",
      })
    ).toBe(true);
    expect(
      isAuthActionAllowed(policy, {
        action: "sign_in",
        email: "person@example.com",
      })
    ).toBe(false);
  });

  it("returns fallback when post-login redirect is invalid", () => {
    const policy = {
      ...defaultAuthModulePolicy(),
      postLoginRedirect: "dashboard",
    };
    expect(resolvePostLoginRedirect(policy)).toBe("/dashboard");
  });
});
