import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function defaultRoots() {
  return [
    path.join(os.homedir(), "Documents"),
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "Desktop"),
  ];
}

function normalizeAllowedRoots(rawRoots) {
  const values = rawRoots && rawRoots.length > 0 ? rawRoots : defaultRoots();
  return values.map((item) => path.resolve(item));
}

function ensurePathAllowed(filePath, allowedRoots) {
  const resolved = path.resolve(filePath);
  const allowed = allowedRoots.some((root) => {
    const normalizedRoot = root.endsWith(path.sep)
      ? root
      : `${root}${path.sep}`;
    return resolved === root || resolved.startsWith(normalizedRoot);
  });
  if (!allowed) {
    const error = new Error("Requested path is outside of allowed roots.");
    error.code = "path_not_allowed";
    throw error;
  }
  return resolved;
}

export function createFsCapabilityRunner({ env = process.env } = {}) {
  const configuredRoots = String(env.DROVI_DESKTOP_ALLOWED_ROOTS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowedRoots = normalizeAllowedRoots(configuredRoots);

  return {
    allowedRoots,
    async execute(capability, payload) {
      const action = String(capability || "");
      const targetPath = ensurePathAllowed(
        String(payload?.path || ""),
        allowedRoots
      );

      if (action === "fs.read") {
        const encoding = String(payload?.encoding || "utf8");
        const content = await fs.readFile(targetPath, { encoding });
        return { path: targetPath, content };
      }
      if (action === "fs.write") {
        const content = String(payload?.content ?? "");
        const encoding = String(payload?.encoding || "utf8");
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content, { encoding });
        return {
          path: targetPath,
          bytesWritten: Buffer.byteLength(content, encoding),
        };
      }
      if (action === "fs.list") {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        return {
          path: targetPath,
          entries: entries.map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
          })),
        };
      }
      if (action === "fs.delete") {
        await fs.rm(targetPath, { force: true, recursive: true });
        return { path: targetPath, deleted: true };
      }
      throw new Error(`Unsupported FS capability: ${action}`);
    },
  };
}
