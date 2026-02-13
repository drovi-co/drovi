import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_CONSOLE_NAMESPACE = "mod_console";

export const modConsoleMessages: Record<string, string> = {
  "console.title": "Console",
  "console.ops": "Operations",
  "console.internal": "Internal only",
};

export const modConsoleI18n: ModuleI18nNamespace = {
  namespace: MOD_CONSOLE_NAMESPACE,
  defaultLocale: "en",
  messages: modConsoleMessages,
};
