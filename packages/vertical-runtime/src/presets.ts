import type { ModuleOverride } from "@memorystack/mod-kit";

export type VerticalId = "legal" | "accounting" | "gov" | "construction";

export interface VerticalPreset {
  id: VerticalId;
  title: string;
  themePack: "legal" | "accounting" | "gov" | "construction";
  moduleIds: string[];
  appOverrides: Partial<Record<string, ModuleOverride>>;
  vocabulary: Record<string, string>;
}

const BASE_MODULES = [
  "mod-auth",
  "mod-onboarding",
  "mod-sources",
  "mod-teams",
  "mod-drive",
  "mod-evidence",
  "mod-ask",
];

const LEGAL_PRESET: VerticalPreset = {
  id: "legal",
  title: "Drovi Legal",
  themePack: "legal",
  moduleIds: [...BASE_MODULES, "mod-continuums"],
  appOverrides: {
    "mod-drive": {
      nav: {
        "drive.nav": { label: "Matter Drive" },
      },
      typeOverrides: {
        "legal.matter": { label: "Matter" },
        "legal.advice": { label: "Advice" },
      },
    },
    "mod-ask": {
      nav: {
        "ask.nav": { label: "Advice Search" },
      },
      typeOverrides: {
        "legal.matter": { description: "Tracked legal matter timeline." },
        "legal.advice": {
          description: "Evidence-anchored advice statement with validity.",
        },
      },
    },
  },
  vocabulary: {
    client: "Client",
    project: "Matter",
    source: "Evidence Source",
    dueDate: "Deadline",
  },
};

const ACCOUNTING_PRESET: VerticalPreset = {
  id: "accounting",
  title: "Drovi Accounting",
  themePack: "accounting",
  moduleIds: [...BASE_MODULES, "mod-continuums"],
  appOverrides: {
    "mod-drive": {
      nav: {
        "drive.nav": { label: "Filing Vault" },
      },
      typeOverrides: {
        "accounting.filing_deadline": { label: "Filing Deadline" },
      },
    },
    "mod-teams": {
      nav: {
        "teams.nav": { label: "Engagement Team" },
      },
    },
  },
  vocabulary: {
    client: "Account",
    project: "Engagement",
    source: "Ledger Source",
    dueDate: "Filing Due",
  },
};

const GOV_PRESET: VerticalPreset = {
  id: "gov",
  title: "Drovi Gov",
  themePack: "gov",
  moduleIds: [...BASE_MODULES, "mod-console"],
  appOverrides: {
    "mod-teams": {
      nav: {
        "teams.nav": { label: "Departments" },
      },
    },
    "mod-console": {
      nav: {
        "console.nav": { label: "Operations" },
      },
    },
  },
  vocabulary: {
    client: "Agency",
    project: "Program",
    source: "Record Source",
    dueDate: "Compliance Date",
  },
};

const CONSTRUCTION_PRESET: VerticalPreset = {
  id: "construction",
  title: "Drovi Construction",
  themePack: "construction",
  moduleIds: [...BASE_MODULES, "mod-continuums"],
  appOverrides: {
    "mod-drive": {
      nav: {
        "drive.nav": { label: "Site Documents" },
      },
    },
    "mod-continuums": {
      nav: {
        "continuums.nav": { label: "Playbooks" },
      },
    },
  },
  vocabulary: {
    client: "Owner",
    project: "Site",
    source: "Field Source",
    dueDate: "Milestone Due",
  },
};

const PRESETS: Record<VerticalId, VerticalPreset> = {
  legal: LEGAL_PRESET,
  accounting: ACCOUNTING_PRESET,
  gov: GOV_PRESET,
  construction: CONSTRUCTION_PRESET,
};

export function listVerticalPresets(): VerticalPreset[] {
  return Object.values(PRESETS);
}

export function getVerticalPreset(vertical: VerticalId): VerticalPreset {
  return PRESETS[vertical];
}
