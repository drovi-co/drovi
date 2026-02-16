import fs from "node:fs";

function readOptionalFile(filePath) {
  if (!filePath) {
    return null;
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`TLS file does not exist: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

export function loadBridgeTlsConfig(env = process.env) {
  const cert = readOptionalFile(env.DROVI_DESKTOP_BRIDGE_CERT);
  const key = readOptionalFile(env.DROVI_DESKTOP_BRIDGE_KEY);
  const ca = readOptionalFile(env.DROVI_DESKTOP_BRIDGE_CA);

  const mtlsEnabled =
    String(env.DROVI_DESKTOP_BRIDGE_MTLS || "false").toLowerCase() === "true";
  if (!mtlsEnabled) {
    return { tlsEnabled: false, mtlsEnabled: false };
  }
  if (!(cert && key && ca)) {
    throw new Error(
      "mTLS enabled but certificate files are missing (DROVI_DESKTOP_BRIDGE_CERT/KEY/CA)."
    );
  }
  return {
    tlsEnabled: true,
    mtlsEnabled: true,
    cert,
    key,
    ca,
    requestCert: true,
    rejectUnauthorized: true,
  };
}
