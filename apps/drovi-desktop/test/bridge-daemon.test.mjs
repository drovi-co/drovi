import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridgeDaemon } from "../src/bridge/daemon.js";

const daemons = [];

async function startDaemon(overrides = {}) {
  const capabilities = {
    fs: {
      execute: vi.fn(async () => ({ ok: true })),
    },
    app: {
      execute: vi.fn(async () => ({ ok: true })),
    },
    screen: {
      execute: vi.fn(async () => ({ ok: true })),
    },
    secrets: {
      execute: vi.fn(async () => ({ ok: true })),
    },
  };
  let daemon = null;
  try {
    daemon = await createBridgeDaemon({
      appVersion: "0.1.0-test",
      capabilities,
      onPermissionRequest: async () => ({ decision: "approved" }),
      onStateChange: () => undefined,
      onAuditEvent: () => undefined,
      onRemoteDisable: () => undefined,
      env: {
        DROVI_DESKTOP_BRIDGE_HOST: "127.0.0.1",
        DROVI_DESKTOP_BRIDGE_PORT: "0",
        DROVI_DESKTOP_BRIDGE_BOOTSTRAP_SECRET: "bootstrap-test",
        DROVI_DESKTOP_REMOTE_DISABLE_TOKEN: "disable-test",
        DROVI_DESKTOP_BRIDGE_TOKEN_SECRET: "desktop-token-secret-123456789",
      },
      ...overrides,
    });
  } catch (error) {
    if (
      error &&
      (error.code === "EPERM" || String(error.message || "").includes("EPERM"))
    ) {
      return null;
    }
    throw error;
  }
  daemons.push(daemon);
  return { daemon, capabilities };
}

afterEach(async () => {
  while (daemons.length > 0) {
    const daemon = daemons.pop();
    await daemon.close();
  }
});

describe("bridge daemon", () => {
  it("rejects action requests without bearer token", async () => {
    const started = await startDaemon();
    if (!started) {
      return;
    }
    const { daemon } = started;
    const response = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/action`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: "fs.read",
          payload: { path: "/tmp/a.txt" },
        }),
      }
    );
    expect(response.status).toBe(401);
  });

  it("issues tokens and executes approved actions", async () => {
    const started = await startDaemon();
    if (!started) {
      return;
    }
    const { daemon, capabilities } = started;
    const tokenResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/token/issue`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bridge-bootstrap-secret": "bootstrap-test",
        },
        body: JSON.stringify({
          subject: "desktop-client",
          capabilities: ["fs.read"],
          ttl_seconds: 60,
        }),
      }
    );
    expect(tokenResponse.status).toBe(200);
    const tokenPayload = await tokenResponse.json();
    const token = tokenPayload.token;
    const actionResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/action`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          capability: "fs.read",
          payload: { path: "/tmp/a.txt" },
        }),
      }
    );
    expect(actionResponse.status).toBe(200);
    expect(capabilities.fs.execute).toHaveBeenCalledTimes(1);
  });

  it("enforces remote disable command", async () => {
    const started = await startDaemon();
    if (!started) {
      return;
    }
    const { daemon } = started;
    const disableResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/control/disable`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-remote-disable-token": "disable-test",
        },
        body: JSON.stringify({ reason: "security_incident" }),
      }
    );
    expect(disableResponse.status).toBe(200);
    const tokenResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/token/issue`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bridge-bootstrap-secret": "bootstrap-test",
        },
        body: JSON.stringify({
          subject: "desktop-client",
          capabilities: ["fs.read"],
          ttl_seconds: 60,
        }),
      }
    );
    const { token } = await tokenResponse.json();
    const actionResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/action`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          capability: "fs.read",
          payload: { path: "/tmp/a.txt" },
        }),
      }
    );
    expect(actionResponse.status).toBe(403);
  });

  it("rejects actions outside granted capability scope", async () => {
    const started = await startDaemon();
    if (!started) {
      return;
    }
    const { daemon, capabilities } = started;
    const tokenResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/token/issue`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bridge-bootstrap-secret": "bootstrap-test",
        },
        body: JSON.stringify({
          subject: "desktop-client",
          capabilities: ["fs.read"],
          ttl_seconds: 60,
        }),
      }
    );
    const { token } = await tokenResponse.json();
    const actionResponse = await fetch(
      `http://${daemon.host}:${daemon.port}/v1/bridge/action`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          capability: "app.launch",
          payload: { appName: "Microsoft Excel" },
        }),
      }
    );
    expect(actionResponse.status).toBe(403);
    expect(capabilities.app.execute).not.toHaveBeenCalled();
  });
});
