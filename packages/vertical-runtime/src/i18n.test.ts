import type { ResolvedDroviModule } from "@memorystack/mod-kit";
import { describe, expect, it } from "vitest";
import { buildModuleI18nCatalog, i18nOverridesFromManifest } from "./i18n";
import type { PluginManifest } from "./types";

describe("vertical-runtime i18n helpers", () => {
  it("extracts i18n overrides from manifest", () => {
    const manifest: PluginManifest = {
      plugins: ["core"],
      uio_types: [],
      extension_types: [],
      capabilities: {},
      ui_hints: {},
      storage_rules: {
        canonical_spine_table: "unified_intelligence_object",
        extension_payload_table: "uio_extension_payload",
        typed_tables: {},
      },
      i18n_overrides: {
        "mod.auth": {
          "auth.signInTitle": "Sign in (Legal)",
        },
      },
    };

    expect(i18nOverridesFromManifest(manifest)).toEqual({
      "mod.auth": {
        "auth.signInTitle": "Sign in (Legal)",
      },
    });
  });

  it("builds catalog from module defaults and applies overrides", () => {
    const modules: ResolvedDroviModule[] = [
      {
        id: "mod-auth",
        title: "Authentication",
        capabilities: ["auth.sign_in"],
        routes: [],
        navItems: [],
        commands: [],
        i18n: {
          namespaces: [
            {
              namespace: "mod.auth",
              defaultLocale: "en",
              messages: {
                "auth.signInTitle": "Sign in",
                "auth.signInDescription": "Welcome back",
              },
            },
          ],
        },
        uiHints: {},
      },
    ];
    const catalog = buildModuleI18nCatalog(modules, {
      "mod.auth": {
        "auth.signInTitle": "Sign in (Accounting)",
      },
    });

    expect(catalog["mod.auth"]?.["auth.signInTitle"]).toBe(
      "Sign in (Accounting)"
    );
    expect(catalog["mod.auth"]?.["auth.signInDescription"]).toBeTypeOf(
      "string"
    );
  });
});
