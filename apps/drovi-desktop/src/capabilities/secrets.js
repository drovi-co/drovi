import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function deriveKey(seed) {
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptJson(payload, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptJson(ciphertext, key) {
  const encoded = Buffer.from(ciphertext, "base64");
  const iv = encoded.subarray(0, 12);
  const authTag = encoded.subarray(12, 28);
  const encrypted = encoded.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

export class SecretVault {
  constructor({ baseDir, env = process.env } = {}) {
    this.baseDir = baseDir ? path.resolve(baseDir) : process.cwd();
    this.filePath = path.join(this.baseDir, "desktop-secrets.enc");
    const keySeed =
      env.DROVI_DESKTOP_SECRET_KEY ||
      `${process.platform}:${process.env.USER || "drovi"}:desktop`;
    this.key = deriveKey(keySeed);
    this.cache = null;
  }

  async execute(capability, payload) {
    if (capability === "secret.set") {
      await this.set(String(payload?.name || ""), String(payload?.value || ""));
      return { ok: true };
    }
    if (capability === "secret.get") {
      const value = await this.get(String(payload?.name || ""));
      return { value };
    }
    if (capability === "secret.list") {
      return { names: await this.list() };
    }
    throw new Error(`Unsupported secret capability: ${capability}`);
  }

  async set(name, value) {
    if (!name) {
      throw new Error("Secret name is required.");
    }
    const data = await this.#readAll();
    data[name] = value;
    await this.#writeAll(data);
  }

  async get(name) {
    const data = await this.#readAll();
    return data[name] ?? null;
  }

  async list() {
    const data = await this.#readAll();
    return Object.keys(data).sort();
  }

  async #readAll() {
    if (this.cache) {
      return { ...this.cache };
    }
    if (!fs.existsSync(this.filePath)) {
      this.cache = {};
      return {};
    }
    const ciphertext = fs.readFileSync(this.filePath, "utf8");
    this.cache = decryptJson(ciphertext, this.key);
    return { ...this.cache };
  }

  async #writeAll(data) {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const ciphertext = encryptJson(data, this.key);
    fs.writeFileSync(this.filePath, ciphertext, {
      encoding: "utf8",
      mode: 0o600,
    });
    this.cache = { ...data };
  }
}
