// =============================================================================
// IDENTITY RESOLUTION
// =============================================================================
//
// Merges multiple email addresses into single contacts and resolves identities.
//

import type {
  EmailAlias,
  IdentityResolutionResult,
  MergeCandidate,
} from "../types";

// =============================================================================
// EMAIL PARSING
// =============================================================================

/**
 * Parse an email address into parts.
 */
export function parseEmail(email: string): {
  local: string;
  domain: string;
  subdomain?: string;
} {
  const normalized = email.toLowerCase().trim();
  const [local = "", fullDomain = ""] = normalized.split("@");

  const domainParts = fullDomain.split(".");
  const domain =
    domainParts.length > 2 ? domainParts.slice(-2).join(".") : fullDomain;
  const subdomain =
    domainParts.length > 2 ? domainParts.slice(0, -2).join(".") : undefined;

  return { local, domain, subdomain };
}

/**
 * Normalize an email address (remove plus aliases, lowercase).
 */
export function normalizeEmail(email: string): string {
  const { local, domain } = parseEmail(email);

  // Remove plus addressing (e.g., john+newsletter@example.com → john@example.com)
  const normalizedLocal = local.split("+")[0] ?? local;

  // Remove dots for Gmail addresses (john.doe@gmail.com → johndoe@gmail.com)
  const finalLocal =
    domain === "gmail.com"
      ? normalizedLocal.replace(/\./g, "")
      : normalizedLocal;

  return `${finalLocal}@${domain}`;
}

/**
 * Extract domain from email.
 */
export function extractDomain(email: string): string {
  return parseEmail(email).domain;
}

/**
 * Check if email is from a common free email provider.
 */
export function isFreeEmailProvider(email: string): boolean {
  const freeProviders = new Set([
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "msn.com",
    "aol.com",
    "icloud.com",
    "me.com",
    "protonmail.com",
    "proton.me",
    "mail.com",
    "zoho.com",
    "yandex.com",
    "gmx.com",
    "gmx.net",
  ]);

  return freeProviders.has(extractDomain(email));
}

// =============================================================================
// NAME PARSING
// =============================================================================

/**
 * Parse a display name into first/last name.
 */
export function parseName(displayName: string): {
  firstName?: string;
  lastName?: string;
  fullName: string;
} {
  const trimmed = displayName.trim();

  // Remove common prefixes/suffixes
  const cleaned = trimmed
    .replace(/^(mr\.?|mrs\.?|ms\.?|dr\.?|prof\.?)\s+/i, "")
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|phd|md|esq\.?)$/i, "")
    .trim();

  const parts = cleaned.split(/\s+/);

  if (parts.length === 0) {
    return { fullName: trimmed };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], fullName: trimmed };
  }

  // Assume first part is first name, last part is last name
  const firstName = parts[0];
  const lastName = parts.at(-1);

  return { firstName, lastName, fullName: trimmed };
}

/**
 * Calculate name similarity score (0-1).
 */
export function calculateNameSimilarity(name1: string, name2: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (n1 === n2) {
    return 1.0;
  }

  // Check if one contains the other
  if (n1.includes(n2) || n2.includes(n1)) {
    return 0.8;
  }

  // Levenshtein distance
  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  const similarity = maxLen > 0 ? 1 - distance / maxLen : 0;

  return Math.max(0, similarity);
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;

  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }

  // Use a simple iterative approach with two rows
  let prevRow = new Array<number>(n + 1);
  let currRow = new Array<number>(n + 1);

  // Initialize first row
  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;

    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        (prevRow[j] ?? 0) + 1,
        (currRow[j - 1] ?? 0) + 1,
        (prevRow[j - 1] ?? 0) + cost
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n] ?? 0;
}

// =============================================================================
// IDENTITY RESOLUTION
// =============================================================================

/**
 * Determine if two email addresses likely belong to the same person.
 */
export function areEmailsRelated(
  email1: string,
  email2: string
): {
  isRelated: boolean;
  confidence: number;
  reason: EmailAlias["source"];
} {
  const parsed1 = parseEmail(email1);
  const parsed2 = parseEmail(email2);

  // Same normalized email
  if (normalizeEmail(email1) === normalizeEmail(email2)) {
    return { isRelated: true, confidence: 1.0, reason: "explicit_alias" };
  }

  // Same domain (non-free provider) and similar local part
  if (parsed1.domain === parsed2.domain && !isFreeEmailProvider(email1)) {
    const localSimilarity = calculateNameSimilarity(
      parsed1.local,
      parsed2.local
    );
    if (localSimilarity > 0.7) {
      return {
        isRelated: true,
        confidence: localSimilarity * 0.9,
        reason: "domain_match",
      };
    }
  }

  // Check for common patterns (firstName.lastName, firstLast, f.last, etc.)
  const patterns1 = extractNamePatterns(parsed1.local);
  const patterns2 = extractNamePatterns(parsed2.local);

  for (const p1 of patterns1) {
    for (const p2 of patterns2) {
      if (p1.firstName && p2.firstName && p1.lastName && p2.lastName) {
        const firstMatch = calculateNameSimilarity(p1.firstName, p2.firstName);
        const lastMatch = calculateNameSimilarity(p1.lastName, p2.lastName);

        if (firstMatch > 0.8 && lastMatch > 0.8) {
          return {
            isRelated: true,
            confidence: ((firstMatch + lastMatch) / 2) * 0.8,
            reason: "name_similarity",
          };
        }
      }
    }
  }

  return { isRelated: false, confidence: 0, reason: "domain_match" };
}

/**
 * Extract possible name patterns from email local part.
 */
function extractNamePatterns(
  local: string
): Array<{ firstName?: string; lastName?: string }> {
  const patterns: Array<{ firstName?: string; lastName?: string }> = [];

  // Split by common separators
  const separators = [".", "_", "-"];

  for (const sep of separators) {
    if (local.includes(sep)) {
      const parts = local.split(sep);
      if (parts.length === 2) {
        patterns.push({ firstName: parts[0], lastName: parts[1] });
        patterns.push({ firstName: parts[1], lastName: parts[0] });
      }
    }
  }

  // Try to extract first initial + last name (jdoe)
  if (local.length > 2 && /^[a-z][a-z]+$/.test(local)) {
    patterns.push({ firstName: local[0], lastName: local.slice(1) });
  }

  // Try CamelCase (JohnDoe)
  const camelMatch = local.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/);
  if (camelMatch) {
    patterns.push({
      firstName: camelMatch[1]?.toLowerCase(),
      lastName: camelMatch[2]?.toLowerCase(),
    });
  }

  return patterns;
}

/**
 * Resolve identity from multiple email addresses and names.
 */
export function resolveIdentity(
  emails: string[],
  names: string[]
): IdentityResolutionResult {
  if (emails.length === 0) {
    throw new Error("At least one email is required");
  }

  // Normalize all emails
  const normalizedEmails = emails.map((e) => normalizeEmail(e));
  const uniqueEmails = [...new Set(normalizedEmails)];

  // Find the primary email (prefer work email over personal)
  const workEmails = uniqueEmails.filter((e) => !isFreeEmailProvider(e));
  // We know uniqueEmails has at least one element due to the check above
  const primaryEmail = workEmails[0] ?? uniqueEmails[0] ?? emails[0];

  // Build aliases
  const aliases: EmailAlias[] = uniqueEmails
    .filter((e) => e !== primaryEmail)
    .map((email) => {
      const relation = areEmailsRelated(primaryEmail, email);
      return {
        email,
        confidence: relation.confidence,
        source: relation.reason,
      };
    });

  // Resolve name from available names
  const validNames = names.filter((n) => n && n.trim().length > 0);
  let displayName: string | undefined;
  let firstName: string | undefined;
  let lastName: string | undefined;

  if (validNames.length > 0) {
    // Prefer longer names (more likely to be full names)
    const sortedNames = validNames.sort((a, b) => b.length - a.length);
    displayName = sortedNames[0];

    if (displayName) {
      const parsed = parseName(displayName);
      firstName = parsed.firstName;
      lastName = parsed.lastName;
    }
  }

  // Calculate overall confidence
  const confidence =
    aliases.length > 0
      ? aliases.reduce((sum, a) => sum + a.confidence, 1) / (aliases.length + 1)
      : 1.0;

  return {
    primaryEmail,
    aliases,
    displayName,
    firstName,
    lastName,
    confidence,
  };
}

/**
 * Find merge candidates for a contact.
 */
export function findMergeCandidates(
  targetEmail: string,
  targetName: string | undefined,
  existingContacts: Array<{
    id: string;
    primaryEmail: string;
    emails?: string[];
    displayName?: string;
  }>
): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  const targetDomain = extractDomain(targetEmail);
  const isTargetWorkEmail = !isFreeEmailProvider(targetEmail);

  for (const contact of existingContacts) {
    // Skip self
    if (normalizeEmail(contact.primaryEmail) === normalizeEmail(targetEmail)) {
      continue;
    }

    // Check email domain match
    if (
      isTargetWorkEmail &&
      extractDomain(contact.primaryEmail) === targetDomain
    ) {
      const localSim = calculateNameSimilarity(
        parseEmail(targetEmail).local,
        parseEmail(contact.primaryEmail).local
      );
      if (localSim > 0.5) {
        candidates.push({
          contactId: contact.id,
          email: contact.primaryEmail,
          displayName: contact.displayName,
          similarity: localSim,
          matchType: "email_domain",
        });
        continue;
      }
    }

    // Check name similarity
    if (targetName && contact.displayName) {
      const nameSim = calculateNameSimilarity(targetName, contact.displayName);
      if (nameSim > 0.9) {
        candidates.push({
          contactId: contact.id,
          email: contact.primaryEmail,
          displayName: contact.displayName,
          similarity: nameSim,
          matchType: nameSim === 1 ? "name_exact" : "name_similar",
        });
      }
    }
  }

  // Sort by similarity descending
  return candidates.sort((a, b) => b.similarity - a.similarity);
}
