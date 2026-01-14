import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Mock the database
vi.mock("@memorystack/db", () => ({
  db: {
    query: {
      featureFlag: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe("Feature Flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isFeatureEnabled", () => {
    it("should return false when flag does not exist", async () => {
      const { db } = await import("@memorystack/db");
      (db.query.featureFlag.findFirst as Mock).mockResolvedValue(undefined);

      const { isFeatureEnabled } = await import("../lib/feature-flags");

      const result = await isFeatureEnabled("non-existent-flag");

      expect(result).toBe(false);
    });

    it("should return false when flag is disabled", async () => {
      const { db } = await import("@memorystack/db");
      (db.query.featureFlag.findFirst as Mock).mockResolvedValue({
        id: "test",
        key: "test-flag",
        name: "Test Flag",
        enabled: false,
        percentage: "0",
        allowedUsers: null,
        allowedOrganizations: null,
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { isFeatureEnabled } = await import("../lib/feature-flags");

      const result = await isFeatureEnabled("test-flag");

      expect(result).toBe(false);
    });

    it("should return true when flag is enabled globally (100%)", async () => {
      const { db } = await import("@memorystack/db");
      (db.query.featureFlag.findFirst as Mock).mockResolvedValue({
        id: "test",
        key: "test-flag",
        name: "Test Flag",
        enabled: true,
        percentage: "100",
        allowedUsers: [],
        allowedOrganizations: [],
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { isFeatureEnabled } = await import("../lib/feature-flags");

      const result = await isFeatureEnabled("test-flag");

      expect(result).toBe(true);
    });

    it("should return true when user is in allowed users list", async () => {
      const { db } = await import("@memorystack/db");
      (db.query.featureFlag.findFirst as Mock).mockResolvedValue({
        id: "test",
        key: "test-flag",
        name: "Test Flag",
        enabled: true,
        percentage: "0",
        allowedUsers: ["user-123"],
        allowedOrganizations: [],
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { isFeatureEnabled } = await import("../lib/feature-flags");

      const result = await isFeatureEnabled("test-flag", {
        userId: "user-123",
      });

      expect(result).toBe(true);
    });

    it("should return false when user is not in allowed users list", async () => {
      const { db } = await import("@memorystack/db");
      (db.query.featureFlag.findFirst as Mock).mockResolvedValue({
        id: "test",
        key: "test-flag",
        name: "Test Flag",
        enabled: true,
        percentage: "0",
        allowedUsers: ["user-456"],
        allowedOrganizations: [],
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { isFeatureEnabled } = await import("../lib/feature-flags");

      const result = await isFeatureEnabled("test-flag", {
        userId: "user-123",
      });

      expect(result).toBe(false);
    });

    it("should return true when organization is in allowed organizations list", async () => {
      const { db } = await import("@memorystack/db");
      (db.query.featureFlag.findFirst as Mock).mockResolvedValue({
        id: "test",
        key: "test-flag",
        name: "Test Flag",
        enabled: true,
        percentage: "0",
        allowedUsers: [],
        allowedOrganizations: ["org-123"],
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { isFeatureEnabled } = await import("../lib/feature-flags");

      const result = await isFeatureEnabled("test-flag", {
        organizationId: "org-123",
      });

      expect(result).toBe(true);
    });
  });

  describe("Exported functions", () => {
    it("should export isFeatureEnabled", async () => {
      const mod = await import("../lib/feature-flags");
      expect(typeof mod.isFeatureEnabled).toBe("function");
    });

    it("should export getAllFeatureFlags", async () => {
      const mod = await import("../lib/feature-flags");
      expect(typeof mod.getAllFeatureFlags).toBe("function");
    });

    it("should export createFeatureFlag", async () => {
      const mod = await import("../lib/feature-flags");
      expect(typeof mod.createFeatureFlag).toBe("function");
    });

    it("should export updateFeatureFlag", async () => {
      const mod = await import("../lib/feature-flags");
      expect(typeof mod.updateFeatureFlag).toBe("function");
    });

    it("should export deleteFeatureFlag", async () => {
      const mod = await import("../lib/feature-flags");
      expect(typeof mod.deleteFeatureFlag).toBe("function");
    });
  });
});
