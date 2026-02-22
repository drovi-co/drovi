import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

const REQUIRED_FILES = [
  "apps/web/src/routes/dashboard/detail-route-mutations.test.tsx",
  "apps/admin/src/routes/login.smoke.test.ts",
  "apps/landing/src/app/page.smoke.test.tsx",
  "packages/api-client/src/web/endpoint-contract-drift.test.ts",
];

const MINIMUM_ROUTE_TESTS = [
  { directory: "apps/web/src/routes", min: 1 },
  { directory: "apps/admin/src/routes", min: 1 },
  { directory: "apps/landing/src/app", min: 1 },
];

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function countRouteTests(directory) {
  const absolute = join(ROOT, directory);
  if (!isDirectory(absolute)) {
    return 0;
  }

  let count = 0;
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
        continue;
      }
      const fullPath = join(current, entry);
      if (isDirectory(fullPath)) {
        stack.push(fullPath);
        continue;
      }
      if (TEST_FILE_PATTERN.test(entry)) {
        count += 1;
      }
    }
  }

  return count;
}

const failures = [];

for (const relativePath of REQUIRED_FILES) {
  if (!existsSync(join(ROOT, relativePath))) {
    failures.push(`missing required regression/smoke test file: ${relativePath}`);
  }
}

for (const target of MINIMUM_ROUTE_TESTS) {
  const count = countRouteTests(target.directory);
  if (count < target.min) {
    failures.push(
      `insufficient route-level tests in ${target.directory}: expected >= ${target.min}, found ${count}`
    );
  }
}

if (failures.length > 0) {
  console.error("Route test presence checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Route test presence checks passed.");
