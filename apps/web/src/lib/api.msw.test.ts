import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "../../../../test/msw/server";
import { APIError, apiFetch, intelligenceAPI, sseAPI } from "./api";

describe("apiFetch (MSW)", () => {
  it("throws API_UNREACHABLE on network errors", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.error()
      )
    );

    await expect(apiFetch("/org/info")).rejects.toMatchObject({
      name: "APIError",
      code: "API_UNREACHABLE",
      status: 0,
    });
  });

  it("maps 401 to UNAUTHENTICATED", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })
      )
    );

    await expect(apiFetch("/org/info")).rejects.toMatchObject({
      name: "APIError",
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });

  it("maps 403 to FORBIDDEN", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.json({ detail: "Forbidden" }, { status: 403 })
      )
    );

    await expect(apiFetch("/org/info")).rejects.toMatchObject({
      name: "APIError",
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("maps 500 to SERVER_ERROR and preserves detail", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 })
      )
    );

    try {
      await apiFetch("/org/info");
      throw new Error("expected apiFetch to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      const apiErr = err as APIError;
      expect(apiErr.code).toBe("SERVER_ERROR");
      expect(apiErr.detail).toBe("boom");
      expect(apiErr.status).toBe(500);
    }
  });
});

describe("intelligenceAPI.listUIOs (pagination)", () => {
  it("passes cursor/limit and maps has_more to hasMore", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/uios/v2", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("cursor")).toBe("c1");
        expect(url.searchParams.get("limit")).toBe("2");

        return HttpResponse.json(
          {
            items: [
              {
                id: "uio_1",
                type: "task",
                canonical_title: "Prepare pilot demo",
                canonical_description: "Seed realistic org data",
                status: "active",
                overall_confidence: 0.9,
                confidence_tier: "high",
                is_user_verified: false,
                is_user_dismissed: false,
                due_date: null,
                created_at: "2026-02-10T00:00:00Z",
                updated_at: null,
                first_seen_at: null,
                owner: null,
                debtor: null,
                creditor: null,
                decision_maker: null,
                assignee: null,
                created_by: null,
                commitment_details: null,
                decision_details: null,
                task_details: null,
                risk_details: null,
                claim_details: null,
                brief_details: null,
                sources: [],
                evidence_id: null,
              },
            ],
            total: 1,
            cursor: "c2",
            has_more: true,
          },
          { status: 200 }
        );
      })
    );

    const res = await intelligenceAPI.listUIOs({ cursor: "c1", limit: 2 });
    expect(res.cursor).toBe("c2");
    expect(res.hasMore).toBe(true);
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.canonicalTitle).toBe("Prepare pilot demo");
  });
});

describe("sseAPI (disconnect handling)", () => {
  it("calls onError and closes the EventSource on cleanup", () => {
    const onError = vi.fn();

    interface FakeEventSourceInstance {
      close: () => void;
      onerror?: (event: Event) => void;
    }

    let lastInstance: FakeEventSourceInstance | null = null;

    class FakeEventSource implements FakeEventSourceInstance {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: Event) => void;

      constructor() {
        lastInstance = this;
      }

      close = vi.fn();
    }

    const prevDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "EventSource"
    );
    Object.defineProperty(globalThis, "EventSource", {
      value: FakeEventSource,
      configurable: true,
    });

    try {
      const cleanup = sseAPI.subscribeSyncProgress(
        "conn_1",
        () => {
          // No-op.
        },
        onError
      );
      if (!lastInstance) {
        throw new Error("Expected FakeEventSource to be constructed");
      }
      const instance = lastInstance as unknown as FakeEventSourceInstance;
      expect(instance).toBeDefined();
      instance.onerror?.(new Event("error"));
      expect(onError).toHaveBeenCalledTimes(1);
      cleanup();
      expect(instance.close).toHaveBeenCalledTimes(1);
    } finally {
      // Restore global to avoid cross-test pollution.
      if (prevDescriptor) {
        Object.defineProperty(globalThis, "EventSource", prevDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "EventSource");
      }
    }
  });
});
