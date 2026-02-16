/**
 * Safe Date Utilities
 *
 * Prevents "Invalid Date" and "RangeError" exceptions when dealing
 * with potentially null/undefined/malformed date values from the API.
 */

/**
 * Safely parse a date value, returning null for invalid inputs.
 */
export function safeParseDate(
  value: string | Date | null | undefined
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  try {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Format a date value, returning a fallback string for invalid inputs.
 */
export function formatDate(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback = "Unknown"
): string {
  const d = safeParseDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(undefined, options);
}

/**
 * Format a date as a relative time string (e.g., "2 days ago").
 */
export function formatRelativeDate(
  value: string | Date | null | undefined,
  fallback = "Unknown"
): string {
  const d = safeParseDate(value);
  if (!d) return fallback;

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    // Future dates
    const absDays = Math.abs(diffDays);
    if (absDays === 0) return "Today";
    if (absDays === 1) return "Tomorrow";
    if (absDays < 7) return `In ${absDays} days`;
    if (absDays < 30) return `In ${Math.floor(absDays / 7)} weeks`;
    return formatDate(d, { month: "short", day: "numeric", year: "numeric" });
  }

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return formatDate(d, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Format a date for display in cards/lists (short format).
 */
export function formatShortDate(
  value: string | Date | null | undefined,
  fallback = ""
): string {
  const d = safeParseDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Format a date for display with time.
 */
export function formatDateTime(
  value: string | Date | null | undefined,
  fallback = "Unknown"
): string {
  const d = safeParseDate(value);
  if (!d) return fallback;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Check if a date is in the past.
 */
export function isPast(value: string | Date | null | undefined): boolean {
  const d = safeParseDate(value);
  if (!d) return false;
  return d.getTime() < Date.now();
}

/**
 * Check if a date is overdue (in the past and not today).
 */
export function isOverdue(value: string | Date | null | undefined): boolean {
  const d = safeParseDate(value);
  if (!d) return false;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  return dateOnly.getTime() < today.getTime();
}

/**
 * Format a due date with urgency context.
 */
export function formatDueDate(
  value: string | Date | null | undefined,
  fallback = "No due date"
): { text: string; isOverdue: boolean; isToday: boolean; isSoon: boolean } {
  const d = safeParseDate(value);
  if (!d) {
    return { text: fallback, isOverdue: false, isToday: false, isSoon: false };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor(
    (dateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  const isOverdue = diffDays < 0;
  const isToday = diffDays === 0;
  const isSoon = diffDays > 0 && diffDays <= 3;

  let text: string;
  if (isToday) {
    text = "Due today";
  } else if (diffDays === 1) {
    text = "Due tomorrow";
  } else if (diffDays === -1) {
    text = "Due yesterday";
  } else if (isOverdue) {
    text = `${Math.abs(diffDays)} days overdue`;
  } else if (diffDays <= 7) {
    text = `Due in ${diffDays} days`;
  } else {
    text = `Due ${formatShortDate(d)}`;
  }

  return { text, isOverdue, isToday, isSoon };
}
