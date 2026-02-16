import type { DroviModule } from "@memorystack/mod-kit";
import {
  defaultEvidenceAccessPolicy,
  type EvidenceAccessPolicy,
} from "./access";
import { MOD_EVIDENCE_NAMESPACE, modEvidenceI18n } from "./messages";

export interface CreateEvidenceModuleOptions {
  policy?: Partial<EvidenceAccessPolicy>;
}

export function createEvidenceModule(
  options?: CreateEvidenceModuleOptions
): DroviModule {
  const policy: EvidenceAccessPolicy = {
    ...defaultEvidenceAccessPolicy(),
    ...(options?.policy ?? {}),
  };

  return {
    id: "mod-evidence",
    title: "Evidence",
    capabilities: ["evidence.read", "evidence.open_source"],
    routes: [
      { id: "evidence.uio", path: "/dashboard/uio/$uioId", slot: "dashboard" },
    ],
    commands: [
      {
        id: "evidence.open",
        title: "Open evidence",
        action: "evidence.open",
        requiresCapability: "evidence.read",
      },
    ],
    i18n: {
      namespaces: [modEvidenceI18n],
    },
    uiHints: {
      namespace: MOD_EVIDENCE_NAMESPACE,
      policy,
    },
  };
}
