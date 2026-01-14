import { beforeEach, describe, expect, it, vi } from "vitest";

// Regex patterns at top level for performance
const UPLOADS_KEY_PATTERN = /^uploads\/.+-test-file\.pdf$/;
const DOCUMENTS_KEY_PATTERN = /^documents\/.+-doc\.pdf$/;

// Mock environment
vi.mock("@memorystack/env/server", () => ({
  env: {
    NODE_ENV: "test",
    S3_ENDPOINT: "https://s3.test.com",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    S3_BUCKET: "test-bucket",
    S3_PUBLIC_URL: "https://cdn.test.com",
  },
}));

// Mock logger
vi.mock("../lib/logger", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Storage Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isStorageConfigured", () => {
    it("should return true when all S3 credentials are set", async () => {
      const { isStorageConfigured } = await import("../lib/storage");
      expect(isStorageConfigured()).toBe(true);
    });
  });

  describe("generateFileKey", () => {
    it("should generate a key with default prefix", async () => {
      const { generateFileKey } = await import("../lib/storage");

      const key = generateFileKey("test-file.pdf");

      expect(key).toMatch(UPLOADS_KEY_PATTERN);
    });

    it("should include userId in key when provided", async () => {
      const { generateFileKey } = await import("../lib/storage");

      const key = generateFileKey("test.jpg", { userId: "user-123" });

      expect(key).toContain("user-123");
    });

    it("should use custom prefix when provided", async () => {
      const { generateFileKey } = await import("../lib/storage");

      const key = generateFileKey("doc.pdf", { prefix: "documents" });

      expect(key).toMatch(DOCUMENTS_KEY_PATTERN);
    });

    it("should sanitize special characters in filename", async () => {
      const { generateFileKey } = await import("../lib/storage");

      const key = generateFileKey("file with spaces & symbols!.txt");

      expect(key).not.toContain(" ");
      expect(key).not.toContain("&");
      expect(key).not.toContain("!");
    });

    it("should truncate long filenames", async () => {
      const { generateFileKey } = await import("../lib/storage");

      const longFilename = `${"a".repeat(100)}.pdf`;
      const key = generateFileKey(longFilename);

      // UUID + sanitized name + extension should be reasonable length
      expect(key.length).toBeLessThan(150);
    });
  });

  describe("validateFileType", () => {
    it("should accept valid image types", async () => {
      const { validateFileType } = await import("../lib/storage");

      expect(validateFileType("image/jpeg", "image")).toBe(true);
      expect(validateFileType("image/png", "image")).toBe(true);
      expect(validateFileType("image/gif", "image")).toBe(true);
      expect(validateFileType("image/webp", "image")).toBe(true);
    });

    it("should reject invalid image types", async () => {
      const { validateFileType } = await import("../lib/storage");

      expect(validateFileType("application/pdf", "image")).toBe(false);
      expect(validateFileType("text/plain", "image")).toBe(false);
    });

    it("should accept valid document types", async () => {
      const { validateFileType } = await import("../lib/storage");

      expect(validateFileType("application/pdf", "document")).toBe(true);
      expect(validateFileType("text/plain", "document")).toBe(true);
      expect(validateFileType("text/csv", "document")).toBe(true);
    });

    it("should accept custom array of types", async () => {
      const { validateFileType } = await import("../lib/storage");

      expect(validateFileType("image/jpeg", ["image/jpeg", "image/png"])).toBe(
        true
      );
      expect(validateFileType("image/gif", ["image/jpeg", "image/png"])).toBe(
        false
      );
    });
  });

  describe("validateFileSize", () => {
    it("should accept files within default size limit", async () => {
      const { validateFileSize, MAX_FILE_SIZES } = await import(
        "../lib/storage"
      );

      expect(validateFileSize(1024)).toBe(true); // 1KB
      expect(validateFileSize(MAX_FILE_SIZES.default)).toBe(true);
    });

    it("should reject files exceeding default size limit", async () => {
      const { validateFileSize, MAX_FILE_SIZES } = await import(
        "../lib/storage"
      );

      expect(validateFileSize(MAX_FILE_SIZES.default + 1)).toBe(false);
    });

    it("should use correct limits for different file types", async () => {
      const { validateFileSize, MAX_FILE_SIZES } = await import(
        "../lib/storage"
      );

      expect(validateFileSize(MAX_FILE_SIZES.image, "image")).toBe(true);
      expect(validateFileSize(MAX_FILE_SIZES.image + 1, "image")).toBe(false);

      expect(validateFileSize(MAX_FILE_SIZES.video, "video")).toBe(true);
      expect(validateFileSize(MAX_FILE_SIZES.video + 1, "video")).toBe(false);
    });
  });

  describe("ALLOWED_FILE_TYPES", () => {
    it("should have all expected categories", async () => {
      const { ALLOWED_FILE_TYPES } = await import("../lib/storage");

      expect(ALLOWED_FILE_TYPES).toHaveProperty("image");
      expect(ALLOWED_FILE_TYPES).toHaveProperty("document");
      expect(ALLOWED_FILE_TYPES).toHaveProperty("video");
      expect(ALLOWED_FILE_TYPES).toHaveProperty("audio");
    });

    it("should have image types as an array", async () => {
      const { ALLOWED_FILE_TYPES } = await import("../lib/storage");

      expect(Array.isArray(ALLOWED_FILE_TYPES.image)).toBe(true);
      expect(ALLOWED_FILE_TYPES.image.length).toBeGreaterThan(0);
    });
  });

  describe("MAX_FILE_SIZES", () => {
    it("should have reasonable size limits", async () => {
      const { MAX_FILE_SIZES } = await import("../lib/storage");

      expect(MAX_FILE_SIZES.image).toBe(10 * 1024 * 1024); // 10MB
      expect(MAX_FILE_SIZES.document).toBe(50 * 1024 * 1024); // 50MB
      expect(MAX_FILE_SIZES.video).toBe(500 * 1024 * 1024); // 500MB
      expect(MAX_FILE_SIZES.audio).toBe(50 * 1024 * 1024); // 50MB
      expect(MAX_FILE_SIZES.default).toBe(10 * 1024 * 1024); // 10MB
    });
  });
});
