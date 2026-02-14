import http from "node:http";
import https from "node:https";
import process from "node:process";

import { createPermissionBroker } from "../capabilities/permissions.js";
import { loadBridgeTlsConfig } from "./security.js";
import { CapabilityTokenManager } from "./token.js";

const MAX_REQUEST_BYTES = 512 * 1024;

function toJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

async function parseBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      const error = new Error("Request body too large");
      error.code = "body_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function parseBearer(request) {
  const header = String(request.headers.authorization || "");
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return header.slice(7).trim();
}

function clientIdentity(request) {
  const certificate = request.socket.getPeerCertificate
    ? request.socket.getPeerCertificate()
    : null;
  if (!certificate || Object.keys(certificate).length === 0) {
    return null;
  }
  return {
    subject: certificate.subject || null,
    issuer: certificate.issuer || null,
    valid_from: certificate.valid_from || null,
    valid_to: certificate.valid_to || null,
    serialNumber: certificate.serialNumber || null,
  };
}

async function executeCapability(capabilities, capability, payload) {
  if (capability.startsWith("fs.")) {
    return await capabilities.fs.execute(capability, payload);
  }
  if (capability.startsWith("app.")) {
    return await capabilities.app.execute(capability, payload);
  }
  if (capability.startsWith("screen.")) {
    return await capabilities.screen.execute(capability, payload);
  }
  if (capability.startsWith("secret.")) {
    return await capabilities.secrets.execute(capability, payload);
  }
  const error = new Error(`Unsupported capability: ${capability}`);
  error.code = "capability_unknown";
  throw error;
}

export async function createBridgeDaemon({
  appVersion,
  capabilities,
  onPermissionRequest,
  onStateChange,
  onAuditEvent,
  onRemoteDisable,
  env = process.env,
} = {}) {
  if (
    !(
      capabilities?.fs &&
      capabilities?.app &&
      capabilities?.screen &&
      capabilities?.secrets
    )
  ) {
    throw new Error(
      "Bridge daemon requires fs/app/screen/secrets capability runners."
    );
  }

  let remoteDisabled = false;
  const bootstrapSecret = String(
    env.DROVI_DESKTOP_BRIDGE_BOOTSTRAP_SECRET || "dev-bridge-bootstrap"
  );
  const remoteDisableToken = String(
    env.DROVI_DESKTOP_REMOTE_DISABLE_TOKEN || "dev-bridge-disable-token"
  );
  const tokenSecret = String(
    env.DROVI_DESKTOP_BRIDGE_TOKEN_SECRET || "dev-desktop-bridge-token-secret"
  );
  const issuer = String(
    env.DROVI_DESKTOP_BRIDGE_ISSUER || "drovi-desktop-bridge"
  );
  const tokenManager = new CapabilityTokenManager({
    secret: tokenSecret,
    issuer,
  });
  const permissionBroker = createPermissionBroker({ onPermissionRequest });

  const tlsConfig = loadBridgeTlsConfig(env);
  const host = String(env.DROVI_DESKTOP_BRIDGE_HOST || "127.0.0.1");
  const configuredPort = Number(env.DROVI_DESKTOP_BRIDGE_PORT || 43_111);
  let boundPort = configuredPort;

  const server = tlsConfig.tlsEnabled
    ? https.createServer(tlsConfig, requestHandler)
    : http.createServer(requestHandler);

  function setState(status) {
    if (typeof onStateChange === "function") {
      onStateChange({
        status,
        host,
        port: boundPort,
        tls: tlsConfig.tlsEnabled,
        remoteDisabled,
      });
    }
  }

  async function requestHandler(request, response) {
    try {
      if (tlsConfig.mtlsEnabled && !request.socket.authorized) {
        toJson(response, 401, { error: "client_certificate_required" });
        return;
      }

      const requestUrl = new URL(
        request.url || "/",
        `http://${host}:${boundPort}`
      );
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        toJson(response, 200, {
          status: "ok",
          app_version: appVersion,
          remote_disabled: remoteDisabled,
          mtls: tlsConfig.mtlsEnabled,
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/v1/bridge/token/issue"
      ) {
        if (
          String(request.headers["x-bridge-bootstrap-secret"] || "") !==
          bootstrapSecret
        ) {
          toJson(response, 401, { error: "bootstrap_secret_invalid" });
          return;
        }
        const body = await parseBody(request);
        const token = tokenManager.issueToken({
          subject: String(body.subject || "desktop-client"),
          capabilities: Array.isArray(body.capabilities)
            ? body.capabilities
            : [],
          expiresInSeconds: Number(body.ttl_seconds || 120),
          metadata: {
            client: body.client || "desktop",
            cert: clientIdentity(request),
          },
        });
        toJson(response, 200, {
          token,
          expires_in_seconds: Number(body.ttl_seconds || 120),
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/v1/bridge/control/disable"
      ) {
        if (
          String(request.headers["x-remote-disable-token"] || "") !==
          remoteDisableToken
        ) {
          toJson(response, 401, { error: "remote_disable_token_invalid" });
          return;
        }
        const body = await parseBody(request);
        remoteDisabled = true;
        if (typeof onRemoteDisable === "function") {
          onRemoteDisable(String(body.reason || "remote_disable_command"));
        }
        if (typeof onAuditEvent === "function") {
          onAuditEvent({
            type: "remote_disable",
            reason: body.reason || "remote_disable_command",
          });
        }
        setState("disabled");
        toJson(response, 200, { ok: true, remote_disabled: true });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/v1/bridge/control/enable"
      ) {
        if (
          String(request.headers["x-remote-disable-token"] || "") !==
          remoteDisableToken
        ) {
          toJson(response, 401, { error: "remote_disable_token_invalid" });
          return;
        }
        remoteDisabled = false;
        if (typeof onAuditEvent === "function") {
          onAuditEvent({ type: "remote_enable" });
        }
        setState("running");
        toJson(response, 200, { ok: true, remote_disabled: false });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/v1/bridge/action"
      ) {
        if (remoteDisabled) {
          toJson(response, 403, { error: "desktop_remote_disabled" });
          return;
        }
        const token = parseBearer(request);
        if (!token) {
          toJson(response, 401, { error: "token_missing" });
          return;
        }
        const verification = tokenManager.verifyToken(token);
        if (!verification.valid) {
          toJson(response, 401, { error: verification.code });
          return;
        }
        const body = await parseBody(request);
        const capability = String(body.capability || "");
        if (!capability) {
          toJson(response, 422, { error: "capability_required" });
          return;
        }
        if (!verification.payload.cap.includes(capability)) {
          toJson(response, 403, { error: "capability_not_granted" });
          return;
        }

        const approval = await permissionBroker.requestApproval({
          capability,
          payload: body.payload || {},
        });
        if (typeof onAuditEvent === "function") {
          onAuditEvent({
            type: "permission_decision",
            capability,
            decision: approval.decision,
            reason: approval.reason || null,
            actor: verification.payload.sub,
          });
        }
        if (approval.decision !== "approved") {
          if (typeof onAuditEvent === "function") {
            onAuditEvent({
              type: "action_denied",
              capability,
              reason: approval.reason || "operator_denied",
              actor: verification.payload.sub,
            });
          }
          toJson(response, 403, {
            error: approval.reason || "operator_denied",
          });
          return;
        }

        const result = await executeCapability(
          capabilities,
          capability,
          body.payload || {}
        );
        if (typeof onAuditEvent === "function") {
          onAuditEvent({
            type: "action_executed",
            capability,
            actor: verification.payload.sub,
            cert: clientIdentity(request),
          });
        }
        toJson(response, 200, { ok: true, capability, result });
        return;
      }

      toJson(response, 404, { error: "not_found" });
    } catch (error) {
      const code = String(error?.code || "bridge_handler_error");
      toJson(response, 500, {
        error: code,
        message: String(error?.message || "Internal error"),
      });
    }
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(configuredPort, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (address && typeof address === "object" && "port" in address) {
        boundPort = Number(address.port);
      }
      resolve();
    });
  });
  setState("running");

  return {
    host,
    port: boundPort,
    close: async () =>
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          setState("stopped");
          resolve();
        });
      }),
  };
}
