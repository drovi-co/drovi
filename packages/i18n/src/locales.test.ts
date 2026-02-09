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

describe("i18n locales", () => {
  test("en and fr contain the same translation keys", () => {
    const enKeys = new Set(flattenKeys(baseResources.en));
    const frKeys = new Set(flattenKeys(baseResources.fr));

    const missingInFr = [...enKeys].filter((k) => !frKeys.has(k)).sort();
    const missingInEn = [...frKeys].filter((k) => !enKeys.has(k)).sort();

    expect(missingInFr).toEqual([]);
    expect(missingInEn).toEqual([]);
  });
});

