import { expect, type Page, type Route, test } from "@playwright/test";

type MockConnection = {
  id: string;
  provider: string;
  email: string | null;
  workspace: string | null;
  status: string;
  visibility: "org_shared" | "private";
  scopes: string[];
  last_sync: string | null;
  messages_synced: number;
  restricted_labels: string[];
  restricted_channels: string[];
  progress: number | null;
  live_status?: string | null;
  backfill_status?: string | null;
};

type MockState = {
  authenticated: boolean;
  user: {
    user_id: string;
    org_id: string;
    org_name: string;
    role: string;
    email: string;
    exp: string;
  };
  org: {
    id: string;
    name: string;
    status: string;
    region: string | null;
    allowed_domains: string[];
    notification_emails: string[] | null;
    allowed_connectors: string[] | null;
    default_connection_visibility: "org_shared" | "private";
    expires_at: string | null;
    created_at: string | null;
    member_count: number;
    connection_count: number;
  };
  connectors: Array<{
    type: string;
    display_name: string;
    configured: boolean;
    missing_env: string[];
  }>;
  connections: MockConnection[];
  evidencePresignCount: number;
};

function json(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function parseBody(request: Parameters<Route["request"]>[0]) {
  const raw = request.postData();
  if (!raw) {
    return {} as Record<string, unknown>;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

async function installWebApiMocks(page: Page, state: MockState) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/org/connections/events" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
    }

    if (path === "/api/v1/auth/me" && method === "GET") {
      if (!state.authenticated) {
        return json(route, { detail: "Not authenticated" }, 401);
      }
      return json(route, state.user);
    }

    if (path === "/api/v1/auth/me/locale" && method === "PATCH") {
      const body = parseBody(request);
      return json(route, { ok: true, locale: body.locale ?? null });
    }

    if (
      (path === "/api/v1/auth/signup/email" ||
        path === "/api/v1/auth/login/email") &&
      method === "POST"
    ) {
      state.authenticated = true;
      return json(route, {
        success: true,
        session_token: "demo-session-token",
      });
    }

    if (path === "/api/v1/auth/logout" && method === "POST") {
      state.authenticated = false;
      return json(route, { success: true });
    }

    if (path === "/api/v1/org/info" && method === "GET") {
      state.org.connection_count = state.connections.length;
      return json(route, state.org);
    }

    if (path === "/api/v1/org/info" && method === "PATCH") {
      const body = parseBody(request);
      if (typeof body.name === "string" && body.name.trim()) {
        state.org.name = body.name;
        state.user.org_name = body.name;
      }
      if (typeof body.region === "string" && body.region.trim()) {
        state.org.region = body.region;
      }
      return json(route, state.org);
    }

    if (path === "/api/v1/connections/connectors" && method === "GET") {
      return json(route, { connectors: state.connectors });
    }

    if (path === "/api/v1/org/connections" && method === "GET") {
      return json(route, { connections: state.connections });
    }

    if (path === "/api/v1/org/connections/gmail/connect" && method === "POST") {
      if (!state.connections.find((item) => item.provider === "gmail")) {
        state.connections.push({
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
        });
      }

      return json(route, {
        auth_url: `${url.origin}/onboarding/connect-sources?connection=success`,
        state: "mock-state",
        code_verifier: "mock-verifier",
      });
    }

    if (
      path === "/api/v1/org/connections/conn_gmail_1/sync" &&
      method === "POST"
    ) {
      return json(route, {
        connection_id: "conn_gmail_1",
        status: "queued",
        message: "Sync queued",
      });
    }

    if (
      path === "/api/v1/org/connections/conn_gmail_1/backfill" &&
      method === "POST"
    ) {
      return json(route, {
        connection_id: "conn_gmail_1",
        backfill_jobs: ["job_1"],
        status: "queued",
      });
    }

    if (path === "/api/v1/org/members" && method === "GET") {
      return json(route, {
        members: [
          {
            id: "mem_1",
            role: "pilot_owner",
            name: "Jeremy",
            email: "jeremy@drovi.co",
            created_at: new Date().toISOString(),
          },
        ],
      });
    }

    if (path === "/api/v1/org/invites" && method === "GET") {
      return json(route, { invites: [] });
    }

    if (path === "/api/v1/org/invites" && method === "POST") {
      return json(route, {
        token: "inv_1",
        org_id: state.user.org_id,
        role: "pilot_member",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        used_at: null,
        created_at: new Date().toISOString(),
      });
    }

    if (path === "/api/v1/documents" && method === "GET") {
      return json(route, {
        success: true,
        items: [
          {
            id: "doc_1",
            title: "Pilot Engagement Letter",
            file_name: "pilot-engagement-letter.pdf",
            mime_type: "application/pdf",
            byte_size: 153_600,
            sha256: "abc123",
            status: "processed",
            folder_path: "/legal/pilot",
            tags: ["pilot", "engagement"],
            page_count: 4,
            evidence_artifact_id: "evh_doc_1",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });
    }

    if (path === "/api/v1/documents/doc_1/chunks" && method === "GET") {
      return json(route, {
        success: true,
        items: [
          {
            id: "chunk_1",
            document_id: "doc_1",
            chunk_index: 0,
            page_index: 0,
            snippet:
              "Client confirms scope changes and approves revised billing schedule.",
            image_artifact_id: "evh_chunk_1",
          },
        ],
      });
    }

    if (path === "/api/v1/documents/chunks/chunk_1" && method === "GET") {
      return json(route, {
        id: "chunk_1",
        document_id: "doc_1",
        chunk_index: 0,
        page_index: 0,
        text: "Client confirms scope changes and approves revised billing schedule.",
        layout_blocks: [
          {
            text: "Client confirms scope changes and approves revised billing schedule.",
            left: 40,
            top: 60,
            width: 900,
            height: 80,
          },
        ],
        image_artifact_id: "evh_chunk_1",
      });
    }

    if (path === "/api/v1/documents/search" && method === "POST") {
      return json(route, {
        success: true,
        results: [
          {
            chunk_id: "chunk_1",
            document_id: "doc_1",
            file_name: "pilot-engagement-letter.pdf",
            title: "Pilot Engagement Letter",
            folder_path: "/legal/pilot",
            page_index: 0,
            snippet:
              "Client confirms scope changes and approves revised billing schedule.",
            score: 0.91,
          },
        ],
      });
    }

    if (path === "/api/v1/documents/ask" && method === "POST") {
      return json(route, {
        success: true,
        answer:
          "The client approved scope changes in the pilot engagement letter and accepted the revised billing schedule.",
        sources: [
          {
            chunk_id: "chunk_1",
            document_id: "doc_1",
            file_name: "pilot-engagement-letter.pdf",
            title: "Pilot Engagement Letter",
            folder_path: "/legal/pilot",
            page_index: 0,
            snippet:
              "Client confirms scope changes and approves revised billing schedule.",
            score: 0.91,
          },
        ],
      });
    }

    if (
      path === "/api/v1/evidence/artifacts/evh_doc_1/presign" &&
      method === "POST"
    ) {
      state.evidencePresignCount += 1;
      return json(route, {
        artifact_id: "evh_doc_1",
        presigned_url: `${url.origin}/mock/evidence/doc-1.pdf`,
        expires_in_seconds: 3600,
      });
    }

    if (
      path === "/api/v1/evidence/artifacts/evh_chunk_1/presign" &&
      method === "POST"
    ) {
      state.evidencePresignCount += 1;
      return json(route, {
        artifact_id: "evh_chunk_1",
        presigned_url: `${url.origin}/mock/evidence/chunk-1.png`,
        expires_in_seconds: 3600,
      });
    }

    return json(route, { ok: true });
  });

  await page.route("**/mock/evidence/**", async (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.endsWith(".png")) {
      const onePixelPng =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YVv6RQAAAAASUVORK5CYII=";
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(onePixelPng, "base64"),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\n%mock\n",
    });
  });
}

function createDefaultState(overrides?: Partial<MockState>): MockState {
  const state: MockState = {
    authenticated: false,
    user: {
      user_id: "usr_1",
      org_id: "org_1",
      org_name: "Drovi",
      role: "pilot_owner",
      email: "jeremy@drovi.co",
      exp: new Date(Date.now() + 86_400_000).toISOString(),
    },
    org: {
      id: "org_1",
      name: "Drovi",
      status: "active",
      region: "us-west",
      allowed_domains: [],
      notification_emails: null,
      allowed_connectors: null,
      default_connection_visibility: "org_shared",
      expires_at: null,
      created_at: new Date().toISOString(),
      member_count: 1,
      connection_count: 0,
    },
    connectors: [
      {
        type: "gmail",
        display_name: "Gmail",
        configured: true,
        missing_env: [],
      },
    ],
    connections: [],
    evidencePresignCount: 0,
  };

  return {
    ...state,
    ...overrides,
  };
}

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

  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL("**/onboarding/invite-team");

  await page.getByRole("button", { name: /skip for now/i }).click();
  await page.waitForURL("**/onboarding/complete");

  await page.getByRole("button", { name: /go to dashboard/i }).click();
  await page.waitForURL("**/dashboard");

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
