import { describe, expect, it } from "vitest";
import { connectorHealthTone, filterAllowedConnectors } from "./connectors";

describe("mod-sources connector helpers", () => {
  it("filters connector list when policy is present", () => {
    const connectors = [
      { id: "gmail", displayName: "Gmail", enabled: true },
      { id: "slack", displayName: "Slack", enabled: true },
    ];

    expect(
      filterAllowedConnectors(connectors, ["gmail"]).map((item) => item.id)
    ).toEqual(["gmail"]);
  });

  it("maps connector status to health tone", () => {
    expect(connectorHealthTone("healthy")).toBe("good");
    expect(connectorHealthTone("syncing")).toBe("warning");
    expect(connectorHealthTone("failed")).toBe("critical");
  });
});
