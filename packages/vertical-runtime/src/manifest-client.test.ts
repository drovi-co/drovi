import { describe, expect, it } from "vitest";
import { moduleGatesFromManifest } from "./manifest-client";
import type { PluginManifest } from "./types";

describe("moduleGatesFromManifest", () => {
  it("parses valid module gates from ui_hints.modules", () => {
    const manifest: PluginManifest = {
      plugins: ["core"],
      uio_types: [],
      capabilities: {},
      ui_hints: {
        modules: {
          "mod-drive": {
            enabled: true,
            capabilities: {
              "drive.write": false,
            },
            disabledRoutes: ["drive.detail"],
            disabledNavItems: ["drive.nav.admin"],
            disabledCommands: ["drive.upload"],
          },
        },
      },
    };

    const gates = moduleGatesFromManifest(manifest);
    expect(gates["mod-drive"]?.enabled).toBe(true);
    expect(gates["mod-drive"]?.capabilities?.["drive.write"]).toBe(false);
    expect(gates["mod-drive"]?.disabledRoutes).toEqual(["drive.detail"]);
  });

  it("returns empty map when ui_hints.modules is absent or malformed", () => {
    const noModules: PluginManifest = {
      plugins: [],
      uio_types: [],
      capabilities: {},
      ui_hints: {},
    };
    expect(moduleGatesFromManifest(noModules)).toEqual({});

    const malformed: PluginManifest = {
      plugins: [],
      uio_types: [],
      capabilities: {},
      ui_hints: { modules: "invalid" },
    };
    expect(moduleGatesFromManifest(malformed)).toEqual({});
  });
});
