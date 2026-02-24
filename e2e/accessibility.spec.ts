import { expect, type Page, test } from "@playwright/test";
import { createDefaultState, installWebApiMocks } from "./helpers/web-api-mocks";
import {
  createDefaultWorldBrainState,
  installWorldBrainApiMocks,
} from "./helpers/world-brain-api-mocks";

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

const WORLD_BRAIN_VIEWPORTS = [
  {
    label: "desktop",
    viewport: { width: 1440, height: 900 },
  },
  {
    label: "tablet",
    viewport: { width: 1024, height: 768 },
  },
] as const;

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

async function openWorldBrain(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);

  const state = createDefaultState({
    authenticated: true,
    user: {
      user_id: "usr_1",
      org_id: "org_1",
      org_name: "Drovi",
      role: "pilot_owner",
      email: "jeremy@drovi.co",
      exp: new Date(Date.now() + 86_400_000).toISOString(),
    },
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
  state.org.connection_count = state.connections.length;

  await installWebApiMocks(page, state);
  await installWorldBrainApiMocks(
    page,
    createDefaultWorldBrainState({
      organizationId: state.user.org_id,
      role: state.user.role,
    })
  );

  await page.addInitScript(() => {
    window.localStorage.setItem("drovi:onboarding", "complete");
  });

  await page.goto("/dashboard/console");

  const worldBrainLink = page
    .getByRole("link", { name: /world brain/i })
    .first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await worldBrainLink.count()) > 0) {
      break;
    }
    const navToggle = page.getByRole("button", { name: "Toggle Sidebar" }).first();
    if (await navToggle.isVisible()) {
      await navToggle.click();
      await page.waitForTimeout(200);
    }
  }

  await expect
    .poll(() => worldBrainLink.count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
  await worldBrainLink.click();
  await expect(page).toHaveURL(/\/dashboard\/world-brain/);
  await expect(
    page.getByRole("heading", { name: "World Brain Control Room" })
  ).toBeVisible();
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

  for (const responsiveCase of WORLD_BRAIN_VIEWPORTS) {
    test(`world brain remains accessible and responsive on ${responsiveCase.label}`, async ({
      page,
    }) => {
      await openWorldBrain(page, responsiveCase.viewport);
      await expect(page.locator("main")).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 1;
      });
      expect(hasHorizontalOverflow).toBe(false);

      const proofButton = page
        .getByTestId("open-proof-evt_bridge_conflict")
        .first();
      await expect(proofButton).toBeVisible();
      await proofButton.focus();
      await expect(proofButton).toBeFocused();
      await proofButton.press("Enter");

      await expect(
        page.getByRole("heading", { name: "Proof Bundle" })
      ).toBeVisible();
      await expect(page.getByText("evidence_world_1")).toBeVisible();

      await page.keyboard.press("Escape");

      const triageButton = page.getByTestId("triage-simulate_impact-viol_2");
      await expect(triageButton).toBeVisible();
      await triageButton.focus();
      await expect(triageButton).toBeFocused();
      await triageButton.press("Enter");

      await expect(page.getByTestId("triage-result-card")).toBeVisible();
    });
  }

  test("dashboard shell remains responsive on mobile", async ({ page }) => {
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
    state.org.connection_count = state.connections.length;

    await page.setViewportSize(MOBILE_VIEWPORT);
    await installWebApiMocks(page, state);
    await installWorldBrainApiMocks(
      page,
      createDefaultWorldBrainState({
        organizationId: state.user.org_id,
        role: state.user.role,
      })
    );
    await page.addInitScript(() => {
      window.localStorage.setItem("drovi:onboarding", "complete");
    });

    await page.goto("/dashboard/console");
    await expect(
      page.getByRole("heading", {
        name: "Truth register for every commitment and decision",
      })
    ).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 1;
    });
    expect(hasHorizontalOverflow).toBe(false);

    const toggleSidebar = page.getByRole("button", { name: "Toggle Sidebar" }).first();
    await expect(toggleSidebar).toBeVisible();
    await toggleSidebar.focus();
    await expect(toggleSidebar).toBeFocused();
    await toggleSidebar.press("Enter");
  });
});
