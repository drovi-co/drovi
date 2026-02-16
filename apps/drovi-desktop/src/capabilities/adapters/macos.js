import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      const error = new Error(
        `Command failed (${command}): ${stderr || stdout}`
      );
      error.code = "command_failed";
      reject(error);
    });
  });
}

export function createMacOsAdapter() {
  return {
    async launchApp(appName, args = []) {
      await run("open", ["-a", appName, ...args]);
      return { launched: true, appName };
    },
    async runAutomationScript(script) {
      const result = await run("osascript", ["-e", script]);
      return { ok: true, output: result.stdout.trim() };
    },
  };
}
