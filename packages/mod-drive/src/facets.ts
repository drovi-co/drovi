export interface DriveFacetConfig {
  includeOwnerFacet: boolean;
  includeTagFacet: boolean;
  includeFolderFacet: boolean;
}

export function defaultDriveFacetConfig(): DriveFacetConfig {
  return {
    includeOwnerFacet: true,
    includeTagFacet: true,
    includeFolderFacet: true,
  };
}

export function buildDriveFacets(config: DriveFacetConfig): string[] {
  const facets: string[] = ["status", "source", "type"];
  if (config.includeOwnerFacet) {
    facets.push("owner");
  }
  if (config.includeTagFacet) {
    facets.push("tags");
  }
  if (config.includeFolderFacet) {
    facets.push("folder");
  }
  return facets;
}
