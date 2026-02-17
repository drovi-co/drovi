import { expect, test } from "@playwright/test";
import { createDefaultState, installWebApiMocks } from "./helpers/web-api-mocks";

const VIEWPORT = { width: 1440, height: 900 } as const;

test.describe("visual regression (institutional shell)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.addInitScript(() => {
      const fixedNow = 1762732800000; // Nov 10, 2025 UTC
      Date.now = () => fixedNow;
      window.localStorage.setItem("drovi:onboarding", "complete");
    });
  });

  test("dashboard console layout", async ({ page }) => {
    const state = createDefaultState({
      authenticated: true,
      connections: [
        {
          id: "conn_gmail_1",
          provider: "gmail",
          email: "jeremy@drovi.co",
          workspace: null,
          status: "connected",
          visibility: "org_shared",
          scopes: ["mail.read"],
          last_sync: new Date().toISOString(),
          messages_synced: 142,
          restricted_labels: [],
          restricted_channels: [],
          progress: 1,
          live_status: "healthy",
          backfill_status: "done",
        },
      ],
    });
    await installWebApiMocks(page, state);

    await page.goto("/dashboard/console");
    await expect(page).toHaveURL(/\/dashboard\/console/);
    await expect(page.locator("body")).toHaveScreenshot(
      "dashboard-console-institutional.png",
      {
        fullPage: true,
      }
    );
  });

  test("sources layout", async ({ page }) => {
    const state = createDefaultState({
      authenticated: true,
      connections: [
        {
          id: "conn_gmail_1",
          provider: "gmail",
          email: "jeremy@drovi.co",
          workspace: null,
          status: "connected",
          visibility: "org_shared",
          scopes: ["mail.read"],
          last_sync: new Date().toISOString(),
          messages_synced: 142,
          restricted_labels: [],
          restricted_channels: [],
          progress: 1,
          live_status: "healthy",
          backfill_status: "done",
        },
      ],
    });
    await installWebApiMocks(page, state);

    await page.goto("/dashboard/sources");
    await expect(page).toHaveURL(/\/dashboard\/sources/);
    await expect(page.getByText("Gmail").first()).toBeVisible();
    await expect(page.locator("body")).toHaveScreenshot(
      "dashboard-sources-institutional.png",
      {
        fullPage: true,
      }
    );
  });

  test("drive layout", async ({ page }) => {
    const state = createDefaultState({
      authenticated: true,
      connections: [
        {
          id: "conn_gmail_1",
          provider: "gmail",
          email: "jeremy@drovi.co",
          workspace: null,
          status: "connected",
          visibility: "org_shared",
          scopes: ["mail.read"],
          last_sync: new Date().toISOString(),
          messages_synced: 142,
          restricted_labels: [],
          restricted_channels: [],
          progress: 1,
          live_status: "healthy",
          backfill_status: "done",
        },
      ],
    });
    await installWebApiMocks(page, state);

    await page.goto("/dashboard/drive");
    await expect(page).toHaveURL(/\/dashboard\/drive/);
    await expect(page.getByText("Pilot Engagement Letter").first()).toBeVisible();
    await expect(page.locator("body")).toHaveScreenshot(
      "dashboard-drive-institutional.png",
      {
        fullPage: true,
      }
    );
  });
});
