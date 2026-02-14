import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, desktopCapturer, ipcMain } from "electron";

import { createBridgeDaemon } from "./bridge/daemon.js";
import { createAppCapabilityRunner } from "./capabilities/apps.js";
import { createFsCapabilityRunner } from "./capabilities/fs.js";
import { createScreenCapabilityRunner } from "./capabilities/screen.js";
import { SecretVault } from "./capabilities/secrets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let bridgeDaemon = null;

const pendingApprovals = new Map();
const state = {
  remoteDisabled: false,
  bridgeStatus: "starting",
  pendingRequests: [],
  recentAudit: [],
};

function pushAudit(entry) {
  const payload = {
    ts: new Date().toISOString(),
    ...entry,
  };
  state.recentAudit = [payload, ...state.recentAudit].slice(0, 200);
  broadcastState();
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:state", state);
  }
}

function setBridgeStatus(status) {
  state.bridgeStatus = status;
  broadcastState();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  broadcastState();
}

function addPendingRequest(request) {
  state.pendingRequests = [request, ...state.pendingRequests].slice(0, 50);
  broadcastState();
}

function resolvePendingRequest(requestId, decision, reason) {
  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return false;
  }
  pendingApprovals.delete(requestId);
  state.pendingRequests = state.pendingRequests.map((request) =>
    request.requestId === requestId
      ? {
          ...request,
          status: decision,
          decidedAt: new Date().toISOString(),
          reason: reason ?? null,
        }
      : request
  );
  pending.resolve({ decision, reason: reason ?? null });
  broadcastState();
  return true;
}

function buildCapabilities() {
  const vault = new SecretVault({ baseDir: app.getPath("userData") });
  return {
    fs: createFsCapabilityRunner({ vault }),
    app: createAppCapabilityRunner(),
    screen: createScreenCapabilityRunner({ desktopCapturer }),
    secrets: vault,
  };
}

async function startBridge() {
  const capabilities = buildCapabilities();
  bridgeDaemon = await createBridgeDaemon({
    appVersion: app.getVersion(),
    capabilities,
    onRemoteDisable: (reason) => {
      state.remoteDisabled = true;
      pushAudit({ type: "remote_disable", reason });
    },
    onAuditEvent: (event) => {
      pushAudit(event);
    },
    onPermissionRequest: async (request) => {
      if (state.remoteDisabled) {
        return { decision: "denied", reason: "desktop_remote_disabled" };
      }
      const approval = {
        requestId: request.requestId,
        capability: request.capability,
        payloadPreview: request.payloadPreview,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      addPendingRequest(approval);
      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (!pendingApprovals.has(request.requestId)) {
            return;
          }
          pendingApprovals.delete(request.requestId);
          resolve({ decision: "denied", reason: "approval_timeout" });
          state.pendingRequests = state.pendingRequests.map((item) =>
            item.requestId === request.requestId
              ? {
                  ...item,
                  status: "timeout",
                  decidedAt: new Date().toISOString(),
                  reason: "approval_timeout",
                }
              : item
          );
          broadcastState();
        }, 60_000);
        pendingApprovals.set(request.requestId, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
        });
      });
    },
    onStateChange: (bridgeState) => {
      setBridgeStatus(bridgeState.status);
    },
  });
  setBridgeStatus("running");
  pushAudit({ type: "bridge_started", port: bridgeDaemon.port });
}

app.whenReady().then(async () => {
  await createWindow();
  await startBridge();

  ipcMain.handle("desktop:get-state", () => state);
  ipcMain.handle("desktop:approve-request", (_event, payload) => {
    const requestId = String(payload?.requestId || "");
    const decision = payload?.decision === "approved" ? "approved" : "denied";
    const reason = payload?.reason ? String(payload.reason) : null;
    if (!requestId) {
      return { ok: false, error: "request_id_required" };
    }
    const ok = resolvePendingRequest(requestId, decision, reason);
    return ok ? { ok: true } : { ok: false, error: "request_not_found" };
  });
  ipcMain.handle("desktop:enable-remote", () => {
    state.remoteDisabled = false;
    pushAudit({ type: "remote_enable" });
    return { ok: true };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error("Failed to recreate desktop window", error);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  for (const requestId of pendingApprovals.keys()) {
    resolvePendingRequest(requestId, "denied", "desktop_shutdown");
  }
  if (bridgeDaemon) {
    await bridgeDaemon.close();
    bridgeDaemon = null;
  }
});
