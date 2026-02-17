import { baseResources } from "@memorystack/i18n";
import { describe, expect, test } from "vitest";

const bannedPatterns = [
  /\bdisrupt(?:ive|ion)?\b/i,
  /\brevolution(?:ary|ize|izing)?\b/i,
  /\bgame[\s-]?chang(?:e|ing)\b/i,
  /\bai[\s-]?powered\b/i,
  /\bnext[\s-]?gen\b/i,
  /\bsupercharge\b/i,
  /\bunlock\b/i,
];

const deprecatedUiPatterns = [
  /\breality stream\b/i,
  /\bconnected sources\b/i,
  /\btrust\s*&\s*audit\b/i,
  /\bagent catalog\b/i,
  /\bagent studio\b/i,
  /\bagent inbox\b/i,
  /\bactuations?\b/i,
  /\bsmart drive\b/i,
  /\bai confidence\b/i,
];

const expectedEnNavLabels: Record<string, string> = {
  "nav.items.realityStream": "Record Feed",
  "nav.items.commitments": "Commitment Register",
  "nav.items.decisions": "Decision Ledger",
  "nav.items.tasks": "Task Register",
  "nav.items.connectedSources": "Custody Connectors",
  "nav.items.trustAudit": "Integrity Office",
};

function flattenStringEntries(
  node: unknown,
  prefix = ""
): Array<[string, string]> {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return [];
  }

  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      entries.push([next, value]);
      continue;
    }

    entries.push(...flattenStringEntries(value, next));
  }

  return entries;
}

function getValueAtPath(source: unknown, path: string): unknown {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

describe("institutional copy policy", () => {
  test("locales do not contain banned language", () => {
    const matches: string[] = [];

    for (const [locale, values] of Object.entries(baseResources)) {
      for (const [keyPath, value] of flattenStringEntries(values)) {
        for (const pattern of bannedPatterns) {
          if (pattern.test(value)) {
            matches.push(`${locale}.${keyPath} => ${value}`);
          }
        }
      }
    }

    expect(matches).toEqual([]);
  });

  test("locales do not contain deprecated UI terminology", () => {
    const matches: string[] = [];

    for (const [locale, values] of Object.entries(baseResources)) {
      for (const [keyPath, value] of flattenStringEntries(values)) {
        for (const pattern of deprecatedUiPatterns) {
          if (pattern.test(value)) {
            matches.push(`${locale}.${keyPath} => ${value}`);
          }
        }
      }
    }

    expect(matches).toEqual([]);
  });

  test("english nav labels use institutional terminology", () => {
    const mismatches: string[] = [];

    for (const [keyPath, expected] of Object.entries(expectedEnNavLabels)) {
      const actual = getValueAtPath(baseResources.en, keyPath);
      if (actual !== expected) {
        mismatches.push(`${keyPath}: expected "${expected}", got "${String(actual)}"`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
