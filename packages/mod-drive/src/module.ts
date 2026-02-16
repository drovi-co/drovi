import type { DroviModule } from "@memorystack/mod-kit";
import {
  buildDriveFacets,
  type DriveFacetConfig,
  defaultDriveFacetConfig,
} from "./facets";
import { MOD_DRIVE_NAMESPACE, modDriveI18n } from "./messages";

export interface CreateDriveModuleOptions {
  facetConfig?: Partial<DriveFacetConfig>;
}

export function createDriveModule(
  options?: CreateDriveModuleOptions
): DroviModule {
  const base = defaultDriveFacetConfig();
  const config: DriveFacetConfig = { ...base, ...(options?.facetConfig ?? {}) };

  return {
    id: "mod-drive",
    title: "Drive",
    capabilities: ["drive.read", "drive.upload", "drive.search"],
    routes: [
      { id: "drive.index", path: "/dashboard/drive", slot: "dashboard" },
    ],
    navItems: [
      {
        id: "drive.nav",
        label: "Drive",
        to: "/dashboard/drive",
        requiresCapability: "drive.read",
      },
    ],
    commands: [
      {
        id: "drive.upload",
        title: "Upload document",
        action: "drive.upload",
        requiresCapability: "drive.upload",
      },
    ],
    i18n: {
      namespaces: [modDriveI18n],
    },
    uiHints: {
      namespace: MOD_DRIVE_NAMESPACE,
      facets: buildDriveFacets(config),
    },
  };
}
