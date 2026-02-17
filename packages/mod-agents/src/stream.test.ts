import { describe, expect, it } from "vitest";
import {
  buildAgentRunStreamUrl,
  parseAgentRunStreamPayload,
} from "./stream";

describe("agent run stream helpers", () => {
  it("builds stream URL with organization and deployment params", () => {
    expect(
      buildAgentRunStreamUrl("http://localhost:8000", {
        organizationId: "org_1",
        deploymentId: "dep_2",
      })
    ).toBe(
      "http://localhost:8000/api/v1/agents/runs/stream?organization_id=org_1&deployment_id=dep_2"
    );
  });

  it("parses valid payload and rejects invalid data", () => {
    expect(parseAgentRunStreamPayload("{\"id\":\"run_1\",\"status\":\"running\"}"))
      .toMatchObject({
        id: "run_1",
        status: "running",
      });
    expect(parseAgentRunStreamPayload("not-json")).toBeNull();
    expect(parseAgentRunStreamPayload("{\"status\":\"running\"}")).toBeNull();
  });
});
