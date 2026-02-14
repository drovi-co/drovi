export type RelativeTimeUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year";

/**
 * Locale-aware relative time formatting using Intl.RelativeTimeFormat.
 *
 * This avoids English-only date-fns defaults and respects the UI locale.
 */
export function formatRelativeTime(
  date: Date,
  locale: string,
  options?: { now?: Date }
): string {
  const now = options?.now ?? new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSeconds = Math.round(diffMs / 1000);

  const absSeconds = Math.abs(diffSeconds);
  let value: number;
  let unit: RelativeTimeUnit;

  if (absSeconds < 60) {
    value = diffSeconds;
    unit = "second";
  } else {
    const diffMinutes = Math.round(diffSeconds / 60);
    const absMinutes = Math.abs(diffMinutes);
    if (absMinutes < 60) {
      value = diffMinutes;
      unit = "minute";
    } else {
      const diffHours = Math.round(diffMinutes / 60);
      const absHours = Math.abs(diffHours);
      if (absHours < 24) {
        value = diffHours;
        unit = "hour";
      } else {
        const diffDays = Math.round(diffHours / 24);
        const absDays = Math.abs(diffDays);
        if (absDays < 7) {
          value = diffDays;
          unit = "day";
        } else if (absDays < 30) {
          value = Math.round(diffDays / 7);
          unit = "week";
        } else if (absDays < 365) {
          value = Math.round(diffDays / 30);
          unit = "month";
        } else {
          value = Math.round(diffDays / 365);
          unit = "year";
        }
      }
    }
  }

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return rtf.format(value, unit);
  } catch {
    // Best-effort fallback. Keep it readable if Intl fails for any reason.
    const abs = Math.abs(value);
    const suffix = value < 0 ? "ago" : "from now";
    return `${abs} ${unit}${abs === 1 ? "" : "s"} ${suffix}`;
  }
}
