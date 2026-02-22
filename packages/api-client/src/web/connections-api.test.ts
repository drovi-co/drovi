import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../http/client";
import { createConnectionsApi } from "./connections-api";

describe("createConnectionsApi.initiateOAuth", () => {
  it("uses canonical org connect endpoint and maps legacy response shape", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      auth_url: "https://auth.example/redirect",
      state: "state_123",
      code_verifier: "verifier_123",
    });
    const client = {
      diagnosticsBaseUrl: "http://localhost:3001",
      requestJson,
    } as unknown as ApiClient;

    const api = createConnectionsApi(client);
    const result = await api.initiateOAuth("gmail", "org_legacy", {
      restrictedLabels: ["INBOX"],
      restrictedChannels: ["ops"],
    });

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledWith(
      "/org/connections/gmail/connect",
      expect.objectContaining({
        method: "POST",
        allowRetry: false,
      })
    );

    const requestOptions = requestJson.mock.calls[0]?.[1];
    expect(requestOptions?.body).toMatchObject({
      organization_id: "org_legacy",
      restricted_labels: ["INBOX"],
      restricted_channels: ["ops"],
    });

    expect(result).toEqual({
      auth_url: "https://auth.example/redirect",
      authorization_url: "https://auth.example/redirect",
      state: "state_123",
      code_verifier: "verifier_123",
    });
  });
});
