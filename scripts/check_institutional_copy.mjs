import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const localeFiles = [
  path.join(repoRoot, "packages/i18n/src/locales/en.json"),
  path.join(repoRoot, "packages/i18n/src/locales/fr.json"),
];

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

const requiredEnNav = {
  "nav.items.realityStream": "Record Feed",
  "nav.items.commitments": "Commitment Register",
  "nav.items.decisions": "Decision Ledger",
  "nav.items.tasks": "Task Register",
  "nav.items.connectedSources": "Custody Connectors",
  "nav.items.trustAudit": "Integrity Office",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getValueAtPath(source, keyPath) {
  return keyPath.split(".").reduce((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return value[key];
    }
    return undefined;
  }, source);
}

function walkStrings(node, prefix = "") {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return [];
  }

  const output = [];
  for (const [key, value] of Object.entries(node)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      output.push([currentPath, value]);
      continue;
    }

    output.push(...walkStrings(value, currentPath));
  }
  return output;
}

const failures = [];

for (const filePath of localeFiles) {
  const locale = path.basename(filePath, ".json");
  const doc = readJson(filePath);

  for (const [keyPath, value] of walkStrings(doc)) {
    for (const pattern of bannedPatterns) {
      if (pattern.test(value)) {
        failures.push(
          `[${locale}] banned language at ${keyPath}: "${value}" (pattern: ${pattern})`
        );
      }
    }
    for (const pattern of deprecatedUiPatterns) {
      if (pattern.test(value)) {
        failures.push(
          `[${locale}] deprecated UI wording at ${keyPath}: "${value}" (pattern: ${pattern})`
        );
      }
    }
  }
}

const en = readJson(localeFiles[0]);
for (const [keyPath, expectedValue] of Object.entries(requiredEnNav)) {
  const actualValue = getValueAtPath(en, keyPath);
  if (actualValue !== expectedValue) {
    failures.push(
      `[en] institutional nav mismatch at ${keyPath}: expected "${expectedValue}", got "${actualValue}"`
    );
  }
}

if (failures.length > 0) {
  console.error("Institutional copy checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Institutional copy checks passed.");
