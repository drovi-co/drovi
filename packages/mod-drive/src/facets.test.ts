import { describe, expect, it } from "vitest";
import { buildDriveFacets, defaultDriveFacetConfig } from "./facets";

describe("mod-drive facets", () => {
  it("builds default and customized facet sets", () => {
    const all = buildDriveFacets(defaultDriveFacetConfig());
    expect(all).toContain("owner");
    expect(all).toContain("tags");

    const reduced = buildDriveFacets({
      includeOwnerFacet: false,
      includeTagFacet: false,
      includeFolderFacet: true,
    });
    expect(reduced).not.toContain("owner");
    expect(reduced).not.toContain("tags");
    expect(reduced).toContain("folder");
  });
});
