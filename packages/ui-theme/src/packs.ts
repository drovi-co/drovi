export type ThemeMode = "light" | "dark";
export type ThemeVariables = Record<string, string>;

export interface ThemePack {
  id: string;
  label: string;
  light: ThemeVariables;
  dark: ThemeVariables;
}

const emptyVars: ThemeVariables = {};

export const themePacks: Record<string, ThemePack> = {
  default: {
    id: "default",
    label: "Drovi Default",
    light: emptyVars,
    dark: emptyVars,
  },
  legal: {
    id: "legal",
    label: "Legal Ledger",
    light: {
      "--primary": "#0f172a",
      "--accent": "#e2e8f0",
      "--chart-4": "#334155",
      "--radius": "0.25rem",
    },
    dark: {
      "--primary": "#f8fafc",
      "--accent": "#1e293b",
      "--chart-4": "#94a3b8",
      "--radius": "0.25rem",
    },
  },
  accounting: {
    id: "accounting",
    label: "Accounting Precision",
    light: {
      "--primary": "#14532d",
      "--accent": "#dcfce7",
      "--chart-4": "#15803d",
      "--radius": "0.375rem",
    },
    dark: {
      "--primary": "#bbf7d0",
      "--accent": "#14532d",
      "--chart-4": "#4ade80",
      "--radius": "0.375rem",
    },
  },
  gov: {
    id: "gov",
    label: "Gov Control",
    light: {
      "--primary": "#1d4ed8",
      "--accent": "#dbeafe",
      "--chart-4": "#2563eb",
      "--radius": "0.125rem",
    },
    dark: {
      "--primary": "#bfdbfe",
      "--accent": "#1e3a8a",
      "--chart-4": "#60a5fa",
      "--radius": "0.125rem",
    },
  },
  construction: {
    id: "construction",
    label: "Construction Ops",
    light: {
      "--primary": "#9a3412",
      "--accent": "#ffedd5",
      "--chart-4": "#c2410c",
      "--radius": "0.2rem",
    },
    dark: {
      "--primary": "#fdba74",
      "--accent": "#7c2d12",
      "--chart-4": "#fb923c",
      "--radius": "0.2rem",
    },
  },
};

export function getThemePack(themeId: string): ThemePack {
  const fallback = themePacks.default;
  if (!fallback) {
    throw new Error("Default theme pack is not configured");
  }
  return themePacks[themeId] ?? fallback;
}

export function applyThemePack(options: {
  themeId: string;
  mode?: ThemeMode;
  root?: HTMLElement;
}): ThemePack {
  const pack = getThemePack(options.themeId);
  if (typeof document === "undefined") {
    return pack;
  }

  const root = options.root ?? document.documentElement;
  const mode: ThemeMode =
    options.mode ?? (root.classList.contains("dark") ? "dark" : "light");
  const variables = mode === "dark" ? pack.dark : pack.light;
  root.setAttribute("data-drovi-theme-pack", pack.id);

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  return pack;
}
