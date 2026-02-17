import { expect, test } from "@playwright/test";
import { createDefaultState, installWebApiMocks } from "./helpers/web-api-mocks";

test("signup -> onboarding -> connect source -> dashboard", async ({
  page,
}) => {
  const state = createDefaultState();
  await installWebApiMocks(page, state);

  await page.goto("/login?mode=sign-up");

  await page.fill("#name", "Jeremy Scatigna");
  await page.fill("#organizationName", "Drovi");
  await page.fill("#email", "jeremy@drovi.co");
  await page.fill("#password", "DroviDemo123!");
  await page.check("#terms");
  await page.locator("form button[type='submit']").first().click();

  await page.waitForURL("**/onboarding/create-org");

  await page.fill("#name", "Drovi");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL("**/onboarding/connect-sources");

  await page
    .getByRole("button", { name: /connect/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/onboarding\/connect-sources/);

  const connected = state.connections.find((item) => item.provider === "gmail");
  expect(connected?.status).toBe("connected");
  expect(connected?.live_status).toBe("healthy");
  expect(connected?.backfill_status).toBe("done");

  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL("**/onboarding/invite-team");

  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.waitForURL("**/onboarding/complete");

  await page.getByRole("button", { name: /go to dashboard/i }).click();
  await page.waitForURL(/\/dashboard(\/|$)/);

  expect(state.connections.length).toBeGreaterThan(0);
});

test("drive browse + evidence open + search + ask", async ({ page }) => {
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

  await page.addInitScript(() => {
    window.localStorage.setItem("drovi:onboarding", "complete");
  });

  await page.goto("/dashboard/drive");

  await page.getByText("Pilot Engagement Letter").click();

  const pdfPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: /open pdf/i }).click();
  const pdfPopup = await pdfPopupPromise;
  await expect(pdfPopup).toHaveURL(/mock\/evidence\/doc-1\.pdf/);
  await pdfPopup.close();

  await page
    .getByText(/page 1/i)
    .first()
    .click();

  await page.getByRole("tab", { name: "Search" }).click();
  await page
    .getByPlaceholder(
      "e.g. engagement letter, client approval, indemnification"
    )
    .fill("scope changes");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByText(
      "Client confirms scope changes and approves revised billing schedule."
    )
  ).toBeVisible();

  await page.getByRole("tab", { name: "Ask" }).click();
  await page
    .getByPlaceholder("e.g. Where did the client approve scope changes?")
    .fill("Where was scope approved?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(
    page.getByText(
      "The client approved scope changes in the pilot engagement letter"
    )
  ).toBeVisible();

  expect(state.evidencePresignCount).toBeGreaterThanOrEqual(2);
});
