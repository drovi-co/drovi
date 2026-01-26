// =============================================================================
// ENTITY PARSER UTILITY
// =============================================================================
//
// Parses text to identify and link entity mentions (contacts, companies).
// Used for intelligent entity linking in UIO descriptions.

// =============================================================================
// TYPES
// =============================================================================

export interface LinkedEntity {
  /** Entity type */
  type: "contact" | "company";
  /** Entity ID */
  id: string;
  /** Display name (what appears in text) */
  name: string;
  /** Avatar or logo URL */
  avatarUrl?: string | null;
  /** Primary email (for contacts) */
  email?: string;
}

export interface ParsedPart {
  /** Part type */
  type: "text" | "contact" | "company" | "reference";
  /** Text content */
  content: string;
  /** Linked entity data (for contact/company types) */
  entity?: LinkedEntity;
}

// =============================================================================
// HELPER: ESCAPE REGEX
// =============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// MAIN PARSER FUNCTION
// =============================================================================

/**
 * Parse text to identify entity mentions and return structured parts.
 *
 * @param text - The text to parse
 * @param entities - Array of entities to match against
 * @returns Array of parsed parts (text or entity references)
 *
 * @example
 * ```typescript
 * const entities = [
 *   { type: 'contact', id: '1', name: 'Elias', avatarUrl: '...' },
 *   { type: 'company', id: '2', name: 'Shopify', avatarUrl: '...' },
 * ];
 *
 * const parts = parseEntityMentions(
 *   "Elias at Shopify reported an issue",
 *   entities
 * );
 *
 * // Returns:
 * // [
 * //   { type: 'contact', content: 'Elias', entity: {...} },
 * //   { type: 'text', content: ' at ' },
 * //   { type: 'company', content: 'Shopify', entity: {...} },
 * //   { type: 'text', content: ' reported an issue' },
 * // ]
 * ```
 */
export function parseEntityMentions(
  text: string,
  entities: LinkedEntity[]
): ParsedPart[] {
  // If no entities or empty text, return as single text part
  if (!(text && entities) || entities.length === 0) {
    return text ? [{ type: "text", content: text }] : [];
  }

  // Sort entities by name length (longest first for greedy matching)
  // This ensures "John Smith" is matched before "John"
  const sortedEntities = [...entities].sort(
    (a, b) => b.name.length - a.name.length
  );

  // Build regex pattern from entity names
  const pattern = sortedEntities.map((e) => escapeRegex(e.name)).join("|");

  if (!pattern) {
    return [{ type: "text", content: text }];
  }

  // Use word boundary for more accurate matching
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts: ParsedPart[] = [];
  let lastIndex = 0;
  let match = regex.exec(text);

  while (match !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    // Find the matching entity (case-insensitive)
    const matchedText = match[0];
    const entity = entities.find(
      (e) => e.name.toLowerCase() === matchedText.toLowerCase()
    );

    if (entity) {
      parts.push({
        type: entity.type,
        content: matchedText,
        entity,
      });
    } else {
      // Shouldn't happen, but fallback to text
      parts.push({
        type: "text",
        content: matchedText,
      });
    }

    lastIndex = regex.lastIndex;
    match = regex.exec(text);
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    parts.push({
      type: "text",
      content: text.slice(lastIndex),
    });
  }

  return parts;
}

// =============================================================================
// EXTRACT ENTITIES FROM UIO DATA
// =============================================================================

/**
 * Extract linked entities from UIO data structure.
 * Collects owner, contacts from sources, etc.
 */
export interface UIOWithRelations {
  owner?: {
    id: string;
    primaryEmail: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  commitmentDetails?: {
    debtor?: {
      id: string;
      primaryEmail: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    } | null;
    creditor?: {
      id: string;
      primaryEmail: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    } | null;
  } | null;
  decisionDetails?: {
    decisionMaker?: {
      id: string;
      primaryEmail: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    } | null;
  } | null;
  taskDetails?: {
    assignee?: {
      id: string;
      primaryEmail: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    } | null;
    createdBy?: {
      id: string;
      primaryEmail: string;
      displayName?: string | null;
      avatarUrl?: string | null;
    } | null;
  } | null;
}

export function extractEntitiesFromUIO(uio: UIOWithRelations): LinkedEntity[] {
  const entities: LinkedEntity[] = [];
  const seenIds = new Set<string>();

  const addContact = (
    contact:
      | {
          id: string;
          primaryEmail: string;
          displayName?: string | null;
          avatarUrl?: string | null;
        }
      | null
      | undefined
  ) => {
    if (!contact || seenIds.has(contact.id)) {
      return;
    }
    seenIds.add(contact.id);

    const name =
      contact.displayName || contact.primaryEmail.split("@")[0] || "";
    if (name) {
      entities.push({
        type: "contact",
        id: contact.id,
        name,
        avatarUrl: contact.avatarUrl,
        email: contact.primaryEmail,
      });
    }
  };

  // Add owner
  addContact(uio.owner);

  // Add commitment-related contacts
  if (uio.commitmentDetails) {
    addContact(uio.commitmentDetails.debtor);
    addContact(uio.commitmentDetails.creditor);
  }

  // Add decision-related contacts
  if (uio.decisionDetails) {
    addContact(uio.decisionDetails.decisionMaker);
  }

  // Add task-related contacts
  if (uio.taskDetails) {
    addContact(uio.taskDetails.assignee);
    addContact(uio.taskDetails.createdBy);
  }

  return entities;
}

// =============================================================================
// FORMAT HELPERS
// =============================================================================

/**
 * Get initials from a name.
 */
export function getInitials(name: string): string {
  if (!name) {
    return "?";
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Get display name for a contact, falling back to email.
 */
export function getContactDisplayName(contact: {
  displayName?: string | null;
  primaryEmail?: string;
}): string {
  if (contact.displayName) {
    return contact.displayName;
  }
  if (contact.primaryEmail) {
    return contact.primaryEmail.split("@")[0] ?? "";
  }
  return "Unknown";
}
