// =============================================================================
// EVIDENCE LINKING UTILITY
// =============================================================================
//
// Links extracted claims to source messages for citation and verification.
//

import type {
  BaseClaim,
  ClaimEvidence,
  ExtractedClaims,
  ThreadMessage,
} from "./types";

// Define the claim type locally to avoid cross-package type dependencies
type ClaimType =
  | "fact"
  | "promise"
  | "request"
  | "question"
  | "decision"
  | "opinion"
  | "deadline"
  | "price"
  | "contact_info"
  | "reference"
  | "action_item";

/**
 * Create a claim evidence record from extraction results.
 */
export function createClaimEvidence(
  messageId: string,
  quotedText: string,
  fullMessageText?: string
): ClaimEvidence {
  let startIndex: number | undefined;
  let endIndex: number | undefined;

  if (fullMessageText && quotedText) {
    startIndex = fullMessageText.indexOf(quotedText);
    if (startIndex >= 0) {
      endIndex = startIndex + quotedText.length;
    } else {
      // Try case-insensitive search
      const lowerFull = fullMessageText.toLowerCase();
      const lowerQuoted = quotedText.toLowerCase();
      startIndex = lowerFull.indexOf(lowerQuoted);
      if (startIndex >= 0) {
        endIndex = startIndex + quotedText.length;
      } else {
        startIndex = undefined;
      }
    }
  }

  return {
    messageId,
    quotedText,
    startIndex,
    endIndex,
  };
}

/**
 * Validate and enrich claim evidence with message context.
 */
export function enrichClaimEvidence(
  claim: BaseClaim,
  messages: ThreadMessage[]
): BaseClaim {
  const enrichedEvidence: ClaimEvidence[] = [];

  for (const evidence of claim.evidence) {
    const message = messages.find((m) => m.id === evidence.messageId);
    if (message?.bodyText) {
      enrichedEvidence.push(
        createClaimEvidence(
          evidence.messageId,
          evidence.quotedText,
          message.bodyText
        )
      );
    } else {
      enrichedEvidence.push(evidence);
    }
  }

  return {
    ...claim,
    evidence: enrichedEvidence,
  };
}

/**
 * Find the best matching message for a quoted text.
 */
export function findSourceMessage(
  quotedText: string,
  messages: ThreadMessage[]
): ThreadMessage | undefined {
  const lowerQuoted = quotedText.toLowerCase();

  // First try exact match
  for (const message of messages) {
    if (message.bodyText?.includes(quotedText)) {
      return message;
    }
  }

  // Try case-insensitive match
  for (const message of messages) {
    if (message.bodyText?.toLowerCase().includes(lowerQuoted)) {
      return message;
    }
  }

  // Try fuzzy match (first few words)
  const words = lowerQuoted.split(/\s+/).slice(0, 5).join(" ");
  for (const message of messages) {
    if (message.bodyText?.toLowerCase().includes(words)) {
      return message;
    }
  }

  return undefined;
}

/**
 * Database format for claims.
 */
export interface DbClaimFormat {
  type: ClaimType;
  text: string;
  normalizedText?: string;
  confidence: number;
  threadId: string;
  organizationId: string;
  messageId?: string;
  sourceMessageIds: string[];
  quotedText?: string;
  quotedTextStart?: number;
  quotedTextEnd?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Convert extracted claims to database format.
 */
export function claimsToDbFormat(
  claims: ExtractedClaims,
  threadId: string,
  organizationId: string
): DbClaimFormat[] {
  const dbClaims: DbClaimFormat[] = [];

  // Facts
  for (const fact of claims.facts) {
    dbClaims.push({
      type: "fact",
      text: fact.text,
      normalizedText: fact.normalizedText,
      confidence: fact.confidence,
      threadId,
      organizationId,
      messageId: fact.evidence[0]?.messageId,
      sourceMessageIds: fact.evidence.map((e) => e.messageId),
      quotedText: fact.evidence[0]?.quotedText,
      quotedTextStart: fact.evidence[0]?.startIndex,
      quotedTextEnd: fact.evidence[0]?.endIndex,
      metadata: {
        entities: fact.entities,
        temporalReference: fact.temporalReference,
      },
    });
  }

  // Promises
  for (const promise of claims.promises) {
    dbClaims.push({
      type: "promise",
      text: promise.text,
      confidence: promise.confidence,
      threadId,
      organizationId,
      messageId: promise.evidence[0]?.messageId,
      sourceMessageIds: promise.evidence.map((e) => e.messageId),
      quotedText: promise.evidence[0]?.quotedText,
      quotedTextStart: promise.evidence[0]?.startIndex,
      quotedTextEnd: promise.evidence[0]?.endIndex,
      metadata: {
        promisor: promise.promisor,
        promisee: promise.promisee,
        deadline: promise.deadline,
        deadlineConfidence: promise.deadlineConfidence,
        isConditional: promise.isConditional,
        condition: promise.condition,
      },
    });
  }

  // Requests
  for (const request of claims.requests) {
    dbClaims.push({
      type: "request",
      text: request.text,
      confidence: request.confidence,
      threadId,
      organizationId,
      messageId: request.evidence[0]?.messageId,
      sourceMessageIds: request.evidence.map((e) => e.messageId),
      quotedText: request.evidence[0]?.quotedText,
      quotedTextStart: request.evidence[0]?.startIndex,
      quotedTextEnd: request.evidence[0]?.endIndex,
      metadata: {
        requester: request.requester,
        requestee: request.requestee,
        isExplicit: request.isExplicit,
        deadline: request.deadline,
        priority: request.priority,
      },
    });
  }

  // Questions
  for (const question of claims.questions) {
    dbClaims.push({
      type: "question",
      text: question.text,
      confidence: question.confidence,
      threadId,
      organizationId,
      messageId: question.evidence[0]?.messageId,
      sourceMessageIds: question.evidence.map((e) => e.messageId),
      quotedText: question.evidence[0]?.quotedText,
      quotedTextStart: question.evidence[0]?.startIndex,
      quotedTextEnd: question.evidence[0]?.endIndex,
      metadata: {
        asker: question.asker,
        isRhetorical: question.isRhetorical,
        isAnswered: question.isAnswered,
        answerMessageId: question.answerMessageId,
        answerText: question.answerText,
      },
    });
  }

  // Decisions
  for (const decision of claims.decisions) {
    dbClaims.push({
      type: "decision",
      text: decision.text,
      confidence: decision.confidence,
      threadId,
      organizationId,
      messageId: decision.evidence[0]?.messageId,
      sourceMessageIds: decision.evidence.map((e) => e.messageId),
      quotedText: decision.evidence[0]?.quotedText,
      quotedTextStart: decision.evidence[0]?.startIndex,
      quotedTextEnd: decision.evidence[0]?.endIndex,
      metadata: {
        decision: decision.decision,
        decisionMaker: decision.decisionMaker,
        rationale: decision.rationale,
        alternatives: decision.alternatives,
      },
    });
  }

  return dbClaims;
}

/**
 * Group claims by message for display.
 */
export function groupClaimsByMessage(
  claims: ExtractedClaims
): Map<string, BaseClaim[]> {
  const byMessage = new Map<string, BaseClaim[]>();

  const allClaims: BaseClaim[] = [
    ...claims.facts,
    ...claims.promises,
    ...claims.requests,
    ...claims.questions,
    ...claims.decisions,
    ...claims.other,
  ];

  for (const claim of allClaims) {
    for (const evidence of claim.evidence) {
      const existing = byMessage.get(evidence.messageId) || [];
      existing.push(claim);
      byMessage.set(evidence.messageId, existing);
    }
  }

  return byMessage;
}
