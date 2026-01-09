// =============================================================================
// PARTY IDENTIFICATION UTILITY
// =============================================================================
//
// Identifies debtor and creditor parties in commitments.
//

import type { CommitmentDirection, PartyIdentification } from "../types";

/**
 * Message context for party identification.
 */
interface MessageContext {
  fromEmail: string;
  fromName?: string;
  toEmails?: string[];
  isFromUser: boolean;
}

/**
 * Claim context for party identification.
 */
interface ClaimContext {
  promisor?: string;
  promisee?: string;
  requester?: string;
  requestee?: string;
}

/**
 * Party identification result.
 */
export interface PartiesResult {
  debtor: PartyIdentification | undefined;
  creditor: PartyIdentification | undefined;
  direction: CommitmentDirection;
}

/**
 * Identify parties in a commitment.
 */
export function identifyParties(
  claimContext: ClaimContext,
  messageContext: MessageContext,
  userEmail: string
): PartiesResult {
  const normalizedUserEmail = userEmail.toLowerCase();

  // Try to identify debtor (who owes)
  let debtor: PartyIdentification | undefined;
  let creditor: PartyIdentification | undefined;

  // For promises: promisor is debtor, promisee is creditor
  if (claimContext.promisor) {
    debtor = identifyPerson(
      claimContext.promisor,
      messageContext,
      normalizedUserEmail,
      "debtor"
    );
  }
  if (claimContext.promisee) {
    creditor = identifyPerson(
      claimContext.promisee,
      messageContext,
      normalizedUserEmail,
      "creditor"
    );
  }

  // For requests: requestee is debtor, requester is creditor
  if (!debtor && claimContext.requestee) {
    debtor = identifyPerson(
      claimContext.requestee,
      messageContext,
      normalizedUserEmail,
      "debtor"
    );
  }
  if (!creditor && claimContext.requester) {
    creditor = identifyPerson(
      claimContext.requester,
      messageContext,
      normalizedUserEmail,
      "creditor"
    );
  }

  // Fall back to message context if not identified
  if (!(debtor || creditor)) {
    // If message is from user, assume user is making commitment (debtor)
    if (messageContext.isFromUser) {
      debtor = {
        email: normalizedUserEmail,
        isUser: true,
        confidence: 0.6,
        role: "debtor",
      };
      // Creditor is likely the recipient
      if (messageContext.toEmails?.[0]) {
        creditor = {
          email: messageContext.toEmails[0].toLowerCase(),
          isUser: false,
          confidence: 0.5,
          role: "creditor",
        };
      }
    } else {
      // Message is from someone else, they're likely the debtor
      debtor = {
        email: messageContext.fromEmail.toLowerCase(),
        name: messageContext.fromName,
        isUser: false,
        confidence: 0.6,
        role: "debtor",
      };
      // User is likely the creditor
      creditor = {
        email: normalizedUserEmail,
        isUser: true,
        confidence: 0.5,
        role: "creditor",
      };
    }
  }

  // Determine direction based on who is the debtor
  const direction: CommitmentDirection =
    debtor?.isUser === true ? "owed_by_me" : "owed_to_me";

  return { debtor, creditor, direction };
}

/**
 * Identify a person from text or context.
 */
function identifyPerson(
  identifier: string,
  messageContext: MessageContext,
  userEmail: string,
  role: "debtor" | "creditor"
): PartyIdentification | undefined {
  const normalized = identifier.toLowerCase().trim();

  // Check if it refers to the user
  if (isUserReference(normalized, userEmail)) {
    return {
      email: userEmail,
      isUser: true,
      confidence: 0.9,
      role,
    };
  }

  // Check if it's an email
  if (isEmail(normalized)) {
    return {
      email: normalized,
      isUser: normalized === userEmail,
      confidence: 0.95,
      role,
    };
  }

  // Check if it matches message sender/recipients
  if (matchesMessageParticipant(normalized, messageContext)) {
    const match = findBestMatch(normalized, messageContext);
    if (match) {
      return {
        email: match.email,
        name: match.name,
        isUser: match.email === userEmail,
        confidence: 0.8,
        role,
      };
    }
  }

  // Return name-only identification with lower confidence
  return {
    name: identifier,
    isUser: false,
    confidence: 0.5,
    role,
  };
}

/**
 * Check if identifier refers to the user.
 */
function isUserReference(identifier: string, _userEmail: string): boolean {
  const userReferences = [
    "i",
    "me",
    "my",
    "myself",
    "we",
    "our",
    "us",
    "i'll",
    "i will",
    "i'm",
    "i am",
  ];
  return userReferences.includes(identifier);
}

/**
 * Check if string is an email address.
 */
function isEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

/**
 * Check if identifier matches message participants.
 */
function matchesMessageParticipant(
  identifier: string,
  context: MessageContext
): boolean {
  const lowerIdentifier = identifier.toLowerCase();

  // Check sender
  if (
    context.fromEmail.toLowerCase().includes(lowerIdentifier) ||
    context.fromName?.toLowerCase().includes(lowerIdentifier)
  ) {
    return true;
  }

  // Check recipients
  if (context.toEmails) {
    for (const email of context.toEmails) {
      if (email.toLowerCase().includes(lowerIdentifier)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find best match from message participants.
 */
function findBestMatch(
  identifier: string,
  context: MessageContext
): { email: string; name?: string } | undefined {
  const lowerIdentifier = identifier.toLowerCase();

  // Check sender first
  if (
    context.fromEmail.toLowerCase().includes(lowerIdentifier) ||
    context.fromName?.toLowerCase().includes(lowerIdentifier)
  ) {
    return {
      email: context.fromEmail.toLowerCase(),
      name: context.fromName,
    };
  }

  // Check recipients
  if (context.toEmails) {
    for (const email of context.toEmails) {
      if (email.toLowerCase().includes(lowerIdentifier)) {
        return { email: email.toLowerCase() };
      }
    }
  }

  return undefined;
}

/**
 * Merge LLM-identified parties with heuristic identification.
 */
export function mergePartyIdentifications(
  llmResult: {
    debtorEmail?: string;
    debtorName?: string;
    creditorEmail?: string;
    creditorName?: string;
  },
  heuristicResult: PartiesResult,
  userEmail: string
): PartiesResult {
  const normalizedUserEmail = userEmail.toLowerCase();

  let debtor = heuristicResult.debtor;
  let creditor = heuristicResult.creditor;

  // LLM identification takes precedence if it has email
  if (llmResult.debtorEmail) {
    const email = llmResult.debtorEmail.toLowerCase();
    debtor = {
      email,
      name: llmResult.debtorName,
      isUser: email === normalizedUserEmail,
      confidence: 0.85,
      role: "debtor",
    };
  } else if (llmResult.debtorName && !debtor?.email) {
    debtor = {
      name: llmResult.debtorName,
      isUser: isUserReference(
        llmResult.debtorName.toLowerCase(),
        normalizedUserEmail
      ),
      confidence: 0.6,
      role: "debtor",
    };
  }

  if (llmResult.creditorEmail) {
    const email = llmResult.creditorEmail.toLowerCase();
    creditor = {
      email,
      name: llmResult.creditorName,
      isUser: email === normalizedUserEmail,
      confidence: 0.85,
      role: "creditor",
    };
  } else if (llmResult.creditorName && !creditor?.email) {
    creditor = {
      name: llmResult.creditorName,
      isUser: isUserReference(
        llmResult.creditorName.toLowerCase(),
        normalizedUserEmail
      ),
      confidence: 0.6,
      role: "creditor",
    };
  }

  // Recalculate direction
  const direction: CommitmentDirection =
    debtor?.isUser === true ? "owed_by_me" : "owed_to_me";

  return { debtor, creditor, direction };
}
