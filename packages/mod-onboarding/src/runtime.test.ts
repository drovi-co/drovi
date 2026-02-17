import { describe, expect, it } from "vitest";
import { resolveOnboardingRoute, resolveOnboardingState } from "./runtime";

describe("resolveOnboardingState", () => {
  it("marks onboarding pending when stored complete no longer matches org state", () => {
    expect(
      resolveOnboardingState({
        storedState: "complete",
        inferredComplete: false,
      })
    ).toEqual({
      state: "pending",
      shouldPersist: true,
    });
  });

  it("persists inferred completion when no stored state exists", () => {
    expect(
      resolveOnboardingState({
        storedState: null,
        inferredComplete: true,
      })
    ).toEqual({
      state: "complete",
      shouldPersist: true,
    });
  });

  it("keeps stored pending state when still valid", () => {
    expect(
      resolveOnboardingState({
        storedState: "pending",
        inferredComplete: false,
      })
    ).toEqual({
      state: "pending",
      shouldPersist: false,
    });
  });
});

describe("resolveOnboardingRoute", () => {
  it("returns the first actionable step route", () => {
    const route = resolveOnboardingRoute({
      capabilities: {
        "org.create": true,
      },
      steps: [
        {
          id: "create_org",
          requiredCapabilities: ["org.create"],
          route: "/onboarding/create-org",
        },
        {
          id: "complete",
          requiredCapabilities: [],
          route: "/onboarding/complete",
        },
      ],
    });
    expect(route).toBe("/onboarding/create-org");
  });

  it("falls back to complete route when no actionable step is available", () => {
    const route = resolveOnboardingRoute({
      capabilities: {
        "org.create": false,
      },
      steps: [
        {
          id: "create_org",
          requiredCapabilities: ["org.create"],
          route: "/onboarding/create-org",
        },
      ],
      completeRoute: "/onboarding/complete",
    });
    expect(route).toBe("/onboarding/complete");
  });
});
