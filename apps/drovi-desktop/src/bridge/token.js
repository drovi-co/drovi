import crypto from "node:crypto";

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export class CapabilityTokenManager {
  constructor({ secret, issuer = "drovi-desktop-bridge" }) {
    if (!secret || secret.length < 16) {
      throw new Error(
        "Capability token secret must be set and at least 16 characters long."
      );
    }
    this.secret = secret;
    this.issuer = issuer;
  }

  issueToken({ subject, capabilities, expiresInSeconds = 120, metadata = {} }) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.issuer,
      sub: subject,
      cap: Array.isArray(capabilities) ? capabilities : [],
      iat: now,
      exp: now + Math.max(5, Number(expiresInSeconds) || 120),
      meta: metadata,
      jti: crypto.randomUUID(),
    };
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = this.#sign(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verifyToken(token) {
    const [encodedHeader, encodedPayload, signature] = String(
      token || ""
    ).split(".");
    if (!(encodedHeader && encodedPayload && signature)) {
      return { valid: false, code: "token_malformed" };
    }
    const expected = this.#sign(`${encodedHeader}.${encodedPayload}`);
    if (
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return { valid: false, code: "token_signature_invalid" };
    }
    let payload = null;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload));
    } catch (_error) {
      return { valid: false, code: "token_payload_invalid" };
    }
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= Number(payload.exp)) {
      return { valid: false, code: "token_expired" };
    }
    if (payload.iss !== this.issuer) {
      return { valid: false, code: "token_issuer_invalid" };
    }
    return { valid: true, payload };
  }

  #sign(message) {
    return crypto
      .createHmac("sha256", this.secret)
      .update(message)
      .digest("base64url");
  }
}
