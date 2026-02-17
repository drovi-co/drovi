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
  institutional: {
    id: "institutional",
    label: "Swiss Private Bank",
    light: {
      "--background": "#efe2c8",
      "--foreground": "#1a2d21",
      "--card": "#f2e6cf",
      "--card-foreground": "#1a2d21",
      "--popover": "#f6ecda",
      "--popover-foreground": "#1a2d21",
      "--primary": "#214532",
      "--primary-hover": "#2b563f",
      "--primary-foreground": "#f4ead7",
      "--secondary": "#ddceb0",
      "--secondary-hover": "#d4c2a2",
      "--secondary-foreground": "#1a2d21",
      "--muted": "#e5d7bb",
      "--muted-foreground": "#665f4c",
      "--accent": "#d7c7a9",
      "--accent-foreground": "#1a2d21",
      "--destructive": "#7c3b34",
      "--destructive-hover": "#68312c",
      "--destructive-foreground": "#f4ead7",
      "--success": "#355f47",
      "--success-foreground": "#f4ead7",
      "--warning": "#95753a",
      "--warning-foreground": "#f4ead7",
      "--border": "#c7b38e",
      "--border-hover": "#b59e74",
      "--input": "#f4e8d0",
      "--input-border": "#c7b38e",
      "--ring": "#946b2d",
      "--shell": "#eadbc0",
      "--shell-foreground": "#1a2d21",
      "--shell-border": "#c7b38e",
      "--sidebar": "#e3d2b3",
      "--sidebar-foreground": "#1a2d21",
      "--sidebar-primary": "#214532",
      "--sidebar-primary-foreground": "#f4ead7",
      "--sidebar-accent": "#d4c19d",
      "--sidebar-accent-foreground": "#1a2d21",
      "--sidebar-border": "#c7b38e",
      "--sidebar-ring": "#946b2d",
      "--chart-1": "#214532",
      "--chart-2": "#3a624c",
      "--chart-3": "#6f7a66",
      "--chart-4": "#946b2d",
      "--chart-5": "#7c3b34",
      "--radius": "0.25rem",
      "--shadow-button": "0 1px 1px rgba(26, 45, 33, 0.14)",
      "--shadow-button-2": "0 1px 2px rgba(26, 45, 33, 0.18)",
      "--shadow-card": "0 2px 6px rgba(26, 45, 33, 0.12)",
      "--shadow-dropdown": "0 14px 32px rgba(26, 45, 33, 0.16)",
      "--motion-duration-fast": "120ms",
      "--motion-duration-medium": "180ms",
      "--motion-ease-standard": "cubic-bezier(0.2, 0.0, 0, 1)",
      "--font-sans-token":
        "\"Avenir Next\", \"Neue Haas Grotesk Text Pro\", \"SF Pro Text\", \"Helvetica Neue\", \"Arial\", sans-serif",
      "--font-serif-token":
        "\"Iowan Old Style\", \"Baskerville\", \"Palatino Linotype\", \"Times New Roman\", serif",
      "--font-mono-token":
        "\"JetBrains Mono\", \"SF Mono\", \"Fira Code\", \"Fira Mono\", \"Roboto Mono\", monospace",
      "--type-scale-body": "0.9375rem",
      "--type-scale-label": "0.8125rem",
      "--type-scale-h4": "1.125rem",
      "--type-scale-h3": "1.375rem",
      "--type-scale-h2": "1.75rem",
      "--type-scale-h1": "2.125rem",
    },
    dark: {
      "--background": "#13291d",
      "--foreground": "#f3e8d3",
      "--card": "#173021",
      "--card-foreground": "#f3e8d3",
      "--popover": "#193526",
      "--popover-foreground": "#f3e8d3",
      "--primary": "#cfab67",
      "--primary-hover": "#dfc184",
      "--primary-foreground": "#13291d",
      "--secondary": "#1e3a2a",
      "--secondary-hover": "#274936",
      "--secondary-foreground": "#efe4cf",
      "--muted": "#1b3425",
      "--muted-foreground": "#c4b392",
      "--accent": "#254230",
      "--accent-foreground": "#f3e8d3",
      "--destructive": "#b46f67",
      "--destructive-hover": "#c47d75",
      "--destructive-foreground": "#f3e8d3",
      "--success": "#7ba286",
      "--success-foreground": "#13291d",
      "--warning": "#cfab67",
      "--warning-foreground": "#13291d",
      "--border": "#31523f",
      "--border-hover": "#3f654f",
      "--input": "#173324",
      "--input-border": "#31523f",
      "--ring": "#cfab67",
      "--shell": "#142f22",
      "--shell-foreground": "#f3e8d3",
      "--shell-border": "#31523f",
      "--sidebar": "#12281c",
      "--sidebar-foreground": "#efe4cf",
      "--sidebar-primary": "#cfab67",
      "--sidebar-primary-foreground": "#13291d",
      "--sidebar-accent": "#1c3526",
      "--sidebar-accent-foreground": "#f3e8d3",
      "--sidebar-border": "#31523f",
      "--sidebar-ring": "#cfab67",
      "--chart-1": "#f3e8d3",
      "--chart-2": "#cfab67",
      "--chart-3": "#82927d",
      "--chart-4": "#7ba286",
      "--chart-5": "#b46f67",
      "--radius": "0.25rem",
      "--shadow-button": "0 1px 1px rgba(12, 29, 20, 0.42)",
      "--shadow-button-2": "0 2px 4px rgba(12, 29, 20, 0.46)",
      "--shadow-card": "0 10px 24px rgba(12, 29, 20, 0.34)",
      "--shadow-dropdown": "0 24px 52px rgba(12, 29, 20, 0.52)",
      "--motion-duration-fast": "120ms",
      "--motion-duration-medium": "180ms",
      "--motion-ease-standard": "cubic-bezier(0.2, 0.0, 0, 1)",
      "--font-sans-token":
        "\"Avenir Next\", \"Neue Haas Grotesk Text Pro\", \"SF Pro Text\", \"Helvetica Neue\", \"Arial\", sans-serif",
      "--font-serif-token":
        "\"Iowan Old Style\", \"Baskerville\", \"Palatino Linotype\", \"Times New Roman\", serif",
      "--font-mono-token":
        "\"JetBrains Mono\", \"SF Mono\", \"Fira Code\", \"Fira Mono\", \"Roboto Mono\", monospace",
      "--type-scale-body": "0.9375rem",
      "--type-scale-label": "0.8125rem",
      "--type-scale-h4": "1.125rem",
      "--type-scale-h3": "1.375rem",
      "--type-scale-h2": "1.75rem",
      "--type-scale-h1": "2.125rem",
    },
  },
  legal: {
    id: "legal",
    label: "Legal Ledger",
    light: {
      "--primary": "#1d3b2d",
      "--accent": "#dcc9a8",
      "--chart-4": "#b18e4e",
      "--radius": "0.25rem",
    },
    dark: {
      "--primary": "#c4a15f",
      "--accent": "#223728",
      "--chart-4": "#d3b16f",
      "--radius": "0.25rem",
    },
  },
  accounting: {
    id: "accounting",
    label: "Accounting Precision",
    light: {
      "--primary": "#224633",
      "--accent": "#d8c5a3",
      "--chart-4": "#9d7f49",
      "--radius": "0.375rem",
    },
    dark: {
      "--primary": "#be9b59",
      "--accent": "#1d3526",
      "--chart-4": "#d0ab67",
      "--radius": "0.375rem",
    },
  },
  gov: {
    id: "gov",
    label: "Gov Control",
    light: {
      "--primary": "#1f3a2a",
      "--accent": "#d5c19f",
      "--chart-4": "#8f7544",
      "--radius": "0.125rem",
    },
    dark: {
      "--primary": "#b69252",
      "--accent": "#1a2f22",
      "--chart-4": "#c8a364",
      "--radius": "0.125rem",
    },
  },
  construction: {
    id: "construction",
    label: "Construction Ops",
    light: {
      "--primary": "#2f4d3a",
      "--accent": "#d4c09f",
      "--chart-4": "#9e7c45",
      "--radius": "0.2rem",
    },
    dark: {
      "--primary": "#bc9857",
      "--accent": "#223728",
      "--chart-4": "#d2ad6a",
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
