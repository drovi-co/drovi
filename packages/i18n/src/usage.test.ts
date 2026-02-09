import fs from "node:fs";
import path from "node:path";

import { baseResources } from "@memorystack/i18n";

function flattenKeys(node: unknown, prefix = ""): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out.push(next);
      continue;
    }
    out.push(...flattenKeys(value, next));
  }
  return out;
}

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

function extractLiteralTKeys(source: string): string[] {
  // Only capture literal keys like t("auth.signInTitle") or t('nav.items.console').
  // Ignore template strings and dynamic keys.
  const regex = /\bt\(\s*["']([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["']/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source)) !== null) {
    if (match[1]) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function extractKeyPropertyValues(source: string): string[] {
  // Capture common patterns like { labelKey: "pages.dashboard.console.groupBy.none" }
  // so dynamic t(key) usage is still verified.
  const regex =
    /\b(?:labelKey|titleKey|descriptionKey|placeholderKey|emptyKey|kickerKey)\s*:\s*["']([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)["']/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(source)) !== null) {
    if (match[1]) {
      keys.push(match[1]);
    }
  }
  return keys;
}

describe("i18n usage", () => {
  test("all literal t(\"...\") keys used in web/admin exist in baseResources", () => {
    const available = new Set(flattenKeys(baseResources.en));
    const repoRoot = path.resolve(__dirname, "../../..");

    const scanDirs = [
      path.join(repoRoot, "apps/web/src"),
      path.join(repoRoot, "apps/admin/src"),
    ];

    const usedKeys = new Set<string>();
    for (const dir of scanDirs) {
      for (const filePath of walkFiles(dir)) {
        const content = fs.readFileSync(filePath, "utf8");
        for (const key of extractLiteralTKeys(content)) {
          usedKeys.add(key);
        }
        for (const key of extractKeyPropertyValues(content)) {
          usedKeys.add(key);
        }
      }
    }

    const missing = [...usedKeys].filter((k) => !available.has(k)).sort();
    expect(missing).toEqual([]);
  });
});
