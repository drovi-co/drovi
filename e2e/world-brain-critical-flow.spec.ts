import { expect, test } from "@playwright/test";
import {
  createDefaultState,
  installWebApiMocks,
} from "./helpers/web-api-mocks";
import {
  createDefaultWorldBrainState,
  installWorldBrainApiMocks,
} from "./helpers/world-brain-api-mocks";

test("world brain core workflow runs from alert to proof to action", async ({
  page,
}) => {
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
  const worldBrainState = createDefaultWorldBrainState({
    organizationId: state.user.org_id,
    role: state.user.role,
  });
  await installWorldBrainApiMocks(page, worldBrainState);

  await page.addInitScript(() => {
    window.localStorage.setItem("drovi:onboarding", "complete");
  });

  await page.goto("/dashboard/console");
  await page.getByRole("link", { name: "World Brain" }).click();

  await expect(
    page.getByRole("heading", { name: "World Brain Control Room" })
  ).toBeVisible();
  await expect(page.getByTestId("impact-card-evt_bridge_conflict")).toBeVisible();

  await page.getByTestId("open-proof-evt_bridge_conflict").first().click();
  await expect(page.getByRole("heading", { name: "Proof Bundle" })).toBeVisible();
  await expect(page.getByText("Bridge proof: disclosure contradiction")).toBeVisible();
  await expect(page.getByText("evidence_world_1")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByTestId("triage-simulate_impact-viol_2")
  ).toBeVisible();

  await page.getByTestId("triage-simulate_impact-viol_2").click();
  await expect(page.getByTestId("triage-result-card")).toBeVisible();
  await expect(page.getByText("sim_triage_viol_2")).toBeVisible();

  await expect
    .poll(() => worldBrainState.triageRequests.length)
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(
      () =>
        worldBrainState.triageRequests.find(
          (request) =>
            request.violation_id === "viol_2" &&
            request.action === "simulate_impact"
        )?.action ?? ""
    )
    .toBe("simulate_impact");
});
