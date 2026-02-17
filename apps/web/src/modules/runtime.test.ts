import { describe, expect, it } from "vitest";
import {
  getWebAllowedConnectorIds,
  getWebOnboardingSteps,
  resolveWebModules,
} from "./runtime";

describe("web module runtime resolution", () => {
  it("resolves default modules", () => {
    const modules = resolveWebModules();
    expect(modules.map((module) => module.id)).toEqual(
      expect.arrayContaining([
        "mod-core-shell",
        "mod-auth",
        "mod-onboarding",
        "mod-sources",
        "mod-drive",
        "mod-teams",
        "mod-trust",
        "mod-agents",
      ])
    );
  });

  it("applies manifest module gates", () => {
    const modules = resolveWebModules({
      manifestGates: {
        "mod-drive": { enabled: false },
      },
    });
    expect(modules.find((module) => module.id === "mod-drive")).toBeUndefined();
  });

  it("applies module app overrides for nav labels", () => {
    const modules = resolveWebModules({
      appOverrides: {
        "mod-drive": {
          nav: {
            "drive.nav": {
              label: "Matter Vault",
            },
          },
        },
        "mod-sources": {
          uiHints: {
            allowedConnectors: ["gmail", "slack"],
          },
        },
      },
    });

    const drive = modules.find((module) => module.id === "mod-drive");
    expect(drive?.navItems.find((item) => item.id === "drive.nav")?.label).toBe(
      "Matter Vault"
    );
    expect(getWebAllowedConnectorIds(modules)).toEqual(["gmail", "slack"]);
  });

  it("maps onboarding step ids to concrete routes", () => {
    const modules = resolveWebModules();
    const steps = getWebOnboardingSteps(modules);
    expect(steps.find((step) => step.id === "create_org")?.route).toBe(
      "/onboarding/create-org"
    );
    expect(steps.find((step) => step.id === "connect_sources")?.route).toBe(
      "/onboarding/connect-sources"
    );
  });
});
