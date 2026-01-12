// =============================================================================
// CONTRADICTION DETECTION (PRD-09)
// =============================================================================
//
// Detects contradictions with historical commitments, statements, and decisions.
//

// =============================================================================
// TYPES
// =============================================================================

export interface ContradictionInput {
  content: string;
  contentType: "draft" | "message";
  threadId?: string;
  accountId?: string;
}

export interface HistoricalStatement {
  id: string;
  type: "commitment" | "decision" | "claim" | "statement";
  text: string;
  source: string;
  date: Date;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface ContradictionResult {
  hasContradiction: boolean;
  severity: "none" | "low" | "medium" | "high" | "critical";
  score: number; // 0-100
  conflicts: ConflictDetail[];
  suggestions: ResolutionSuggestion[];
}

export interface ConflictDetail {
  id: string;
  type: "commitment" | "decision" | "statement";
  conflictType:
    | "direct_contradiction"
    | "date_conflict"
    | "amount_conflict"
    | "scope_change"
    | "reversal";
  draftStatement: string;
  historicalStatement: string;
  historicalSource: string;
  historicalDate: Date;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
}

export interface ResolutionSuggestion {
  type: "acknowledge" | "explain" | "retract" | "update" | "clarify";
  description: string;
  suggestedText?: string;
}

// =============================================================================
// CONTRADICTION DETECTOR CLASS
// =============================================================================

export class ContradictionDetector {
  private readonly thresholds = {
    low: 30,
    medium: 50,
    high: 70,
    critical: 90,
  };

  /**
   * Check for contradictions in content against historical statements.
   */
  checkContradictions(
    input: ContradictionInput,
    historicalStatements: HistoricalStatement[]
  ): ContradictionResult {
    const conflicts: ConflictDetail[] = [];

    // Check commitment conflicts
    const commitmentConflicts = this.checkCommitmentConflicts(
      input.content,
      historicalStatements.filter((s) => s.type === "commitment")
    );
    conflicts.push(...commitmentConflicts);

    // Check decision reversals
    const decisionConflicts = this.checkDecisionReversals(
      input.content,
      historicalStatements.filter((s) => s.type === "decision")
    );
    conflicts.push(...decisionConflicts);

    // Check statement consistency
    const statementConflicts = this.checkStatementConsistency(
      input.content,
      historicalStatements.filter(
        (s) => s.type === "claim" || s.type === "statement"
      )
    );
    conflicts.push(...statementConflicts);

    // Calculate overall score
    const score = this.calculateScore(conflicts);
    const severity = this.getSeverity(score);

    // Generate resolution suggestions
    const suggestions = this.generateSuggestions(conflicts);

    return {
      hasContradiction: conflicts.length > 0,
      severity,
      score,
      conflicts,
      suggestions,
    };
  }

  /**
   * Check for commitment conflicts.
   */
  private checkCommitmentConflicts(
    content: string,
    commitments: HistoricalStatement[]
  ): ConflictDetail[] {
    const conflicts: ConflictDetail[] = [];
    const contentLower = content.toLowerCase();

    for (const commitment of commitments) {
      const commitmentLower = commitment.text.toLowerCase();

      // Check for direct negation
      const negationConflict = this.detectNegation(
        contentLower,
        commitmentLower
      );
      if (negationConflict) {
        conflicts.push({
          id: `conflict-${commitment.id}`,
          type: "commitment",
          conflictType: "direct_contradiction",
          draftStatement: this.extractRelevantSentence(
            content,
            negationConflict.keyword
          ),
          historicalStatement: commitment.text,
          historicalSource: commitment.source,
          historicalDate: commitment.date,
          severity: "high",
          explanation: `This appears to contradict a previous commitment: "${commitment.text}"`,
        });
      }

      // Check for date conflicts
      const dateConflict = this.detectDateConflict(contentLower, commitmentLower);
      if (dateConflict) {
        conflicts.push({
          id: `conflict-date-${commitment.id}`,
          type: "commitment",
          conflictType: "date_conflict",
          draftStatement: this.extractRelevantSentence(
            content,
            dateConflict.draftDate
          ),
          historicalStatement: commitment.text,
          historicalSource: commitment.source,
          historicalDate: commitment.date,
          severity: "medium",
          explanation: `The date mentioned (${dateConflict.draftDate}) conflicts with the previously committed date (${dateConflict.historicalDate})`,
        });
      }

      // Check for amount/number conflicts
      const amountConflict = this.detectAmountConflict(
        contentLower,
        commitmentLower
      );
      if (amountConflict) {
        conflicts.push({
          id: `conflict-amount-${commitment.id}`,
          type: "commitment",
          conflictType: "amount_conflict",
          draftStatement: this.extractRelevantSentence(
            content,
            amountConflict.draftAmount
          ),
          historicalStatement: commitment.text,
          historicalSource: commitment.source,
          historicalDate: commitment.date,
          severity: "medium",
          explanation: `The amount mentioned (${amountConflict.draftAmount}) differs from the previously committed amount (${amountConflict.historicalAmount})`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Check for decision reversals.
   */
  private checkDecisionReversals(
    content: string,
    decisions: HistoricalStatement[]
  ): ConflictDetail[] {
    const conflicts: ConflictDetail[] = [];
    const contentLower = content.toLowerCase();

    // Reversal indicators
    const reversalPatterns = [
      /\b(actually|instead|no longer|won't be|decided not to|changed our mind|reconsidered)\b/gi,
      /\b(contrary to|different from|opposite of|reverse|undo)\b/gi,
    ];

    const hasReversalIndicator = reversalPatterns.some((p) => p.test(content));

    if (!hasReversalIndicator) {
      return conflicts;
    }

    for (const decision of decisions) {
      const decisionLower = decision.text.toLowerCase();

      // Check for semantic overlap with negation
      const overlap = this.calculateWordOverlap(contentLower, decisionLower);
      if (overlap > 0.3) {
        // More than 30% word overlap suggests topic match
        conflicts.push({
          id: `conflict-reversal-${decision.id}`,
          type: "decision",
          conflictType: "reversal",
          draftStatement: this.extractReversalSentence(content),
          historicalStatement: decision.text,
          historicalSource: decision.source,
          historicalDate: decision.date,
          severity: "high",
          explanation: `This may be reversing a previous decision: "${decision.text}"`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Check for statement consistency.
   */
  private checkStatementConsistency(
    content: string,
    statements: HistoricalStatement[]
  ): ConflictDetail[] {
    const conflicts: ConflictDetail[] = [];
    const contentLower = content.toLowerCase();

    for (const statement of statements) {
      const statementLower = statement.text.toLowerCase();

      // Check for contradictory keywords
      const contradiction = this.detectContradictoryPhrases(
        contentLower,
        statementLower
      );
      if (contradiction) {
        conflicts.push({
          id: `conflict-statement-${statement.id}`,
          type: "statement",
          conflictType: "direct_contradiction",
          draftStatement: contradiction.draftPhrase,
          historicalStatement: statement.text,
          historicalSource: statement.source,
          historicalDate: statement.date,
          severity: "medium",
          explanation: `This statement may contradict a previous claim: "${statement.text}"`,
        });
      }
    }

    return conflicts;
  }

  // ===========================================================================
  // DETECTION HELPERS
  // ===========================================================================

  private detectNegation(
    content: string,
    historical: string
  ): { keyword: string } | null {
    const negationPairs = [
      { positive: "will", negative: "won't" },
      { positive: "will", negative: "will not" },
      { positive: "can", negative: "cannot" },
      { positive: "can", negative: "can't" },
      { positive: "agree", negative: "disagree" },
      { positive: "accept", negative: "reject" },
      { positive: "approve", negative: "deny" },
      { positive: "include", negative: "exclude" },
      { positive: "confirm", negative: "cancel" },
    ];

    for (const pair of negationPairs) {
      // Check if historical has positive and content has negative
      if (historical.includes(pair.positive) && content.includes(pair.negative)) {
        // Verify they're about the same topic
        const overlap = this.calculateWordOverlap(content, historical);
        if (overlap > 0.2) {
          return { keyword: pair.negative };
        }
      }
    }

    return null;
  }

  private detectDateConflict(
    content: string,
    historical: string
  ): { draftDate: string; historicalDate: string } | null {
    const datePatterns = [
      /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/gi,
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      /\b(next week|this week|tomorrow|today)\b/gi,
    ];

    const contentDates: string[] = [];
    const historicalDates: string[] = [];

    for (const pattern of datePatterns) {
      const contentMatches = content.match(pattern);
      const historicalMatches = historical.match(pattern);

      if (contentMatches) contentDates.push(...contentMatches);
      if (historicalMatches) historicalDates.push(...historicalMatches);
    }

    // Check for different specific dates
    for (const cd of contentDates) {
      for (const hd of historicalDates) {
        if (
          cd.toLowerCase() !== hd.toLowerCase() &&
          this.isSpecificDate(cd) &&
          this.isSpecificDate(hd)
        ) {
          return { draftDate: cd, historicalDate: hd };
        }
      }
    }

    return null;
  }

  private detectAmountConflict(
    content: string,
    historical: string
  ): { draftAmount: string; historicalAmount: string } | null {
    const amountPatterns = [
      /\$[\d,]+(?:\.\d{2})?/g, // Currency
      /\b\d+\s*(?:percent|%)\b/gi, // Percentages
      /\b\d+\s*(?:days?|weeks?|months?|years?)\b/gi, // Time periods
      /\b\d+\s*(?:units?|items?|pieces?)\b/gi, // Quantities
    ];

    const contentAmounts: string[] = [];
    const historicalAmounts: string[] = [];

    for (const pattern of amountPatterns) {
      const contentMatches = content.match(pattern);
      const historicalMatches = historical.match(pattern);

      if (contentMatches) contentAmounts.push(...contentMatches);
      if (historicalMatches) historicalAmounts.push(...historicalMatches);
    }

    // Check for different amounts of the same type
    for (const ca of contentAmounts) {
      for (const ha of historicalAmounts) {
        if (
          this.isSameAmountType(ca, ha) &&
          this.extractNumber(ca) !== this.extractNumber(ha)
        ) {
          return { draftAmount: ca, historicalAmount: ha };
        }
      }
    }

    return null;
  }

  private detectContradictoryPhrases(
    content: string,
    historical: string
  ): { draftPhrase: string } | null {
    const contradictoryPairs = [
      { phrase1: "always", phrase2: "never" },
      { phrase1: "every", phrase2: "none" },
      { phrase1: "all", phrase2: "no" },
      { phrase1: "required", phrase2: "optional" },
      { phrase1: "mandatory", phrase2: "voluntary" },
      { phrase1: "free", phrase2: "paid" },
      { phrase1: "included", phrase2: "excluded" },
      { phrase1: "before", phrase2: "after" },
    ];

    for (const pair of contradictoryPairs) {
      if (
        (historical.includes(pair.phrase1) && content.includes(pair.phrase2)) ||
        (historical.includes(pair.phrase2) && content.includes(pair.phrase1))
      ) {
        // Verify topic overlap
        const overlap = this.calculateWordOverlap(content, historical);
        if (overlap > 0.2) {
          const contradictingPhrase = content.includes(pair.phrase1)
            ? pair.phrase1
            : pair.phrase2;
          return { draftPhrase: contradictingPhrase };
        }
      }
    }

    return null;
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  private calculateWordOverlap(text1: string, text2: string): number {
    const words1 = new Set(
      text1
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .map((w) => w.toLowerCase())
    );
    const words2 = new Set(
      text2
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .map((w) => w.toLowerCase())
    );

    let overlap = 0;
    for (const word of Array.from(words1)) {
      if (words2.has(word)) overlap++;
    }

    const maxSize = Math.max(words1.size, words2.size);
    return maxSize > 0 ? overlap / maxSize : 0;
  }

  private isSpecificDate(date: string): boolean {
    return /\d/.test(date);
  }

  private isSameAmountType(amount1: string, amount2: string): boolean {
    const types = [
      { pattern: /\$/, type: "currency" },
      { pattern: /%|percent/i, type: "percentage" },
      { pattern: /days?|weeks?|months?|years?/i, type: "time" },
      { pattern: /units?|items?|pieces?/i, type: "quantity" },
    ];

    for (const t of types) {
      if (t.pattern.test(amount1) && t.pattern.test(amount2)) {
        return true;
      }
    }
    return false;
  }

  private extractNumber(text: string): number {
    const match = text.match(/[\d,]+(?:\.\d+)?/);
    if (match) {
      return Number.parseFloat(match[0].replace(/,/g, ""));
    }
    return 0;
  }

  private extractRelevantSentence(text: string, keyword: string): string {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const keywordLower = keyword.toLowerCase();

    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(keywordLower)) {
        return sentence.trim();
      }
    }

    return text.slice(0, 150) + "...";
  }

  private extractReversalSentence(text: string): string {
    const reversalPatterns = [
      /[^.]*(?:actually|instead|no longer|won't be|decided not to|changed|reconsidered)[^.]*/i,
    ];

    for (const pattern of reversalPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    return text.slice(0, 150) + "...";
  }

  // ===========================================================================
  // SCORING AND SEVERITY
  // ===========================================================================

  private calculateScore(conflicts: ConflictDetail[]): number {
    if (conflicts.length === 0) return 0;

    const severityScores = {
      low: 20,
      medium: 40,
      high: 70,
      critical: 100,
    };

    const totalScore = conflicts.reduce(
      (sum, c) => sum + severityScores[c.severity],
      0
    );

    // Normalize to 0-100, with diminishing returns for multiple conflicts
    return Math.min(100, totalScore * (1 - 0.1 * (conflicts.length - 1)));
  }

  private getSeverity(
    score: number
  ): "none" | "low" | "medium" | "high" | "critical" {
    if (score === 0) return "none";
    if (score < this.thresholds.low) return "low";
    if (score < this.thresholds.medium) return "medium";
    if (score < this.thresholds.high) return "high";
    return "critical";
  }

  // ===========================================================================
  // RESOLUTION SUGGESTIONS
  // ===========================================================================

  private generateSuggestions(conflicts: ConflictDetail[]): ResolutionSuggestion[] {
    const suggestions: ResolutionSuggestion[] = [];

    for (const conflict of conflicts) {
      switch (conflict.conflictType) {
        case "direct_contradiction":
          suggestions.push({
            type: "acknowledge",
            description:
              "Acknowledge the change from the previous position and explain why",
            suggestedText: `I want to clarify that this represents a change from our earlier discussion where ${conflict.historicalStatement}`,
          });
          break;

        case "date_conflict":
          suggestions.push({
            type: "clarify",
            description: "Clarify the timeline change",
            suggestedText: `I should note that the timeline has changed from what we previously discussed`,
          });
          break;

        case "amount_conflict":
          suggestions.push({
            type: "explain",
            description: "Explain the reason for the different amount",
            suggestedText: `The updated figure reflects [reason for change]`,
          });
          break;

        case "reversal":
          suggestions.push({
            type: "acknowledge",
            description: "Acknowledge the decision reversal and provide context",
            suggestedText: `After further consideration, we've decided to change our approach. Previously, ${conflict.historicalStatement}. The reason for this change is [explanation]`,
          });
          break;

        case "scope_change":
          suggestions.push({
            type: "update",
            description: "Update stakeholders about the scope change",
          });
          break;
      }
    }

    // Add general retraction option for critical conflicts
    if (conflicts.some((c) => c.severity === "critical")) {
      suggestions.push({
        type: "retract",
        description: "Consider revising the draft to avoid the contradiction",
      });
    }

    return suggestions;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createContradictionDetector(): ContradictionDetector {
  return new ContradictionDetector();
}
