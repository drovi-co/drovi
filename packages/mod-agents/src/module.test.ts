import { describe, expect, it } from "vitest";
import { createAgentsModule } from "./module";

describe("createAgentsModule", () => {
  it("defines all dashboard routes and nav for agents", () => {
    const module = createAgentsModule();
    expect(module.id).toBe("mod-agents");
    expect(module.routes?.map((route) => route.path)).toEqual([
      "/dashboard/agents/workforces",
      "/dashboard/agents/studio",
      "/dashboard/agents/runs",
      "/dashboard/agents/catalog",
      "/dashboard/agents/inbox",
    ]);
    expect(module.navItems?.map((item) => item.id)).toEqual([
      "agent.workforces",
      "agent.studio",
      "agent.runs",
      "agent.catalog",
      "agent.inbox",
    ]);
  });
});
