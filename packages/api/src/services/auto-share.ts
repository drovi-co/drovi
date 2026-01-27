// =============================================================================
// AUTO-SHARE DETECTION SERVICE
// =============================================================================
//
// Service for automatically sharing intelligence objects with teammates.
// Detects when teammates are mentioned or involved and creates share records.
//

import { db } from "@memorystack/db";
import {
  intelligenceShare,
  organizationSettings,
  teammateContactLink,
  unifiedIntelligenceObject,
} from "@memorystack/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================

export interface AutoShareResult {
  sharedWithUserIds: string[];
  shareType: "auto_mention" | "auto_participant" | "auto_owner";
  reason: string;
}

export interface ShareContext {
  organizationId: string;
  sharedByUserId: string;
  sourceUioId: string;
  mentionedContactIds?: string[];
  participantContactIds?: string[];
  ownerContactId?: string | null;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Check if auto-sharing is enabled for an organization.
 */
async function isAutoShareEnabled(organizationId: string): Promise<boolean> {
  const settings = await db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.organizationId, organizationId),
  });

  if (!settings) {
    return false;
  }

  // Check feature flags
  const featureFlags = settings.featureFlags as Record<string, boolean> | null;
  if (!featureFlags?.intelligenceSharingEnabled) {
    return false;
  }

  // Check auto-share setting
  return settings.autoShareOnMention ?? false;
}

// =============================================================================
// TEAMMATE DETECTION
// =============================================================================

/**
 * Find teammates linked to the given contact IDs.
 * Returns a map of contactId -> userId for internal users.
 */
export async function findLinkedTeammates(
  organizationId: string,
  contactIds: string[]
): Promise<Map<string, string>> {
  if (contactIds.length === 0) {
    return new Map();
  }

  const links = await db.query.teammateContactLink.findMany({
    where: and(
      eq(teammateContactLink.organizationId, organizationId),
      eq(teammateContactLink.isActive, true),
      inArray(teammateContactLink.contactId, contactIds)
    ),
  });

  const result = new Map<string, string>();
  for (const link of links) {
    result.set(link.contactId, link.userId);
  }

  return result;
}

/**
 * Get all contact IDs involved in a UIO (owner + participants).
 */
async function getInvolvedContactIds(uioId: string): Promise<{
  ownerContactId: string | null;
  participantContactIds: string[];
}> {
  const uio = await db.query.unifiedIntelligenceObject.findFirst({
    where: eq(unifiedIntelligenceObject.id, uioId),
  });

  if (!uio) {
    return { ownerContactId: null, participantContactIds: [] };
  }

  return {
    ownerContactId: uio.ownerContactId,
    participantContactIds: (uio.participantContactIds as string[]) ?? [],
  };
}

// =============================================================================
// AUTO-SHARE LOGIC
// =============================================================================

/**
 * Auto-share a UIO with teammates who are mentioned or involved.
 * Called when a UIO is created or updated.
 */
export async function autoShareWithTeammates(
  context: ShareContext
): Promise<AutoShareResult[]> {
  const { organizationId, sharedByUserId, sourceUioId } = context;

  // Check if auto-share is enabled
  const enabled = await isAutoShareEnabled(organizationId);
  if (!enabled) {
    return [];
  }

  // Collect all contact IDs to check
  const allContactIds = new Set<string>();

  // Add mentioned contacts
  if (context.mentionedContactIds) {
    for (const id of context.mentionedContactIds) {
      allContactIds.add(id);
    }
  }

  // Add participants
  if (context.participantContactIds) {
    for (const id of context.participantContactIds) {
      allContactIds.add(id);
    }
  }

  // Add owner if set
  if (context.ownerContactId) {
    allContactIds.add(context.ownerContactId);
  }

  if (allContactIds.size === 0) {
    return [];
  }

  // Find which contacts are linked to internal users
  const teammateMap = await findLinkedTeammates(
    organizationId,
    Array.from(allContactIds)
  );

  if (teammateMap.size === 0) {
    return [];
  }

  const results: AutoShareResult[] = [];

  // Create shares for mentioned contacts
  if (context.mentionedContactIds && context.mentionedContactIds.length > 0) {
    const mentionedUserIds: string[] = [];
    for (const contactId of context.mentionedContactIds) {
      const userId = teammateMap.get(contactId);
      if (userId && userId !== sharedByUserId) {
        mentionedUserIds.push(userId);
      }
    }

    if (mentionedUserIds.length > 0) {
      await createSharesForUsers(
        sourceUioId,
        mentionedUserIds,
        sharedByUserId,
        "auto_mention"
      );
      results.push({
        sharedWithUserIds: mentionedUserIds,
        shareType: "auto_mention",
        reason: "Teammate mentioned in intelligence object",
      });
    }
  }

  // Create shares for participants
  if (
    context.participantContactIds &&
    context.participantContactIds.length > 0
  ) {
    const participantUserIds: string[] = [];
    for (const contactId of context.participantContactIds) {
      const userId = teammateMap.get(contactId);
      if (userId && userId !== sharedByUserId) {
        // Don't duplicate if already shared via mention
        const alreadyShared = results.some((r) =>
          r.sharedWithUserIds.includes(userId)
        );
        if (!alreadyShared) {
          participantUserIds.push(userId);
        }
      }
    }

    if (participantUserIds.length > 0) {
      await createSharesForUsers(
        sourceUioId,
        participantUserIds,
        sharedByUserId,
        "auto_participant"
      );
      results.push({
        sharedWithUserIds: participantUserIds,
        shareType: "auto_participant",
        reason: "Teammate is a participant in intelligence object",
      });
    }
  }

  // Share with owner
  if (context.ownerContactId) {
    const ownerUserId = teammateMap.get(context.ownerContactId);
    if (ownerUserId && ownerUserId !== sharedByUserId) {
      const alreadyShared = results.some((r) =>
        r.sharedWithUserIds.includes(ownerUserId)
      );
      if (!alreadyShared) {
        await createSharesForUsers(
          sourceUioId,
          [ownerUserId],
          sharedByUserId,
          "auto_owner"
        );
        results.push({
          sharedWithUserIds: [ownerUserId],
          shareType: "auto_owner",
          reason: "Teammate is the owner of intelligence object",
        });
      }
    }
  }

  return results;
}

/**
 * Create share records for multiple users.
 * Skips if share already exists.
 */
async function createSharesForUsers(
  uioId: string,
  userIds: string[],
  sharedByUserId: string,
  shareType: "auto_mention" | "auto_participant" | "auto_owner"
): Promise<void> {
  for (const userId of userIds) {
    // Check for existing share
    const existing = await db.query.intelligenceShare.findFirst({
      where: and(
        eq(intelligenceShare.unifiedObjectId, uioId),
        eq(intelligenceShare.sharedWithUserId, userId)
      ),
    });

    if (existing) {
      // Reactivate if inactive
      if (!existing.isActive) {
        await db
          .update(intelligenceShare)
          .set({
            isActive: true,
            shareType,
            revokedAt: null,
            revokedByUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(intelligenceShare.id, existing.id));
      }
      continue;
    }

    // Create new share
    await db.insert(intelligenceShare).values({
      unifiedObjectId: uioId,
      sharedWithUserId: userId,
      sharedByUserId,
      shareType,
      permission: "view",
      shareReason: `Auto-shared: ${getShareReasonText(shareType)}`,
    });
  }
}

function getShareReasonText(
  shareType: "auto_mention" | "auto_participant" | "auto_owner"
): string {
  switch (shareType) {
    case "auto_mention":
      return "You were @mentioned";
    case "auto_participant":
      return "You are a participant";
    case "auto_owner":
      return "You are the owner";
    default:
      return "Auto-shared";
  }
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Process auto-sharing for a newly created UIO.
 * Called after UIO creation to share with relevant teammates.
 */
export async function processNewUIOAutoShare(
  organizationId: string,
  uioId: string,
  createdByUserId: string
): Promise<AutoShareResult[]> {
  const { ownerContactId, participantContactIds } =
    await getInvolvedContactIds(uioId);

  return autoShareWithTeammates({
    organizationId,
    sharedByUserId: createdByUserId,
    sourceUioId: uioId,
    participantContactIds,
    ownerContactId,
  });
}

/**
 * Process auto-sharing when a mention is created.
 * Called when @mentioning a teammate in a comment or note.
 */
export async function processMentionAutoShare(
  organizationId: string,
  uioId: string,
  mentionedByUserId: string,
  mentionedContactIds: string[]
): Promise<AutoShareResult[]> {
  return autoShareWithTeammates({
    organizationId,
    sharedByUserId: mentionedByUserId,
    sourceUioId: uioId,
    mentionedContactIds,
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get all auto-shares for a user (for activity feed / notifications).
 */
export async function getRecentAutoShares(
  userId: string,
  organizationId: string,
  limit = 20
): Promise<
  Array<{
    shareId: string;
    uioId: string;
    sharedByUserId: string;
    shareType: string;
    createdAt: Date;
  }>
> {
  const shares = await db.query.intelligenceShare.findMany({
    where: and(
      eq(intelligenceShare.sharedWithUserId, userId),
      eq(intelligenceShare.isActive, true),
      inArray(intelligenceShare.shareType, [
        "auto_mention",
        "auto_participant",
        "auto_owner",
      ])
    ),
    orderBy: (shares, { desc }) => [desc(shares.createdAt)],
    limit,
    with: {
      unifiedObject: {
        columns: {
          organizationId: true,
        },
      },
    },
  });

  return shares
    .filter((s) => s.unifiedObject?.organizationId === organizationId)
    .map((s) => ({
      shareId: s.id,
      uioId: s.unifiedObjectId,
      sharedByUserId: s.sharedByUserId ?? "",
      shareType: s.shareType ?? "auto_mention",
      createdAt: s.createdAt,
    }));
}
