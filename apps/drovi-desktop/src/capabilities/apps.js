import process from "node:process";

import { createMacOsAdapter } from "./adapters/macos.js";
import { createWindowsAdapter } from "./adapters/windows.js";

function readAllowList(env = process.env) {
  return String(
    env.DROVI_DESKTOP_ALLOWED_APPS ||
      "Microsoft Excel,Microsoft PowerPoint,Numbers,Keynote"
  )
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isUnsafeAutomationScript(script, env = process.env) {
  const mode = String(env.DROVI_DESKTOP_AUTOMATION_MODE || "restricted")
    .trim()
    .toLowerCase();
  if (mode === "unsafe") {
    return false;
  }
  const blockedPatterns = [
    /\brm\s+-rf\b/i,
    /\bremove-item\b/i,
    /\bdel\s+\/f\b/i,
    /\bformat-volume\b/i,
    /\bshutdown\b/i,
    /\brestart-computer\b/i,
    /\bset-executionpolicy\b/i,
    /\bstart-process\b.+\bpowershell\b/i,
    /\bcurl\b.+\|\s*(sh|bash|zsh)\b/i,
    /\binvoke-expression\b/i,
    /\biex\b/i,
    /\bsudo\b/i,
  ];
  return blockedPatterns.some((pattern) => pattern.test(script));
}

function getAdapter(platform = process.platform) {
  if (platform === "darwin") {
    return createMacOsAdapter();
  }
  if (platform === "win32") {
    return createWindowsAdapter();
  }
  return null;
}

export function createAppCapabilityRunner({
  env = process.env,
  adapter: adapterOverride = null,
} = {}) {
  const adapter = adapterOverride || getAdapter();
  const allowList = readAllowList(env);

  return {
    allowList,
    async execute(capability, payload) {
      if (!adapter) {
        const error = new Error(
          "Desktop automation adapter is not available for this OS."
        );
        error.code = "adapter_unavailable";
        throw error;
      }
      const appName = String(payload?.appName || "");
      if (!appName) {
        const error = new Error("appName is required.");
        error.code = "app_name_required";
        throw error;
      }
      if (!allowList.includes(appName)) {
        const error = new Error(`App is not allowlisted: ${appName}`);
        error.code = "app_not_allowlisted";
        throw error;
      }

      if (capability === "app.launch") {
        return await adapter.launchApp(
          appName,
          Array.isArray(payload?.args) ? payload.args : []
        );
      }
      if (capability === "app.automate") {
        const script = String(payload?.script || "").trim();
        if (!script) {
          const error = new Error(
            "script is required for app.automate capability."
          );
          error.code = "automation_script_required";
          throw error;
        }
        if (isUnsafeAutomationScript(script, env)) {
          const error = new Error(
            "Automation script contains blocked commands."
          );
          error.code = "automation_script_blocked";
          throw error;
        }
        return await adapter.runAutomationScript(script);
      }
      throw new Error(`Unsupported app capability: ${capability}`);
    },
  };
}
