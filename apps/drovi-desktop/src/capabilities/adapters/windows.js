import { spawn } from "node:child_process";

function runPowershell(command) {
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ],
      { stdio: "pipe" }
    );
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
      const error = new Error(`PowerShell command failed: ${stderr || stdout}`);
      error.code = "command_failed";
      reject(error);
    });
  });
}

function escapeSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

export function createWindowsAdapter() {
  return {
    async launchApp(appName) {
      const escapedName = escapeSingleQuoted(appName);
      await runPowershell(`Start-Process -FilePath '${escapedName}'`);
      return { launched: true, appName };
    },
    async runAutomationScript(script) {
      const result = await runPowershell(script);
      return { ok: true, output: result.stdout.trim() };
    },
  };
}
