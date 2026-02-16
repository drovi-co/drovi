import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, "packages");

const MODULE_DEPENDENCY_ALLOWLIST = {
  "mod-auth": new Set(["@memorystack/mod-kit"]),
  "mod-onboarding": new Set(["@memorystack/mod-kit"]),
  "mod-sources": new Set(["@memorystack/mod-kit"]),
  "mod-teams": new Set(["@memorystack/mod-kit"]),
  "mod-drive": new Set(["@memorystack/mod-kit"]),
  "mod-evidence": new Set(["@memorystack/mod-kit"]),
  "mod-ask": new Set(["@memorystack/mod-kit"]),
  "mod-console": new Set(["@memorystack/mod-kit"]),
  "mod-continuums": new Set(["@memorystack/mod-kit"]),
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }
    const fullPath = join(directory, entry);
    if (isDirectory(fullPath)) {
      walkFiles(fullPath, files);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseImportSpecifiers(source) {
  const specifiers = [];
  const fromPattern = /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
  const sideEffectPattern = /\bimport\s*["']([^"']+)["']/g;
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  let match = fromPattern.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = fromPattern.exec(source);
  }

  match = sideEffectPattern.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = sideEffectPattern.exec(source);
  }

  match = dynamicPattern.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = dynamicPattern.exec(source);
  }

  return [...new Set(specifiers)];
}

function packageNameFromScopedSpecifier(specifier) {
  if (!specifier.startsWith("@memorystack/")) {
    return null;
  }
  const segments = specifier.split("/");
  if (segments.length < 2) {
    return null;
  }
  return `${segments[0]}/${segments[1]}`;
}

function isDeepScopedImport(specifier) {
  if (!specifier.startsWith("@memorystack/")) {
    return false;
  }
  return specifier.split("/").length > 2;
}

const moduleDirs = Object.keys(MODULE_DEPENDENCY_ALLOWLIST).filter((name) =>
  isDirectory(join(PACKAGES_DIR, name))
);
const violations = [];

for (const moduleDir of moduleDirs) {
  const srcDir = join(PACKAGES_DIR, moduleDir, "src");
  if (!isDirectory(srcDir)) {
    continue;
  }

  const allowlist = MODULE_DEPENDENCY_ALLOWLIST[moduleDir];
  if (!allowlist) {
    violations.push(
      `${moduleDir}: missing dependency allowlist entry in check_module_contracts.mjs`
    );
    continue;
  }

  for (const filePath of walkFiles(srcDir)) {
    const source = readFileSync(filePath, "utf8");
    const imports = parseImportSpecifiers(source);

    for (const specifier of imports) {
      if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
        violations.push(
          `${relative(
            ROOT,
            filePath
          )}: app alias import "${specifier}" is not allowed in module packages`
        );
        continue;
      }

      if (specifier.startsWith("apps/")) {
        violations.push(
          `${relative(
            ROOT,
            filePath
          )}: app import "${specifier}" is not allowed in module packages`
        );
        continue;
      }

      if (specifier.startsWith(".")) {
        const resolvedPath = resolve(filePath, "..", specifier);
        if (resolvedPath.includes(`${join(ROOT, "apps")}/`)) {
          violations.push(
            `${relative(
              ROOT,
              filePath
            )}: relative import "${specifier}" resolves into apps/`
          );
        }
        continue;
      }

      if (isDeepScopedImport(specifier)) {
        violations.push(
          `${relative(
            ROOT,
            filePath
          )}: deep import "${specifier}" is not allowed (use package entrypoint)`
        );
        continue;
      }

      const packageName = packageNameFromScopedSpecifier(specifier);
      if (!packageName) {
        continue;
      }

      if (packageName === `@memorystack/${moduleDir}`) {
        continue;
      }

      if (!allowlist.has(packageName)) {
        violations.push(
          `${relative(
            ROOT,
            filePath
          )}: dependency "${packageName}" is not allowed for ${moduleDir}`
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\nModule contract violations detected:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Module contract checks passed.");
