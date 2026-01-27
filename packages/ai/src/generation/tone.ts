// =============================================================================
// TONE MATCHING (PRD-08)
// =============================================================================
//
// Analyze and match user writing style for consistent drafts.
//

import type { ToneAnalysis } from "../prompts/drafting/index.js";

// =============================================================================
// TYPES
// =============================================================================

export type ToneType = "formal" | "professional" | "casual" | "friendly";

export interface ToneProfile {
  primaryTone: ToneType;
  formalityScore: number; // 0-1, higher = more formal
  characteristics: ToneCharacteristic[];
  greetings: string[];
  signoffs: string[];
  averageSentenceLength: number;
  averageWordLength: number;
  vocabularyComplexity: number; // 0-1
}

export interface ToneCharacteristic {
  trait: string;
  examples: string[];
  frequency: number; // 0-1
}

export interface ToneAdjustment {
  originalText: string;
  adjustedText: string;
  changes: Array<{
    type: "vocabulary" | "structure" | "greeting" | "signoff" | "formality";
    original: string;
    replacement: string;
  }>;
}

// =============================================================================
// RULE-BASED TONE ANALYSIS
// =============================================================================

/**
 * Analyze writing samples to extract tone profile.
 * This is a rule-based fallback when LLM isn't available.
 */
export function analyzeToneFromSamples(samples: string[]): ToneProfile {
  if (samples.length === 0) {
    return getDefaultToneProfile();
  }

  const combined = samples.join("\n\n");
  const sentences = extractSentences(combined);
  const words = extractWords(combined);

  // Calculate metrics
  const avgSentenceLength =
    sentences.length > 0 ? words.length / sentences.length : 15;

  const avgWordLength =
    words.length > 0
      ? words.reduce((sum, w) => sum + w.length, 0) / words.length
      : 5;

  // Detect formality
  const formalityScore = calculateFormality(combined, words);

  // Detect primary tone
  const primaryTone = detectPrimaryTone(formalityScore, combined);

  // Extract characteristics
  const characteristics = extractCharacteristics(combined);

  // Extract common greetings and signoffs
  const greetings = extractGreetings(samples);
  const signoffs = extractSignoffs(samples);

  // Calculate vocabulary complexity
  const vocabularyComplexity = calculateVocabularyComplexity(words);

  return {
    primaryTone,
    formalityScore,
    characteristics,
    greetings,
    signoffs,
    averageSentenceLength: Math.round(avgSentenceLength),
    averageWordLength: Math.round(avgWordLength * 10) / 10,
    vocabularyComplexity,
  };
}

/**
 * Get default tone profile.
 */
export function getDefaultToneProfile(): ToneProfile {
  return {
    primaryTone: "professional",
    formalityScore: 0.6,
    characteristics: [
      { trait: "clear", examples: [], frequency: 0.8 },
      { trait: "concise", examples: [], frequency: 0.7 },
    ],
    greetings: ["Hi", "Hello"],
    signoffs: ["Best regards", "Thanks"],
    averageSentenceLength: 15,
    averageWordLength: 5,
    vocabularyComplexity: 0.5,
  };
}

// =============================================================================
// FORMALITY DETECTION
// =============================================================================

const FORMAL_INDICATORS = [
  // Formal phrases
  /\bplease be advised\b/i,
  /\bkindly\b/i,
  /\bhereby\b/i,
  /\bpursuant to\b/i,
  /\bwith regard to\b/i,
  /\bin accordance with\b/i,
  /\bI would like to\b/i,
  /\bwe would appreciate\b/i,
  /\bat your earliest convenience\b/i,
  // Formal greetings
  /^Dear\s+(Mr\.|Mrs\.|Ms\.|Dr\.)/im,
  /^To Whom It May Concern/im,
  // Formal signoffs
  /\bSincerely,?\s*$/im,
  /\bRespectfully,?\s*$/im,
  /\bBest regards,?\s*$/im,
];

const CASUAL_INDICATORS = [
  // Casual phrases
  /\bhey\b/i,
  /\bthanks!\s*$/im,
  /\bawesome\b/i,
  /\bcool\b/i,
  /\bno worries\b/i,
  /\bsounds good\b/i,
  /\blet me know\b/i,
  /\bcheers\b/i,
  // Contractions
  /\b(won't|can't|don't|didn't|isn't|aren't|I'm|you're|we're|they're)\b/i,
  // Exclamation marks (casual usage)
  /[!]{1,}/,
  // Emoji patterns
  /[:;]\)|:\)|;\)/,
];

/**
 * Calculate formality score from text.
 */
function calculateFormality(text: string, words: string[]): number {
  let formalScore = 0;
  let casualScore = 0;

  // Check formal indicators
  for (const pattern of FORMAL_INDICATORS) {
    if (pattern.test(text)) {
      formalScore += 0.1;
    }
  }

  // Check casual indicators
  for (const pattern of CASUAL_INDICATORS) {
    if (pattern.test(text)) {
      casualScore += 0.1;
    }
  }

  // Average word length contributes to formality
  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  if (avgWordLen > 6) {
    formalScore += 0.1;
  }
  if (avgWordLen < 4) {
    casualScore += 0.1;
  }

  // Sentence length
  const sentences = extractSentences(text);
  const avgSentenceLen = words.length / Math.max(sentences.length, 1);
  if (avgSentenceLen > 20) {
    formalScore += 0.1;
  }
  if (avgSentenceLen < 10) {
    casualScore += 0.1;
  }

  // Normalize to 0-1 range
  const rawScore = (formalScore - casualScore + 0.5) / 1;
  return Math.max(0, Math.min(1, rawScore));
}

/**
 * Detect primary tone from formality and content.
 */
function detectPrimaryTone(formalityScore: number, text: string): ToneType {
  // Check for friendliness indicators
  const hasFriendlyMarkers =
    /\bhope (you're|this finds)\b/i.test(text) ||
    /\bthank you so much\b/i.test(text) ||
    /\bI appreciate\b/i.test(text);

  if (formalityScore >= 0.7) {
    return "formal";
  }
  if (formalityScore >= 0.4) {
    return hasFriendlyMarkers ? "professional" : "professional";
  }
  if (formalityScore >= 0.2) {
    return hasFriendlyMarkers ? "friendly" : "casual";
  }
  return "casual";
}

// =============================================================================
// CHARACTERISTIC EXTRACTION
// =============================================================================

/**
 * Extract writing characteristics from text.
 */
function extractCharacteristics(text: string): ToneCharacteristic[] {
  const characteristics: ToneCharacteristic[] = [];

  // Check for conciseness (short sentences)
  const sentences = extractSentences(text);
  const avgLength =
    sentences.reduce((sum, s) => sum + s.length, 0) /
    Math.max(sentences.length, 1);
  if (avgLength < 100) {
    characteristics.push({
      trait: "concise",
      examples: sentences.slice(0, 2),
      frequency: 0.8,
    });
  }

  // Check for directness (active voice, clear statements)
  const directPatterns = /\b(I will|We will|Please|You should)\b/gi;
  const directMatches = text.match(directPatterns) ?? [];
  if (directMatches.length > 2) {
    characteristics.push({
      trait: "direct",
      examples: directMatches.slice(0, 3),
      frequency: Math.min(directMatches.length / 5, 1),
    });
  }

  // Check for warmth/empathy
  const warmPatterns =
    /\b(hope|appreciate|thank|grateful|understand|happy to)\b/gi;
  const warmMatches = text.match(warmPatterns) ?? [];
  if (warmMatches.length > 1) {
    characteristics.push({
      trait: "warm",
      examples: warmMatches.slice(0, 3),
      frequency: Math.min(warmMatches.length / 3, 1),
    });
  }

  // Check for detail-orientation
  const detailPatterns =
    /\b(specifically|in particular|for example|such as)\b/gi;
  const detailMatches = text.match(detailPatterns) ?? [];
  if (detailMatches.length > 0) {
    characteristics.push({
      trait: "detailed",
      examples: detailMatches.slice(0, 3),
      frequency: Math.min(detailMatches.length / 2, 1),
    });
  }

  return characteristics;
}

// =============================================================================
// GREETING AND SIGNOFF EXTRACTION
// =============================================================================

const COMMON_GREETINGS = [
  /^(Hi|Hello|Hey|Dear|Good morning|Good afternoon|Good evening)\s*[,!]?\s*(\w+)?/im,
];

const COMMON_SIGNOFFS = [
  /(Best regards?|Kind regards?|Thanks|Thank you|Cheers|Sincerely|Respectfully|Best|Warmly|Take care)[,.]?\s*$/im,
];

/**
 * Extract common greetings from samples.
 */
function extractGreetings(samples: string[]): string[] {
  const greetings = new Map<string, number>();

  for (const sample of samples) {
    for (const pattern of COMMON_GREETINGS) {
      const match = sample.match(pattern);
      if (match?.[1]) {
        const greeting = match[1];
        greetings.set(greeting, (greetings.get(greeting) ?? 0) + 1);
      }
    }
  }

  // Return sorted by frequency
  return Array.from(greetings.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
    .slice(0, 5);
}

/**
 * Extract common signoffs from samples.
 */
function extractSignoffs(samples: string[]): string[] {
  const signoffs = new Map<string, number>();

  for (const sample of samples) {
    for (const pattern of COMMON_SIGNOFFS) {
      const match = sample.match(pattern);
      if (match?.[1]) {
        const signoff = match[1];
        signoffs.set(signoff, (signoffs.get(signoff) ?? 0) + 1);
      }
    }
  }

  return Array.from(signoffs.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
    .slice(0, 5);
}

// =============================================================================
// VOCABULARY COMPLEXITY
// =============================================================================

const COMPLEX_WORDS = new Set([
  "accordingly",
  "furthermore",
  "nevertheless",
  "notwithstanding",
  "subsequently",
  "consequently",
  "preliminary",
  "comprehensive",
  "implementation",
  "infrastructure",
  "optimization",
  "methodology",
  "collaboration",
  "synchronization",
  "acknowledgement",
]);

/**
 * Calculate vocabulary complexity score.
 */
function calculateVocabularyComplexity(words: string[]): number {
  if (words.length === 0) {
    return 0.5;
  }

  let complexCount = 0;
  let longWordCount = 0;

  for (const word of words) {
    if (COMPLEX_WORDS.has(word.toLowerCase())) {
      complexCount++;
    }
    if (word.length > 8) {
      longWordCount++;
    }
  }

  const complexRatio = complexCount / words.length;
  const longRatio = longWordCount / words.length;

  return Math.min(1, complexRatio * 2 + longRatio * 0.5);
}

// =============================================================================
// TONE ADJUSTMENT (Rule-Based)
// =============================================================================

const FORMALITY_SUBSTITUTIONS: Array<{
  casual: RegExp;
  formal: string;
}> = [
  { casual: /\bhey\b/gi, formal: "Hello" },
  { casual: /\bthanks\b/gi, formal: "Thank you" },
  { casual: /\bawesome\b/gi, formal: "excellent" },
  { casual: /\bcool\b/gi, formal: "acceptable" },
  { casual: /\bno worries\b/gi, formal: "not a problem" },
  { casual: /\bsounds good\b/gi, formal: "that works well" },
  { casual: /\bASAP\b/g, formal: "as soon as possible" },
  { casual: /\bFYI\b/g, formal: "for your information" },
];

/**
 * Adjust text formality level.
 */
export function adjustFormality(
  text: string,
  targetFormality: number,
  currentFormality: number
): ToneAdjustment {
  const changes: ToneAdjustment["changes"] = [];
  let adjustedText = text;

  if (targetFormality > currentFormality) {
    // Make more formal
    for (const sub of FORMALITY_SUBSTITUTIONS) {
      const matches = text.match(sub.casual);
      if (matches) {
        for (const match of matches) {
          changes.push({
            type: "vocabulary",
            original: match,
            replacement: sub.formal,
          });
        }
        adjustedText = adjustedText.replace(sub.casual, sub.formal);
      }
    }

    // Expand contractions
    adjustedText = expandContractions(adjustedText, changes);
  } else if (targetFormality < currentFormality) {
    // Make less formal - add contractions
    adjustedText = addContractions(adjustedText, changes);
  }

  return {
    originalText: text,
    adjustedText,
    changes,
  };
}

/**
 * Expand contractions for more formal tone.
 */
function expandContractions(
  text: string,
  changes: ToneAdjustment["changes"]
): string {
  const contractions: Array<{ pattern: RegExp; expansion: string }> = [
    { pattern: /\bI'm\b/g, expansion: "I am" },
    { pattern: /\bdon't\b/gi, expansion: "do not" },
    { pattern: /\bcan't\b/gi, expansion: "cannot" },
    { pattern: /\bwon't\b/gi, expansion: "will not" },
    { pattern: /\bdidn't\b/gi, expansion: "did not" },
    { pattern: /\baren't\b/gi, expansion: "are not" },
    { pattern: /\bisn't\b/gi, expansion: "is not" },
    { pattern: /\bwouldn't\b/gi, expansion: "would not" },
    { pattern: /\bcouldn't\b/gi, expansion: "could not" },
    { pattern: /\byou're\b/gi, expansion: "you are" },
    { pattern: /\bwe're\b/gi, expansion: "we are" },
    { pattern: /\bthey're\b/gi, expansion: "they are" },
    { pattern: /\bI've\b/g, expansion: "I have" },
    { pattern: /\bwe've\b/gi, expansion: "we have" },
    { pattern: /\bit's\b/gi, expansion: "it is" },
  ];

  let result = text;
  for (const { pattern, expansion } of contractions) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        changes.push({
          type: "formality",
          original: match,
          replacement: expansion,
        });
      }
      result = result.replace(pattern, expansion);
    }
  }

  return result;
}

/**
 * Add contractions for less formal tone.
 */
function addContractions(
  text: string,
  changes: ToneAdjustment["changes"]
): string {
  const expansions: Array<{ pattern: RegExp; contraction: string }> = [
    { pattern: /\bI am\b/g, contraction: "I'm" },
    { pattern: /\bdo not\b/gi, contraction: "don't" },
    { pattern: /\bcannot\b/gi, contraction: "can't" },
    { pattern: /\bwill not\b/gi, contraction: "won't" },
    { pattern: /\bdid not\b/gi, contraction: "didn't" },
    { pattern: /\bare not\b/gi, contraction: "aren't" },
    { pattern: /\bis not\b/gi, contraction: "isn't" },
    { pattern: /\bwould not\b/gi, contraction: "wouldn't" },
    { pattern: /\bit is\b/gi, contraction: "it's" },
  ];

  let result = text;
  for (const { pattern, contraction } of expansions) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        changes.push({
          type: "formality",
          original: match,
          replacement: contraction,
        });
      }
      result = result.replace(pattern, contraction);
    }
  }

  return result;
}

// =============================================================================
// TONE COMPARISON
// =============================================================================

/**
 * Compare two tone profiles.
 */
export function compareTones(
  profile1: ToneProfile,
  profile2: ToneProfile
): {
  similarity: number;
  differences: string[];
} {
  const differences: string[] = [];

  // Compare formality
  const formalityDiff = Math.abs(
    profile1.formalityScore - profile2.formalityScore
  );
  if (formalityDiff > 0.3) {
    differences.push(
      `Formality: ${profile1.formalityScore.toFixed(2)} vs ${profile2.formalityScore.toFixed(2)}`
    );
  }

  // Compare primary tone
  if (profile1.primaryTone !== profile2.primaryTone) {
    differences.push(
      `Tone: ${profile1.primaryTone} vs ${profile2.primaryTone}`
    );
  }

  // Compare sentence length
  const sentenceLenDiff = Math.abs(
    profile1.averageSentenceLength - profile2.averageSentenceLength
  );
  if (sentenceLenDiff > 5) {
    differences.push(
      `Sentence length: ${profile1.averageSentenceLength} vs ${profile2.averageSentenceLength}`
    );
  }

  // Calculate overall similarity
  const similarity = Math.max(
    0,
    1 -
      formalityDiff -
      (profile1.primaryTone !== profile2.primaryTone ? 0.2 : 0) -
      sentenceLenDiff / 50
  );

  return { similarity, differences };
}

/**
 * Convert LLM ToneAnalysis to ToneProfile.
 */
export function toneAnalysisToProfile(analysis: ToneAnalysis): ToneProfile {
  return {
    primaryTone: analysis.detectedTone,
    formalityScore: analysis.formalityScore,
    characteristics: analysis.characteristics.map((c) => ({
      trait: c,
      examples: [],
      frequency: 0.7,
    })),
    greetings: [],
    signoffs: [],
    averageSentenceLength: analysis.averageSentenceLength,
    averageWordLength: 5,
    vocabularyComplexity: analysis.formalityScore * 0.7,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract sentences from text.
 */
function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract words from text.
 */
function extractWords(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}
