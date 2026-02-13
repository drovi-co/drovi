import { describe, expect, it } from "vitest";
import { moduleGatesFromManifest } from "./manifest-client";
import type { PluginManifest } from "./types";

describe("moduleGatesFromManifest", () => {
  it("parses valid module gates from ui_hints.modules", () => {
    const manifest: PluginManifest = {
      plugins: ["core"],
      uio_types: [],
      extension_types: [],
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
      storage_rules: {
        canonical_spine_table: "unified_intelligence_object",
        extension_payload_table: "uio_extension_payload",
        typed_tables: {},
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
      extension_types: [],
      capabilities: {},
      ui_hints: {},
      storage_rules: {
        canonical_spine_table: "unified_intelligence_object",
        extension_payload_table: "uio_extension_payload",
        typed_tables: {},
      },
    };
    expect(moduleGatesFromManifest(noModules)).toEqual({});

    const malformed: PluginManifest = {
      plugins: [],
      uio_types: [],
      extension_types: [],
      capabilities: {},
      ui_hints: { modules: "invalid" },
      storage_rules: {
        canonical_spine_table: "unified_intelligence_object",
        extension_payload_table: "uio_extension_payload",
        typed_tables: {},
      },
    };
    expect(moduleGatesFromManifest(malformed)).toEqual({});
  });
});
