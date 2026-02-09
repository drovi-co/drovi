import { useEffect } from "react";

import { useAuthStore } from "@/lib/auth";
import { normalizeLocale, useI18n } from "@/i18n";

/**
 * Keep the UI locale aligned with backend preferences.
 *
 * Priority:
 * 1) user.locale (explicit user override)
 * 2) org_default_locale (org setting)
 * 3) current UI locale (localStorage / browser default)
 */
export function BackendLocaleSync() {
  const userLocale = useAuthStore((s) => s.user?.locale);
  const orgDefaultLocale = useAuthStore((s) => s.user?.org_default_locale);
  const { locale, setLocale } = useI18n();

  useEffect(() => {
    const next = normalizeLocale(userLocale || orgDefaultLocale || locale);
    if (next !== locale) {
      setLocale(next);
    }
  }, [locale, orgDefaultLocale, setLocale, userLocale]);

  return null;
}

