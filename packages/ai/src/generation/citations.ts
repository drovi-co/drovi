// =============================================================================
// CITATION HANDLING (PRD-08)
// =============================================================================
//
// Utilities for managing citations in grounded email drafts.
//

import type { Citation } from "../prompts/drafting/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface CitationSource {
  id: string;
  type: "thread" | "message" | "decision" | "commitment";
  title?: string;
  content: string;
  date?: Date;
  author?: string;
}

export interface CitationValidation {
  isValid: boolean;
  citation: Citation;
  source?: CitationSource;
  error?: string;
}

export interface FormattedCitation {
  id: string;
  marker: string;
  reference: string;
  tooltip: string;
}

// =============================================================================
// CITATION EXTRACTION
// =============================================================================

/**
 * Extract citation markers from text.
 * Returns array of citation IDs found in [N] format.
 */
export function extractCitationMarkers(text: string): string[] {
  const markerPattern = /\[(\d+)\]/g;
  const markers: string[] = [];
  let match = markerPattern.exec(text);

  while (match !== null) {
    const marker = match[1];
    if (marker) {
      markers.push(marker);
    }
    match = markerPattern.exec(text);
  }

  return Array.from(new Set(markers)); // Remove duplicates
}

/**
 * Count citations in text.
 */
export function countCitations(text: string): number {
  return extractCitationMarkers(text).length;
}

// =============================================================================
// CITATION VALIDATION
// =============================================================================

/**
 * Validate citations against available sources.
 */
export function validateCitations(
  citations: Citation[],
  sources: CitationSource[]
): CitationValidation[] {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  return citations.map((citation) => {
    const source = sourceMap.get(citation.sourceId);

    if (!source) {
      return {
        isValid: false,
        citation,
        error: `Source not found: ${citation.sourceId}`,
      };
    }

    // Verify the quoted text exists in source (fuzzy match)
    const normalizedQuote = normalizeText(citation.quotedText);
    const normalizedContent = normalizeText(source.content);

    if (!normalizedContent.includes(normalizedQuote.slice(0, 50))) {
      return {
        isValid: false,
        citation,
        source,
        error: "Quoted text not found in source",
      };
    }

    return {
      isValid: true,
      citation,
      source,
    };
  });
}

/**
 * Check if all citations in text are valid.
 */
export function checkCitationsComplete(
  text: string,
  citations: Citation[]
): { complete: boolean; missing: string[] } {
  const markers = extractCitationMarkers(text);
  const citationIds = new Set(citations.map((c) => c.id));

  const missing = markers.filter((m) => !citationIds.has(m));

  return {
    complete: missing.length === 0,
    missing,
  };
}

// =============================================================================
// CITATION FORMATTING
// =============================================================================

/**
 * Format citations for display.
 */
export function formatCitations(
  citations: Citation[],
  sources: CitationSource[]
): FormattedCitation[] {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));

  return citations.map((citation) => {
    const source = sourceMap.get(citation.sourceId);

    const reference = formatReference(citation, source);
    const tooltip = formatTooltip(citation, source);

    return {
      id: citation.id,
      marker: `[${citation.id}]`,
      reference,
      tooltip,
    };
  });
}

/**
 * Format a citation reference for footnote display.
 */
function formatReference(citation: Citation, source?: CitationSource): string {
  if (!source) {
    return `[${citation.id}] (source unavailable)`;
  }

  const dateStr = source.date
    ? source.date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  switch (citation.sourceType) {
    case "thread":
      return `[${citation.id}] Thread: "${source.title ?? "Untitled"}" - ${dateStr}`;

    case "message":
      return `[${citation.id}] ${source.author ?? "Unknown"}, ${dateStr}`;

    case "decision":
      return `[${citation.id}] Decision: "${source.title ?? "Untitled"}" - ${dateStr}`;

    case "commitment":
      return `[${citation.id}] Commitment: "${source.title ?? "Untitled"}"`;

    default:
      return `[${citation.id}] ${source.title ?? "Source"}`;
  }
}

/**
 * Format tooltip content for citation hover.
 */
function formatTooltip(citation: Citation, source?: CitationSource): string {
  if (!source) {
    return "Source not available";
  }

  const quoted =
    citation.quotedText.length > 150
      ? `${citation.quotedText.slice(0, 150)}...`
      : citation.quotedText;

  return `"${quoted}"${citation.context ? `\n\n${citation.context}` : ""}`;
}

// =============================================================================
// CITATION INSERTION
// =============================================================================

/**
 * Insert citation markers into text at appropriate positions.
 */
export function insertCitationMarkers(
  text: string,
  citations: Array<{
    quotedText: string;
    citationId: string;
  }>
): string {
  let result = text;

  for (const citation of citations) {
    // Find the best position to insert the citation
    const insertPosition = findCitationPosition(result, citation.quotedText);

    if (insertPosition >= 0) {
      result =
        result.slice(0, insertPosition) +
        ` [${citation.citationId}]` +
        result.slice(insertPosition);
    }
  }

  return result;
}

/**
 * Find the best position to insert a citation marker.
 */
function findCitationPosition(text: string, quotedText: string): number {
  // Try to find exact match first
  const normalizedQuote = normalizeText(quotedText);
  // Note: we currently use sentence-based matching instead of a direct
  // normalizedQuote-in-normalizedText match for better robustness.

  // Find sentences or phrases that might reference the quote
  const sentences = text.split(/(?<=[.!?])\s+/);
  let position = 0;

  for (const sentence of sentences) {
    const normalizedSentence = normalizeText(sentence);

    // Check if sentence contains key words from the quote
    const quoteWords = normalizedQuote.split(/\s+/).filter((w) => w.length > 4);
    const matchCount = quoteWords.filter((w) =>
      normalizedSentence.includes(w)
    ).length;

    if (matchCount >= quoteWords.length * 0.5) {
      // Found a good match - insert at end of sentence
      return position + sentence.length;
    }

    position += sentence.length + 1; // +1 for space
  }

  return -1; // No good position found
}

// =============================================================================
// CITATION MERGING
// =============================================================================

/**
 * Merge overlapping citations.
 */
export function mergeCitations(citations: Citation[]): Citation[] {
  if (citations.length <= 1) {
    return citations;
  }

  const sorted = [...citations].sort((a, b) => Number(a.id) - Number(b.id));
  const merged: Citation[] = [];

  for (const citation of sorted) {
    const existing = merged.find(
      (m) =>
        m.sourceId === citation.sourceId &&
        normalizeText(m.quotedText).includes(
          normalizeText(citation.quotedText).slice(0, 30)
        )
    );

    if (existing) {
      // Extend existing citation if this one has more context
      if (citation.quotedText.length > existing.quotedText.length) {
        existing.quotedText = citation.quotedText;
      }
      if (citation.context && !existing.context) {
        existing.context = citation.context;
      }
    } else {
      merged.push({ ...citation });
    }
  }

  // Renumber citations
  return merged.map((c, i) => ({ ...c, id: String(i + 1) }));
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize text for comparison.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate a citation from source.
 */
export function createCitation(
  id: string,
  source: CitationSource,
  quotedText: string,
  context?: string
): Citation {
  return {
    id,
    sourceType: source.type,
    sourceId: source.id,
    quotedText,
    context,
  };
}

/**
 * Remove all citation markers from text.
 */
export function stripCitations(text: string): string {
  return text.replace(/\s*\[\d+\]/g, "");
}

/**
 * Get citation statistics.
 */
export function getCitationStats(
  text: string,
  citations: Citation[]
): {
  totalMarkers: number;
  uniqueCitations: number;
  byType: Record<string, number>;
  avgQuoteLength: number;
} {
  const markers = extractCitationMarkers(text);

  const byType: Record<string, number> = {};
  let totalQuoteLength = 0;

  for (const citation of citations) {
    byType[citation.sourceType] = (byType[citation.sourceType] ?? 0) + 1;
    totalQuoteLength += citation.quotedText.length;
  }

  return {
    totalMarkers: markers.length,
    uniqueCitations: citations.length,
    byType,
    avgQuoteLength:
      citations.length > 0 ? totalQuoteLength / citations.length : 0,
  };
}
