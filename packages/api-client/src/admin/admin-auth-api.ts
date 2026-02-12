import type { ApiClient } from "../http/client";

import type { AdminLoginResponse, AdminMe } from "./models";

export function createAdminAuthApi(client: ApiClient) {
  return {
    loginWithEmail: async (params: { email: string; password: string }) => {
      return client.requestJson<AdminLoginResponse>("/admin/login", {
        method: "POST",
        headers: { "X-Drovi-Client": "admin" },
        body: params,
        allowRetry: false,
      });
    },
    logout: async () => {
      return client.requestJson<{ status: string }>("/admin/logout", {
        method: "POST",
        headers: { "X-Drovi-Client": "admin" },
        allowRetry: false,
      });
    },
    me: async () => {
      return client.requestJson<AdminMe>("/admin/me", {
        headers: { "X-Drovi-Client": "admin" },
      });
    },
  };
}
