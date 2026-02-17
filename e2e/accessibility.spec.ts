import { expect, type Page, test } from "@playwright/test";
import { createDefaultState, installWebApiMocks } from "./helpers/web-api-mocks";

async function tabUntilFocused(page: Page, selector: string, maxTabs = 12) {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    const isFocused = await page.locator(selector).evaluate((element) => {
      return document.activeElement === element;
    });
    if (isFocused) {
      return;
    }
  }
  throw new Error(`Unable to focus ${selector} with keyboard navigation`);
}

test.describe("accessibility smoke checks", () => {
  test("login flow remains keyboard navigable", async ({ page }) => {
    await page.goto("/login");
    await page.locator("body").click();

    await tabUntilFocused(page, "#email");
    await expect(page.locator("#email")).toBeFocused();

    await tabUntilFocused(page, "#password");
    await expect(page.locator("#password")).toBeFocused();

    await tabUntilFocused(page, "button[type='submit']");
    await expect(page.locator("button[type='submit']")).toBeFocused();
  });

  test("dashboard shell exposes keyboard focus states", async ({ page }) => {
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

    await page.addInitScript(() => {
      window.localStorage.setItem("drovi:onboarding", "complete");
    });

    await page.goto("/dashboard/sources");
    await expect(page).toHaveURL(/\/dashboard\/sources/);

    await page.locator("body").click();
    await page.keyboard.press("Tab");

    const focusedTag = await page.evaluate(() => {
      return document.activeElement?.tagName ?? null;
    });
    expect(focusedTag).not.toBe("BODY");
  });
});
