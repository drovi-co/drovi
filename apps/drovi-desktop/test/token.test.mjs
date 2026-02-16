import { describe, expect, it, vi } from "vitest";

import { CapabilityTokenManager } from "../src/bridge/token.js";

describe("CapabilityTokenManager", () => {
  it("issues and validates tokens", () => {
    const manager = new CapabilityTokenManager({
      secret: "this-is-a-long-test-secret-12345",
      issuer: "test-issuer",
    });
    const token = manager.issueToken({
      subject: "desktop-client",
      capabilities: ["fs.read", "app.launch"],
      expiresInSeconds: 60,
    });
    const verification = manager.verifyToken(token);
    expect(verification.valid).toBe(true);
    expect(verification.payload.sub).toBe("desktop-client");
    expect(verification.payload.cap).toEqual(["fs.read", "app.launch"]);
  });

  it("rejects tampered tokens", () => {
    const manager = new CapabilityTokenManager({
      secret: "this-is-a-long-test-secret-12345",
      issuer: "test-issuer",
    });
    const token = manager.issueToken({
      subject: "desktop-client",
      capabilities: ["fs.read"],
      expiresInSeconds: 60,
    });
    const tampered = `${token.slice(0, -2)}zz`;
    const verification = manager.verifyToken(tampered);
    expect(verification.valid).toBe(false);
  });

  it("rejects expired tokens", () => {
    const manager = new CapabilityTokenManager({
      secret: "this-is-a-long-test-secret-12345",
      issuer: "test-issuer",
    });
    const nowMs = Date.now();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(nowMs);
    const token = manager.issueToken({
      subject: "desktop-client",
      capabilities: ["fs.read"],
      expiresInSeconds: 5,
    });
    nowSpy.mockReturnValue(nowMs + 6000);
    const verification = manager.verifyToken(token);
    expect(verification.valid).toBe(false);
    expect(verification.code).toBe("token_expired");
    nowSpy.mockRestore();
  });
});
