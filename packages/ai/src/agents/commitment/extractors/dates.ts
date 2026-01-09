// =============================================================================
// DATE EXTRACTION UTILITY
// =============================================================================
//
// Extracts and parses due dates from commitment text.
//

import type { DueDateExtraction } from "../types";

/**
 * Common date patterns to match.
 */
const DATE_PATTERNS = {
  // Explicit dates
  isoDate: /\b(\d{4}-\d{2}-\d{2})\b/,
  usDate: /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/,
  euDate: /\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b/,
  writtenDate:
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i,
  shortWrittenDate:
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/i,

  // Relative dates
  tomorrow: /\btomorrow\b/i,
  today: /\btoday\b/i,
  nextWeek: /\bnext\s+week\b/i,
  thisWeek: /\bthis\s+week\b/i,
  endOfWeek: /\b(?:end\s+of\s+(?:the\s+)?week|EOW)\b/i,
  endOfMonth: /\b(?:end\s+of\s+(?:the\s+)?month|EOM)\b/i,
  endOfDay: /\b(?:end\s+of\s+(?:the\s+)?day|EOD)\b/i,
  nextMonth: /\bnext\s+month\b/i,

  // Day of week
  dayOfWeek:
    /\b(?:next\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
  byDay: /\bby\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,

  // Relative with number
  inNDays: /\bin\s+(\d+)\s+days?\b/i,
  inNWeeks: /\bin\s+(\d+)\s+weeks?\b/i,
  inNMonths: /\bin\s+(\d+)\s+months?\b/i,
  withinNDays: /\bwithin\s+(\d+)\s+days?\b/i,

  // Urgency indicators (no specific date)
  asap: /\b(?:ASAP|as\s+soon\s+as\s+possible)\b/i,
  immediately: /\b(?:immediately|right\s+away|urgently)\b/i,
  noRush:
    /\b(?:no\s+rush|when\s+you\s+(?:get|have)\s+(?:a\s+)?chance|whenever)\b/i,
};

/**
 * Month name to number mapping.
 */
const MONTH_MAP: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/**
 * Day name to offset mapping (0 = Sunday).
 */
const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Extract due date from text.
 */
export function extractDueDate(
  text: string,
  referenceDate: Date = new Date()
): DueDateExtraction | undefined {
  // Try explicit dates first (highest confidence)
  const explicitResult = tryExplicitDate(text, referenceDate);
  if (explicitResult) {
    return explicitResult;
  }

  // Try relative dates
  const relativeResult = tryRelativeDate(text, referenceDate);
  if (relativeResult) {
    return relativeResult;
  }

  // Try urgency indicators (lowest confidence, no specific date)
  const urgencyResult = tryUrgencyIndicator(text, referenceDate);
  if (urgencyResult) {
    return urgencyResult;
  }

  return undefined;
}

/**
 * Try to extract explicit date from text.
 */
function tryExplicitDate(
  text: string,
  _referenceDate: Date
): DueDateExtraction | undefined {
  // ISO date
  const isoMatch = text.match(DATE_PATTERNS.isoDate);
  if (isoMatch?.[1]) {
    const date = new Date(isoMatch[1]);
    if (!Number.isNaN(date.getTime())) {
      return {
        date: date.toISOString(),
        confidence: 0.95,
        source: "explicit",
        originalText: isoMatch[0],
        isRelative: false,
      };
    }
  }

  // US date (MM/DD/YYYY)
  const usMatch = text.match(DATE_PATTERNS.usDate);
  if (usMatch?.[1]) {
    const parts = usMatch[1].split("/");
    if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
      const month = Number.parseInt(parts[0], 10) - 1;
      const day = Number.parseInt(parts[1], 10);
      let year = Number.parseInt(parts[2], 10);
      if (year < 100) year += 2000;

      const date = new Date(year, month, day);
      if (!Number.isNaN(date.getTime())) {
        return {
          date: date.toISOString(),
          confidence: 0.9,
          source: "explicit",
          originalText: usMatch[0],
          isRelative: false,
        };
      }
    }
  }

  // Written date (January 15, 2024)
  const writtenMatch =
    text.match(DATE_PATTERNS.writtenDate) ||
    text.match(DATE_PATTERNS.shortWrittenDate);
  if (writtenMatch?.[1] && writtenMatch[2]) {
    const month = MONTH_MAP[writtenMatch[1].toLowerCase()];
    const day = Number.parseInt(writtenMatch[2], 10);
    const year = writtenMatch[3]
      ? Number.parseInt(writtenMatch[3], 10)
      : new Date().getFullYear();

    if (month !== undefined) {
      const date = new Date(year, month, day);
      if (!Number.isNaN(date.getTime())) {
        return {
          date: date.toISOString(),
          confidence: 0.9,
          source: "explicit",
          originalText: writtenMatch[0],
          isRelative: false,
        };
      }
    }
  }

  return undefined;
}

/**
 * Try to extract relative date from text.
 */
function tryRelativeDate(
  text: string,
  referenceDate: Date
): DueDateExtraction | undefined {
  const ref = new Date(referenceDate);

  // Tomorrow
  if (DATE_PATTERNS.tomorrow.test(text)) {
    const date = new Date(ref);
    date.setDate(date.getDate() + 1);
    return {
      date: date.toISOString(),
      confidence: 0.9,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.tomorrow)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // Today / EOD
  if (DATE_PATTERNS.today.test(text) || DATE_PATTERNS.endOfDay.test(text)) {
    const date = new Date(ref);
    date.setHours(17, 0, 0, 0); // End of business day
    return {
      date: date.toISOString(),
      confidence: 0.85,
      source: "inferred",
      originalText:
        text.match(DATE_PATTERNS.today)?.[0] ||
        text.match(DATE_PATTERNS.endOfDay)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // End of week
  if (DATE_PATTERNS.endOfWeek.test(text)) {
    const date = new Date(ref);
    const dayOfWeek = date.getDay();
    const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 0;
    date.setDate(date.getDate() + daysUntilFriday);
    return {
      date: date.toISOString(),
      confidence: 0.8,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.endOfWeek)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // Next week
  if (DATE_PATTERNS.nextWeek.test(text)) {
    const date = new Date(ref);
    date.setDate(date.getDate() + 7);
    return {
      date: date.toISOString(),
      confidence: 0.7,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.nextWeek)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // This week
  if (DATE_PATTERNS.thisWeek.test(text)) {
    const date = new Date(ref);
    const dayOfWeek = date.getDay();
    const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 0;
    date.setDate(date.getDate() + daysUntilFriday);
    return {
      date: date.toISOString(),
      confidence: 0.75,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.thisWeek)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // End of month
  if (DATE_PATTERNS.endOfMonth.test(text)) {
    const date = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    return {
      date: date.toISOString(),
      confidence: 0.8,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.endOfMonth)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // Next month
  if (DATE_PATTERNS.nextMonth.test(text)) {
    const date = new Date(ref);
    date.setMonth(date.getMonth() + 1);
    return {
      date: date.toISOString(),
      confidence: 0.6,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.nextMonth)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // Day of week (by Friday, next Monday)
  const dayMatch =
    text.match(DATE_PATTERNS.byDay) || text.match(DATE_PATTERNS.dayOfWeek);
  if (dayMatch?.[1]) {
    const targetDay = DAY_MAP[dayMatch[1].toLowerCase()];
    if (targetDay !== undefined) {
      const date = new Date(ref);
      const currentDay = date.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7; // Next occurrence
      if (text.toLowerCase().includes("next")) daysUntil += 7;
      date.setDate(date.getDate() + daysUntil);
      return {
        date: date.toISOString(),
        confidence: 0.85,
        source: "inferred",
        originalText: dayMatch[0],
        isRelative: true,
        relativeBase: referenceDate.toISOString(),
      };
    }
  }

  // In N days/weeks/months
  const inDaysMatch = text.match(DATE_PATTERNS.inNDays);
  if (inDaysMatch?.[1]) {
    const days = Number.parseInt(inDaysMatch[1], 10);
    const date = new Date(ref);
    date.setDate(date.getDate() + days);
    return {
      date: date.toISOString(),
      confidence: 0.85,
      source: "inferred",
      originalText: inDaysMatch[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  const inWeeksMatch = text.match(DATE_PATTERNS.inNWeeks);
  if (inWeeksMatch?.[1]) {
    const weeks = Number.parseInt(inWeeksMatch[1], 10);
    const date = new Date(ref);
    date.setDate(date.getDate() + weeks * 7);
    return {
      date: date.toISOString(),
      confidence: 0.8,
      source: "inferred",
      originalText: inWeeksMatch[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  const inMonthsMatch = text.match(DATE_PATTERNS.inNMonths);
  if (inMonthsMatch?.[1]) {
    const months = Number.parseInt(inMonthsMatch[1], 10);
    const date = new Date(ref);
    date.setMonth(date.getMonth() + months);
    return {
      date: date.toISOString(),
      confidence: 0.7,
      source: "inferred",
      originalText: inMonthsMatch[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  const withinDaysMatch = text.match(DATE_PATTERNS.withinNDays);
  if (withinDaysMatch?.[1]) {
    const days = Number.parseInt(withinDaysMatch[1], 10);
    const date = new Date(ref);
    date.setDate(date.getDate() + days);
    return {
      date: date.toISOString(),
      confidence: 0.7,
      source: "inferred",
      originalText: withinDaysMatch[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  return undefined;
}

/**
 * Try to extract urgency indicator (no specific date).
 */
function tryUrgencyIndicator(
  text: string,
  referenceDate: Date
): DueDateExtraction | undefined {
  const ref = new Date(referenceDate);

  // ASAP - assume end of next business day
  if (DATE_PATTERNS.asap.test(text)) {
    const date = new Date(ref);
    date.setDate(date.getDate() + 1);
    // Skip to Monday if weekend
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
    return {
      date: date.toISOString(),
      confidence: 0.5,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.asap)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // Immediately - assume today
  if (DATE_PATTERNS.immediately.test(text)) {
    const date = new Date(ref);
    date.setHours(17, 0, 0, 0);
    return {
      date: date.toISOString(),
      confidence: 0.6,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.immediately)?.[0],
      isRelative: true,
      relativeBase: referenceDate.toISOString(),
    };
  }

  // No rush - no specific date, low confidence
  if (DATE_PATTERNS.noRush.test(text)) {
    return {
      confidence: 0.2,
      source: "inferred",
      originalText: text.match(DATE_PATTERNS.noRush)?.[0],
      isRelative: false,
    };
  }

  return undefined;
}

/**
 * Merge LLM-extracted date with heuristic extraction.
 */
export function mergeDateExtractions(
  llmDate: { date?: string; confidence?: number; text?: string } | undefined,
  heuristicDate: DueDateExtraction | undefined
): DueDateExtraction | undefined {
  // If LLM provided a date with high confidence, prefer it
  if (llmDate?.date && (llmDate.confidence ?? 0) > 0.7) {
    return {
      date: llmDate.date,
      confidence: llmDate.confidence ?? 0.8,
      source: "explicit",
      originalText: llmDate.text,
      isRelative: false,
    };
  }

  // If heuristic found a date, use it
  if (heuristicDate) {
    return heuristicDate;
  }

  // Fall back to LLM date if available
  if (llmDate?.date) {
    return {
      date: llmDate.date,
      confidence: llmDate.confidence ?? 0.5,
      source: "inferred",
      originalText: llmDate.text,
      isRelative: false,
    };
  }

  return undefined;
}
