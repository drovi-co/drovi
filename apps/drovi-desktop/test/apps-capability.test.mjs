import { describe, expect, it, vi } from "vitest";

import { createAppCapabilityRunner } from "../src/capabilities/apps.js";

describe("app capability runner", () => {
  it("launches allowlisted apps", async () => {
    const adapter = {
      launchApp: vi.fn(async (appName) => ({ launched: true, appName })),
      runAutomationScript: vi.fn(async () => ({ ok: true })),
    };
    const runner = createAppCapabilityRunner({
      env: {
        DROVI_DESKTOP_ALLOWED_APPS: "Microsoft Excel,Microsoft PowerPoint",
      },
      adapter,
    });
    const result = await runner.execute("app.launch", {
      appName: "Microsoft Excel",
    });
    expect(result.launched).toBe(true);
    expect(adapter.launchApp).toHaveBeenCalledTimes(1);
  });

  it("rejects non-allowlisted app launch", async () => {
    const adapter = {
      launchApp: vi.fn(async () => ({ launched: true })),
      runAutomationScript: vi.fn(async () => ({ ok: true })),
    };
    const runner = createAppCapabilityRunner({
      env: {
        DROVI_DESKTOP_ALLOWED_APPS: "Microsoft Excel",
      },
      adapter,
    });
    await expect(
      runner.execute("app.launch", { appName: "Terminal; rm -rf /" })
    ).rejects.toMatchObject({
      code: "app_not_allowlisted",
    });
    expect(adapter.launchApp).not.toHaveBeenCalled();
  });

  it("blocks dangerous automation scripts in restricted mode", async () => {
    const adapter = {
      launchApp: vi.fn(async () => ({ launched: true })),
      runAutomationScript: vi.fn(async () => ({ ok: true })),
    };
    const runner = createAppCapabilityRunner({
      env: {
        DROVI_DESKTOP_ALLOWED_APPS: "Microsoft Excel",
        DROVI_DESKTOP_AUTOMATION_MODE: "restricted",
      },
      adapter,
    });
    await expect(
      runner.execute("app.automate", {
        appName: "Microsoft Excel",
        script: "Remove-Item -Recurse C:\\\\ -Force",
      })
    ).rejects.toMatchObject({
      code: "automation_script_blocked",
    });
    expect(adapter.runAutomationScript).not.toHaveBeenCalled();
  });

  it("allows automation scripts when explicitly configured as unsafe mode", async () => {
    const adapter = {
      launchApp: vi.fn(async () => ({ launched: true })),
      runAutomationScript: vi.fn(async (script) => ({ ok: true, script })),
    };
    const runner = createAppCapabilityRunner({
      env: {
        DROVI_DESKTOP_ALLOWED_APPS: "Microsoft Excel",
        DROVI_DESKTOP_AUTOMATION_MODE: "unsafe",
      },
      adapter,
    });
    const result = await runner.execute("app.automate", {
      appName: "Microsoft Excel",
      script: "Remove-Item -Recurse C:\\\\ -Force",
    });
    expect(result.ok).toBe(true);
    expect(adapter.runAutomationScript).toHaveBeenCalledTimes(1);
  });
});
