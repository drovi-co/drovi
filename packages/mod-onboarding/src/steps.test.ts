import { describe, expect, it } from "vitest";
import {
  defaultOnboardingSteps,
  resolveAvailableOnboardingSteps,
} from "./steps";

describe("mod-onboarding steps", () => {
  it("filters steps by capability", () => {
    const steps = resolveAvailableOnboardingSteps(defaultOnboardingSteps, {
      "org.create": true,
      "team.invite": false,
      "sources.connect": true,
    });

    expect(steps.map((step) => step.id)).toEqual([
      "create_org",
      "connect_sources",
      "complete",
    ]);
  });
});
