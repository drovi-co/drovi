import type {
  LocaleResources,
  SupportedLocale,
  TFunction,
} from "@memorystack/i18n";
import {
  baseResources,
  createTranslator,
  normalizeLocale,
} from "@memorystack/i18n";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type I18nContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: TFunction;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export type { LocaleResources, SupportedLocale, TFunction };
export { normalizeLocale };

export function I18nProvider({
  initialLocale,
  children,
  resources,
  onLocaleChange,
}: {
  initialLocale: SupportedLocale;
  children: ReactNode;
  resources?: LocaleResources;
  onLocaleChange?: (locale: SupportedLocale) => void;
}) {
  const [locale, setLocaleInternal] = useState<SupportedLocale>(
    normalizeLocale(initialLocale)
  );

  const setLocale = useCallback(
    (next: SupportedLocale) => {
      const normalized = normalizeLocale(next);
      setLocaleInternal(normalized);
      onLocaleChange?.(normalized);
    },
    [onLocaleChange]
  );

  const t = useMemo(
    () => createTranslator(locale, resources ?? baseResources),
    [locale, resources]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider />");
  }
  return ctx;
}

export function useT(): TFunction {
  return useI18n().t;
}
