import { baseResources } from "@memorystack/i18n";
import { describe, expect, test } from "vitest";

const criticalFlowKeys = [
  "nav.items.realityStream",
  "nav.items.connectedSources",
  "nav.items.trustAudit",
  "nav.items.commitments",
  "nav.items.decisions",
  "nav.items.tasks",
  "pages.dashboard.realityStream.kicker",
  "pages.dashboard.trust.kicker",
  "pages.dashboard.exchange.kicker",
  "intentBar.commands.goReality.title",
  "intentBar.commands.goSources.title",
  "intentBar.commands.goTrust.title",
  "intentBar.commands.goExchange.title",
] as const;

const deprecatedPatterns = [
  /\breality stream\b/i,
  /\bconnected sources\b/i,
  /\btrust\s*&\s*audit\b/i,
  /\bagent catalog\b/i,
  /\bactuations?\b/i,
];

function getValueAtPath(source: unknown, path: string): unknown {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

describe("institutional UI smoke", () => {
  test("critical flow labels exist in EN and FR", () => {
    const missing: string[] = [];

    for (const keyPath of criticalFlowKeys) {
      const enValue = getValueAtPath(baseResources.en, keyPath);
      const frValue = getValueAtPath(baseResources.fr, keyPath);

      if (typeof enValue !== "string" || enValue.length === 0) {
        missing.push(`en.${keyPath}`);
      }
      if (typeof frValue !== "string" || frValue.length === 0) {
        missing.push(`fr.${keyPath}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("critical flow labels avoid deprecated terminology", () => {
    const violations: string[] = [];

    for (const locale of ["en", "fr"] as const) {
      for (const keyPath of criticalFlowKeys) {
        const value = getValueAtPath(baseResources[locale], keyPath);
        if (typeof value !== "string") {
          continue;
        }
        for (const pattern of deprecatedPatterns) {
          if (pattern.test(value)) {
            violations.push(`${locale}.${keyPath} => ${value}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
