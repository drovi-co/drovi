import en from "./locales/en.json";
import fr from "./locales/fr.json";

export type SupportedLocale = "en" | "fr";

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  "en",
  "fr",
] as const;

export type TranslationParams = Record<
  string,
  string | number | boolean | null | undefined
>;

type TranslationLeaf = string;
type TranslationNode = { [key: string]: TranslationLeaf | TranslationNode };

export type LocaleResources = Record<SupportedLocale, TranslationNode>;

export const baseResources: LocaleResources = {
  en: en as TranslationNode,
  fr: fr as TranslationNode,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepGet(root: TranslationNode, key: string): unknown {
  if (!key) return undefined;
  const parts = key.split(".");
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function interpolate(
  template: string,
  params: TranslationParams | undefined
): string {
  if (!params) return template;
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, name: string) => {
      const value = params[name];
      if (value === null || value === undefined) return "";
      return String(value);
    }
  );
}

export function normalizeLocale(
  input: string | null | undefined
): SupportedLocale {
  const raw = (input || "").trim().toLowerCase();
  if (raw.startsWith("fr")) return "fr";
  return "en";
}

export type TFunction = (key: string, params?: TranslationParams) => string;

export function createTranslator(
  locale: SupportedLocale,
  resources: LocaleResources = baseResources
): TFunction {
  const normalized = normalizeLocale(locale);
  return (key: string, params?: TranslationParams) => {
    const primary = deepGet(resources[normalized], key);
    if (typeof primary === "string") {
      return interpolate(primary, params);
    }

    const fallback = deepGet(resources.en, key);
    if (typeof fallback === "string") {
      return interpolate(fallback, params);
    }

    return key;
  };
}
