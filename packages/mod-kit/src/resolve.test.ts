import { describe, expect, it } from "vitest";
import { resolveModules } from "./resolve";
import type { DroviModule } from "./types";

const BASE_MODULE: DroviModule = {
  id: "mod-drive",
  title: "Drive",
  capabilities: ["drive.read", "drive.write"],
  routes: [
    { id: "drive.list", path: "/drive", slot: "dashboard" },
    { id: "drive.detail", path: "/drive/$id", slot: "dashboard" },
  ],
  navItems: [
    {
      id: "drive.nav",
      label: "Drive",
      to: "/drive",
      requiresCapability: "drive.read",
    },
  ],
  commands: [
    {
      id: "drive.upload",
      title: "Upload document",
      action: "drive.upload",
      requiresCapability: "drive.write",
    },
  ],
  staticOverride: {
    nav: {
      "drive.nav": {
        label: "Documents",
      },
    },
  },
};

describe("resolveModules", () => {
  it("applies app overrides and manifest gates with deterministic precedence", () => {
    const resolved = resolveModules({
      modules: [BASE_MODULE],
      appOverrides: {
        "mod-drive": {
          nav: {
            "drive.nav": {
              label: "Document Drive",
            },
          },
          commands: {
            "drive.upload": {
              title: "Upload file",
            },
          },
        },
      },
      manifestGates: {
        "mod-drive": {
          disabledRoutes: ["drive.detail"],
        },
      },
    });

    expect(resolved).toHaveLength(1);
    const [drive] = resolved;
    expect(drive?.routes.map((route) => route.id)).toEqual(["drive.list"]);
    expect(drive?.navItems[0]?.label).toBe("Document Drive");
    expect(drive?.commands[0]?.title).toBe("Upload file");
  });

  it("filters capability-gated items when capability is disabled globally or by gate", () => {
    const [disabledGlobal] = resolveModules({
      modules: [BASE_MODULE],
      enabledCapabilities: {
        "drive.write": false,
      },
    });
    expect(disabledGlobal?.commands).toHaveLength(0);

    const [disabledByGate] = resolveModules({
      modules: [BASE_MODULE],
      manifestGates: {
        "mod-drive": {
          capabilities: {
            "drive.read": false,
          },
        },
      },
    });
    expect(disabledByGate?.navItems).toHaveLength(0);
  });

  it("disables entire module when gate marks it disabled", () => {
    const resolved = resolveModules({
      modules: [BASE_MODULE],
      manifestGates: {
        "mod-drive": {
          enabled: false,
        },
      },
    });
    expect(resolved).toHaveLength(0);
  });
});
