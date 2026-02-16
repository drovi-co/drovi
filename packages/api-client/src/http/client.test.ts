import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "./client";

function responseJson(
  status: number,
  body: unknown,
  headers?: Record<string, string>
) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("ApiClient.requestJson", () => {
  it("injects bearer Authorization when provided and no explicit Authorization header is set", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        responseJson(200, { ok: true })
    );
    const client = new ApiClient({
      baseUrl: "http://example.test",
      fetch: fetchSpy,
      auth: [{ kind: "bearer", getToken: () => "token_123" }],
    });

    const result = await client.requestJson<{ ok: boolean }>("/ping");
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const init = fetchSpy.mock.calls.at(0)?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token_123");
  });

  it("does not override explicit Authorization header", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        responseJson(200, { ok: true })
    );
    const client = new ApiClient({
      baseUrl: "http://example.test",
      fetch: fetchSpy,
      auth: [{ kind: "bearer", getToken: () => "token_123" }],
    });

    await client.requestJson<{ ok: boolean }>("/ping", {
      headers: { Authorization: "Bearer explicit" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls.at(0)?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer explicit");
  });

  it("injects X-API-Key when provided", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        responseJson(200, { ok: true })
    );
    const client = new ApiClient({
      baseUrl: "http://example.test",
      fetch: fetchSpy,
      auth: [{ kind: "apiKey", getKey: () => "key_abc" }],
    });

    await client.requestJson<{ ok: boolean }>("/ping");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls.at(0)?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("key_abc");
  });

  it("surfaces typed errors with request id when server returns structured payload", async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        responseJson(
          401,
          { code: "auth.unauthorized", detail: "Not authenticated" },
          { "X-Request-ID": "req_123" }
        )
    );

    const client = new ApiClient({
      baseUrl: "http://example.test",
      fetch: fetchSpy,
    });

    await expect(client.requestJson("/auth/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "auth.unauthorized",
      requestId: "req_123",
      message: "Not authenticated",
    });
  });

  it("retries GET on retryable status codes", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        responseJson(200, { ok: true })
      )
      .mockResolvedValueOnce(
        responseJson(503, { code: "upstream.error", detail: "busy" })
      )
      .mockResolvedValueOnce(responseJson(200, { ok: true }));

    const client = new ApiClient({
      baseUrl: "http://example.test",
      fetch: fetchSpy,
    });

    const pending = client.requestJson<{ ok: boolean }>("/ping");
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
