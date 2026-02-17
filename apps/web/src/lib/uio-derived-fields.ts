const MONTH_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i;
const ISO_DATE_PATTERN = /\b20\d{2}-\d{2}-\d{2}\b/;
const NUMERIC_DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;

export interface ContactLike {
  id?: string | null;
  displayName?: string | null;
  primaryEmail?: string | null;
}

function normalizeDateCandidate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function todayAtMidnight(now: Date): Date {
  const value = new Date(now);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function inferDueDateFromText(
  text: string | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!text) {
    return null;
  }

  const normalized = text.trim();
  if (normalized.length === 0) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const today = todayAtMidnight(now);

  if (/\btomorrow\b/i.test(lower)) {
    const value = new Date(today);
    value.setDate(today.getDate() + 1);
    return value;
  }
  if (/\btoday\b/i.test(lower)) {
    return today;
  }

  const isoMatch = normalized.match(ISO_DATE_PATTERN);
  if (isoMatch?.[0]) {
    return normalizeDateCandidate(isoMatch[0]);
  }

  const numericMatch = normalized.match(NUMERIC_DATE_PATTERN);
  if (numericMatch?.[0]) {
    return normalizeDateCandidate(numericMatch[0]);
  }

  const monthMatch = normalized.match(MONTH_PATTERN);
  if (monthMatch?.[0]) {
    return normalizeDateCandidate(monthMatch[0]);
  }

  return null;
}

export function resolveDueDate(options: {
  explicitDueDate: string | Date | null | undefined;
  title?: string | null;
  description?: string | null;
  evidenceQuotes?: Array<string | null | undefined>;
}): Date | null {
  if (options.explicitDueDate instanceof Date) {
    return Number.isNaN(options.explicitDueDate.getTime())
      ? null
      : options.explicitDueDate;
  }
  if (typeof options.explicitDueDate === "string" && options.explicitDueDate) {
    const explicit = normalizeDateCandidate(options.explicitDueDate);
    if (explicit) {
      return explicit;
    }
  }

  const textCandidates = [
    options.title ?? null,
    options.description ?? null,
    ...(options.evidenceQuotes ?? []),
  ];
  for (const candidate of textCandidates) {
    const inferred = inferDueDateFromText(candidate);
    if (inferred) {
      return inferred;
    }
  }

  return null;
}

export function resolveContactDisplayName(
  contact: ContactLike | null | undefined,
  fallback = "Unknown"
): string {
  if (!contact) {
    return fallback;
  }

  const displayName = contact.displayName?.trim();
  if (displayName) {
    return displayName;
  }

  const email = contact.primaryEmail?.trim();
  if (email) {
    if (email.includes("@")) {
      const localPart = email.split("@")[0]?.trim();
      return localPart || email;
    }
    return email;
  }

  const id = contact.id?.trim();
  if (id) {
    return `Contact ${id.slice(-4).toUpperCase()}`;
  }

  return fallback;
}
