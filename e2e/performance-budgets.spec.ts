import { expect, test, type Page } from "@playwright/test";
import { createDefaultState, installWebApiMocks } from "./helpers/web-api-mocks";
import {
  createDefaultWorldBrainState,
  installWorldBrainApiMocks,
} from "./helpers/world-brain-api-mocks";

const ROUTE_LOAD_BUDGET_MS = 1600;
const INITIAL_TTFB_BUDGET_MS = 600;
const INITIAL_DCL_BUDGET_MS = 2200;
const WORLD_BRAIN_ROUTE_LOAD_BUDGET_MS = 2200;
const WORLD_BRAIN_PROOF_INTERACTION_BUDGET_MS = 700;

async function measureRouteLoadMs(page: Page, path: string): Promise<number> {
  const startedAt = Date.now();
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
  return Date.now() - startedAt;
}

test("core routes stay within UX performance budgets", async ({ page }) => {
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
  state.org.connection_count = 1;

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

  const dashboardLoadMs = await measureRouteLoadMs(page, "/dashboard");
  expect(dashboardLoadMs).toBeLessThan(ROUTE_LOAD_BUDGET_MS);

  const navTiming = await page.evaluate(() => {
    const nav = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming | undefined;
    return {
      ttfbMs: nav ? Math.round(nav.responseStart) : -1,
      dclMs: nav ? Math.round(nav.domContentLoadedEventEnd) : -1,
    };
  });
  expect(navTiming.ttfbMs).toBeGreaterThanOrEqual(0);
  expect(navTiming.ttfbMs).toBeLessThan(INITIAL_TTFB_BUDGET_MS);
  expect(navTiming.dclMs).toBeGreaterThanOrEqual(0);
  expect(navTiming.dclMs).toBeLessThan(INITIAL_DCL_BUDGET_MS);

  const sourcesLoadMs = await measureRouteLoadMs(page, "/dashboard/sources");
  expect(sourcesLoadMs).toBeLessThan(ROUTE_LOAD_BUDGET_MS);

  const driveLoadMs = await measureRouteLoadMs(page, "/dashboard/drive");
  expect(driveLoadMs).toBeLessThan(ROUTE_LOAD_BUDGET_MS);

  const worldBrainLoadStartedAt = Date.now();
  await page.getByRole("link", { name: /world brain/i }).first().click();
  await expect(
    page.getByRole("heading", { name: "World Brain Control Room" })
  ).toBeVisible();
  const worldBrainLoadMs = Date.now() - worldBrainLoadStartedAt;
  expect(worldBrainLoadMs).toBeLessThan(WORLD_BRAIN_ROUTE_LOAD_BUDGET_MS);

  const proofInteractionStartedAt = Date.now();
  await page.getByTestId("open-proof-evt_bridge_conflict").first().click();
  await expect(page.getByRole("heading", { name: "Proof Bundle" })).toBeVisible();
  const proofInteractionLatencyMs = Date.now() - proofInteractionStartedAt;
  expect(proofInteractionLatencyMs).toBeLessThan(
    WORLD_BRAIN_PROOF_INTERACTION_BUDGET_MS
  );
});
