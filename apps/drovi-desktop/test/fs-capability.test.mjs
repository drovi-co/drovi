import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createFsCapabilityRunner } from "../src/capabilities/fs.js";

describe("fs capability runner", () => {
  it("reads and writes within allowlisted roots", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "drovi-desktop-fs-")
    );
    const runner = createFsCapabilityRunner({
      env: {
        DROVI_DESKTOP_ALLOWED_ROOTS: tempRoot,
      },
    });
    const target = path.join(tempRoot, "notes", "hello.txt");
    await runner.execute("fs.write", {
      path: target,
      content: "hello desktop",
    });
    const readResult = await runner.execute("fs.read", { path: target });
    expect(readResult.content).toBe("hello desktop");
  });

  it("blocks traversal outside allowlisted roots", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "drovi-desktop-fs-")
    );
    const runner = createFsCapabilityRunner({
      env: {
        DROVI_DESKTOP_ALLOWED_ROOTS: tempRoot,
      },
    });
    const outsidePath = path.join(tempRoot, "..", "outside.txt");
    await expect(
      runner.execute("fs.read", { path: outsidePath })
    ).rejects.toMatchObject({
      code: "path_not_allowed",
    });
  });
});
