// =============================================================================
// REPLY GENERATION (PRD-08)
// =============================================================================
//
// Core reply drafting logic with context integration.
//

import type {
  CommitmentContext,
  ConsistencyCheck,
  DraftContext,
  DraftReply,
  HistoricalContext,
  RelationshipContext,
  ThreadContext,
} from "../prompts/drafting/index.js";
import { type CitationSource, validateCitations } from "./citations.js";
import {
  analyzeToneFromSamples,
  getDefaultToneProfile,
  type ToneProfile,
} from "./tone.js";

// =============================================================================
// TYPES
// =============================================================================

export interface DraftRequest {
  threadId: string;
  userIntent: string;
  options?: DraftOptions;
}

export interface DraftOptions {
  tone?: "formal" | "professional" | "casual" | "friendly";
  length?: "brief" | "standard" | "detailed";
  includeGreeting?: boolean;
  includeSignoff?: boolean;
  citationLevel?: "minimal" | "standard" | "thorough";
  forceToneMatch?: boolean;
}

export interface DraftResult {
  draft: DraftReply;
  context: DraftContext;
  toneProfile?: ToneProfile;
  consistencyCheck?: ConsistencyCheck;
  citationSources: CitationSource[];
}

export interface ContextSources {
  threadId: string;
  accountId: string;
  organizationId: string;
}

// =============================================================================
// CONTEXT BUILDING
// =============================================================================

/**
 * Build complete draft context from various sources.
 */
export function buildDraftContext(
  thread: ThreadContext,
  relationship: RelationshipContext | undefined,
  history: HistoricalContext | undefined,
  commitments: CommitmentContext | undefined,
  userIntent: string,
  userToneSamples?: string[]
): DraftContext {
  return {
    thread,
    relationship,
    history,
    commitments,
    userIntent,
    userToneSamples,
  };
}

/**
 * Extract citation sources from context.
 */
export function extractCitationSources(
  context: DraftContext
): CitationSource[] {
  const sources: CitationSource[] = [];

  // Add thread as source
  sources.push({
    id: `thread:${context.thread.id}`,
    type: "thread",
    title: context.thread.subject,
    content: context.thread.messages.map((m) => m.bodyText).join("\n\n"),
    date: context.thread.messages[0]?.date,
  });

  // Add messages as sources
  for (const message of context.thread.messages) {
    sources.push({
      id: `message:${message.id}`,
      type: "message",
      title: `Message from ${message.fromName ?? message.from}`,
      content: message.bodyText,
      date: message.date,
      author: message.fromName ?? message.from,
    });
  }

  // Add claims as potential sources
  for (const claim of context.thread.claims) {
    if (claim.messageId) {
      // Claims link to their source message
      const existingSource = sources.find(
        (s) => s.id === `message:${claim.messageId}`
      );
      if (existingSource) {
      }
    }
  }

  // Add decisions from history
  if (context.history?.decisions) {
    for (const decision of context.history.decisions) {
      sources.push({
        id: `decision:${decision.id}`,
        type: "decision",
        title: decision.title,
        content: decision.statement,
        date: decision.decidedAt,
      });
    }
  }

  // Add commitments
  if (context.commitments?.openCommitments) {
    for (const commitment of context.commitments.openCommitments) {
      sources.push({
        id: `commitment:${commitment.id}`,
        type: "commitment",
        title: commitment.title,
        content: commitment.title,
        date: commitment.dueDate,
      });
    }
  }

  return sources;
}

// =============================================================================
// DRAFT POST-PROCESSING
// =============================================================================

/**
 * Post-process a draft to validate and enhance it.
 */
export function postProcessDraft(
  draft: DraftReply,
  sources: CitationSource[],
  toneProfile?: ToneProfile,
  options?: DraftOptions
): DraftReply {
  const processedDraft = { ...draft };

  // Validate citations
  const validations = validateCitations(draft.citations, sources);
  const validCitations = validations
    .filter((v) => v.isValid)
    .map((v) => v.citation);
  const invalidCitations = validations.filter((v) => !v.isValid);

  if (invalidCitations.length > 0) {
    processedDraft.warnings = processedDraft.warnings ?? [];
    processedDraft.warnings.push(
      `${invalidCitations.length} citation(s) could not be verified`
    );
    processedDraft.citations = validCitations;
  }

  // Add greeting if requested and missing
  if (options?.includeGreeting !== false && !hasGreeting(processedDraft.body)) {
    const greeting = selectGreeting(toneProfile);
    processedDraft.body = `${greeting}\n\n${processedDraft.body}`;
  }

  // Add signoff if requested and missing
  if (options?.includeSignoff !== false && !hasSignoff(processedDraft.body)) {
    const signoff = selectSignoff(toneProfile);
    processedDraft.body = `${processedDraft.body}\n\n${signoff}`;
  }

  // Adjust length if needed
  if (options?.length) {
    processedDraft.body = adjustLength(processedDraft.body, options.length);
  }

  return processedDraft;
}

/**
 * Check if text has a greeting.
 */
function hasGreeting(text: string): boolean {
  const greetingPatterns = [
    /^(Hi|Hello|Hey|Dear|Good morning|Good afternoon|Good evening)/im,
  ];
  return greetingPatterns.some((p) => p.test(text));
}

/**
 * Check if text has a signoff.
 */
function hasSignoff(text: string): boolean {
  const signoffPatterns = [
    /(Best regards?|Kind regards?|Thanks|Thank you|Cheers|Sincerely|Best|Warmly)[,.]?\s*$/im,
  ];
  return signoffPatterns.some((p) => p.test(text));
}

/**
 * Select appropriate greeting based on tone.
 */
function selectGreeting(toneProfile?: ToneProfile): string {
  if (toneProfile?.greetings.length) {
    return `${toneProfile.greetings[0]},`;
  }

  const tone = toneProfile?.primaryTone ?? "professional";
  switch (tone) {
    case "formal":
      return "Dear Sir/Madam,";
    case "professional":
      return "Hello,";
    case "casual":
      return "Hi,";
    case "friendly":
      return "Hey!";
    default:
      return "Hello,";
  }
}

/**
 * Select appropriate signoff based on tone.
 */
function selectSignoff(toneProfile?: ToneProfile): string {
  if (toneProfile?.signoffs.length) {
    return `${toneProfile.signoffs[0]},\n[Your Name]`;
  }

  const tone = toneProfile?.primaryTone ?? "professional";
  switch (tone) {
    case "formal":
      return "Sincerely,\n[Your Name]";
    case "professional":
      return "Best regards,\n[Your Name]";
    case "casual":
      return "Thanks,\n[Your Name]";
    case "friendly":
      return "Cheers!";
    default:
      return "Best,\n[Your Name]";
  }
}

/**
 * Adjust text length.
 */
function adjustLength(
  text: string,
  targetLength: "brief" | "standard" | "detailed"
): string {
  const sentences = text.split(/(?<=[.!?])\s+/);

  switch (targetLength) {
    case "brief":
      // Keep essential sentences only
      if (sentences.length > 3) {
        return sentences.slice(0, 3).join(" ");
      }
      return text;

    case "detailed":
      // Already detailed or needs LLM to expand
      return text;
    default:
      return text;
  }
}

// =============================================================================
// CONSISTENCY CHECKING
// =============================================================================

/**
 * Build historical statements for consistency check.
 */
export function buildHistoricalStatements(
  context: DraftContext
): Array<{ id: string; text: string; source: string; date: Date }> {
  const statements: Array<{
    id: string;
    text: string;
    source: string;
    date: Date;
  }> = [];

  // Add claims from thread
  for (const claim of context.thread.claims) {
    if (claim.type === "promise" || claim.type === "decision") {
      const message = context.thread.messages.find(
        (m) => m.id === claim.messageId
      );
      statements.push({
        id: claim.id,
        text: claim.text,
        source: `Thread: ${context.thread.subject}`,
        date: message?.date ?? new Date(),
      });
    }
  }

  // Add decisions from history
  if (context.history?.decisions) {
    for (const decision of context.history.decisions) {
      statements.push({
        id: decision.id,
        text: decision.statement,
        source: `Decision: ${decision.title}`,
        date: decision.decidedAt,
      });
    }
  }

  // Add commitments
  if (context.commitments?.openCommitments) {
    for (const commitment of context.commitments.openCommitments) {
      statements.push({
        id: commitment.id,
        text: commitment.title,
        source: `Commitment: ${commitment.title}`,
        date: commitment.dueDate ?? new Date(),
      });
    }
  }

  return statements;
}

/**
 * Simple rule-based consistency check.
 */
export function checkConsistencyRules(
  draft: string,
  statements: Array<{ id: string; text: string; source: string; date: Date }>
): ConsistencyCheck {
  const conflicts: ConsistencyCheck["conflicts"] = [];

  // Check for common contradiction patterns
  const draftLower = draft.toLowerCase();

  for (const statement of statements) {
    const statementLower = statement.text.toLowerCase();

    // Check for direct negation
    if (
      statementLower.includes("will") &&
      draftLower.includes("won't") &&
      hasOverlappingContent(statementLower, draftLower)
    ) {
      conflicts.push({
        draftStatement: extractRelevantSentence(draft, "won't"),
        conflictingSource: statement.text,
        sourceId: statement.id,
        severity: "warning",
        suggestion:
          "Review this statement for consistency with prior commitment",
      });
    }

    // Check for date conflicts
    const draftDates = extractDates(draft);
    const statementDates = extractDates(statement.text);
    const firstDraftDate = draftDates[0];
    if (
      draftDates.length > 0 &&
      statementDates.length > 0 &&
      firstDraftDate &&
      hasDateConflict(draftDates, statementDates)
    ) {
      conflicts.push({
        draftStatement: extractRelevantSentence(draft, firstDraftDate),
        conflictingSource: statement.text,
        sourceId: statement.id,
        severity: "info",
        suggestion: "Verify the dates mentioned are consistent",
      });
    }
  }

  return {
    isConsistent: conflicts.length === 0,
    conflicts,
    score:
      conflicts.length === 0 ? 1 : Math.max(0.5, 1 - conflicts.length * 0.2),
  };
}

/**
 * Check if two texts have overlapping content.
 */
function hasOverlappingContent(text1: string, text2: string): boolean {
  const words1 = text1.split(/\s+/).filter((w) => w.length > 4);
  const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 4));

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      overlap++;
    }
  }

  return overlap >= 2;
}

/**
 * Extract dates from text.
 */
function extractDates(text: string): string[] {
  const datePatterns = [
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g,
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/gi,
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/gi,
  ];

  const dates: string[] = [];
  for (const pattern of datePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      dates.push(...matches);
    }
  }

  return dates;
}

/**
 * Check if dates might conflict.
 */
function hasDateConflict(dates1: string[], dates2: string[]): boolean {
  // Simple check - different specific dates mentioned
  for (const d1 of dates1) {
    for (const d2 of dates2) {
      if (
        d1.toLowerCase() !== d2.toLowerCase() &&
        isSpecificDate(d1) &&
        isSpecificDate(d2)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a date string is specific (not just a day of week).
 */
function isSpecificDate(date: string): boolean {
  return /\d/.test(date);
}

/**
 * Extract the sentence containing a keyword.
 */
function extractRelevantSentence(text: string, keyword: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const keywordLower = keyword.toLowerCase();

  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(keywordLower)) {
      return sentence.trim();
    }
  }

  return `${text.slice(0, 100)}...`;
}

// =============================================================================
// TONE PROFILE INTEGRATION
// =============================================================================

/**
 * Get or build tone profile for draft.
 */
export function getToneProfile(
  userToneSamples?: string[],
  explicitTone?: "formal" | "professional" | "casual" | "friendly"
): ToneProfile {
  if (explicitTone) {
    const profile = getDefaultToneProfile();
    profile.primaryTone = explicitTone;
    profile.formalityScore =
      explicitTone === "formal"
        ? 0.9
        : explicitTone === "professional"
          ? 0.6
          : explicitTone === "casual"
            ? 0.3
            : 0.4;
    return profile;
  }

  if (userToneSamples && userToneSamples.length > 0) {
    return analyzeToneFromSamples(userToneSamples);
  }

  return getDefaultToneProfile();
}

// =============================================================================
// DRAFT VARIATIONS
// =============================================================================

export type VariationType =
  | "brief"
  | "detailed"
  | "formal"
  | "casual"
  | "urgent";

/**
 * Generate variation parameters for a given type.
 */
export function getVariationParams(type: VariationType): DraftOptions {
  switch (type) {
    case "brief":
      return { length: "brief", citationLevel: "minimal" };
    case "detailed":
      return { length: "detailed", citationLevel: "thorough" };
    case "formal":
      return { tone: "formal" };
    case "casual":
      return { tone: "casual" };
    case "urgent":
      return { tone: "professional", length: "brief" };
    default:
      return {};
  }
}

// =============================================================================
// HELPER EXPORTS
// =============================================================================

export { createCitation, validateCitations } from "./citations.js";
export { adjustFormality, analyzeToneFromSamples } from "./tone.js";
