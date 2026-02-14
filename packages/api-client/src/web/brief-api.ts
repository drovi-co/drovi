import type { ApiClient } from "../http/client";

import type { Brief } from "./models";

export function createBriefApi(client: ApiClient) {
  return {
    async getDailyBrief(): Promise<Brief> {
      return client.requestJson<Brief>("/brief");
    },

    async generateBrief(): Promise<Brief> {
      return client.requestJson<Brief>("/brief/generate", { method: "POST" });
    },
  };
}
